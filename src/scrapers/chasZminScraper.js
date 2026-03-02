const cheerio = require('cheerio');
const BaseScraper = require('./baseScraper');

class ChasZminScraper extends BaseScraper {
    constructor() {
        super('ChasZmin', 'https://chaszmin.com.ua');
        this.maxGrantsToProcess = parseInt(process.env.MAX_GRANTS) || 500;
        this.batchSize = parseInt(process.env.BATCH_SIZE) || 5;
        this.delayBetweenBatches = parseInt(process.env.BATCH_DELAY) || 1000;

        // Two listing pages: granty-2026 uses infinite scroll, granty-yes is static
        this.listingPages = [
            { url: 'https://chaszmin.com.ua/granty-2026/', needsScroll: true },
            { url: 'https://chaszmin.com.ua/granty-yes/', needsScroll: false },
        ];
    }

    /**
     * Load granty-2026 page with Playwright scroll until no new items appear
     * @param {string} url
     * @returns {Promise<string[]>} Array of grant URLs
     */
    async _loadWithScroll(url) {
        const browser = await this._initBrowser();
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        });

        try {
            const page = await context.newPage();

            console.log(`🌐 Loading page with scroll: ${url}`);
            await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });

            // Wait for initial grant links to appear
            await page.waitForSelector('a.post-title', { timeout: 15000 });
            await page.waitForTimeout(1500);

            const collectedLinks = new Set();
            let previousCount = 0;
            let sameCountStreak = 0;
            const maxSameCountStreak = 3;

            console.log(`🔄 Starting scroll-based loading for ${url}...`);

            while (sameCountStreak < maxSameCountStreak && collectedLinks.size < this.maxGrantsToProcess) {
                // Collect all post-title links visible so far
                const pageLinks = await page.$$eval('a.post-title', els =>
                    els.map(el => el.href)
                );

                pageLinks.forEach(href => {
                    if (this._isValidGrantLink(href)) {
                        collectedLinks.add(href);
                    }
                });

                const currentCount = collectedLinks.size;
                console.log(`📊 Unique grant links so far: ${currentCount}`);

                if (currentCount === previousCount) {
                    sameCountStreak++;
                    console.log(`⏳ No new links (streak: ${sameCountStreak}/${maxSameCountStreak})`);
                } else {
                    sameCountStreak = 0;
                    previousCount = currentCount;
                }

                // Scroll down to trigger lazy-loaded content
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                await page.waitForTimeout(2000);
            }

            const finalLinks = [...collectedLinks];
            console.log(`🎯 Scroll complete: ${finalLinks.length} unique grant links from ${url}`);
            return finalLinks;

        } finally {
            await context.close();
        }
    }

    /**
     * Load a static page and extract grant links with Cheerio
     * @param {string} url
     * @returns {Promise<string[]>} Array of grant URLs
     */
    async _loadStatic(url) {
        console.log(`🌐 Loading static page: ${url}`);
        const html = await this._getPageContent(url);
        const $ = cheerio.load(html);
        return this._extractGrantLinks($, url);
    }

    /**
     * Extract grant links from a Cheerio-loaded page
     * @param {CheerioAPI} $
     * @param {string} sourceUrl  the listing page URL (used only for logging)
     * @returns {string[]}
     */
    _extractGrantLinks($, sourceUrl = '') {
        const links = new Set();

        $('a.post-title').each((i, el) => {
            const href = $(el).attr('href');
            if (href && this._isValidGrantLink(href)) {
                links.add(href);
            }
        });

        console.log(`✅ Found ${links.size} grant links${sourceUrl ? ` on ${sourceUrl}` : ''}`);
        return [...links];
    }

    /**
     * A valid grant link is a chaszmin.com.ua page that is NOT one of the two
     * listing pages and does NOT contain query strings or fragment identifiers.
     * @param {string} url
     * @returns {boolean}
     */
    _isValidGrantLink(url) {
        if (!url) return false;
        if (!url.startsWith('https://chaszmin.com.ua/')) return false;
        if (url.includes('#') || url.includes('?')) return false;

        // Exclude the listing pages themselves
        if (
            url === 'https://chaszmin.com.ua/granty-2026/' ||
            url === 'https://chaszmin.com.ua/granty-yes/'
        ) return false;

        // Exclude common site pages (categories, tag, pages, etc.)
        const excluded = ['/category/', '/tag/', '/page/', '/author/', '/wp-content/', '/feed/'];
        if (excluded.some(ex => url.includes(ex))) return false;

        return true;
    }

    async _processUrlsInBatches(urls) {
        console.log(`🚀 Processing ${urls.length} URLs in batches of ${this.batchSize}`);

        const allGrants = [];
        let processedCount = 0;
        let successCount = 0;
        let errorCount = 0;

        for (let i = 0; i < urls.length; i += this.batchSize) {
            const batch = urls.slice(i, i + this.batchSize);
            const batchNumber = Math.floor(i / this.batchSize) + 1;
            const totalBatches = Math.ceil(urls.length / this.batchSize);

            console.log(`📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} URLs)`);

            const batchResults = await Promise.allSettled(
                batch.map(async (url) => {
                    try {
                        const grantData = await this._extractDataFromUrl(url);
                        return { url, data: grantData, success: true };
                    } catch (error) {
                        console.warn(`❌ Failed to process ${url}: ${error.message}`);
                        return { url, error: error.message, success: false };
                    }
                })
            );

            batchResults.forEach((result) => {
                processedCount++;
                if (result.status === 'fulfilled' && result.value.success && result.value.data) {
                    allGrants.push(result.value.data);
                    successCount++;
                } else {
                    errorCount++;
                }
            });

            const progress = (processedCount / urls.length * 100).toFixed(1);
            console.log(`📊 Progress: ${processedCount}/${urls.length} (${progress}%) - Success: ${successCount}, Errors: ${errorCount}`);

            if (i + this.batchSize < urls.length) {
                console.log(`⏳ Waiting ${this.delayBetweenBatches}ms before next batch...`);
                await new Promise(resolve => setTimeout(resolve, this.delayBetweenBatches));
            }
        }

        console.log(`🎯 Final results: ${allGrants.length} grants collected, ${successCount} successful, ${errorCount} errors`);
        return allGrants;
    }

    async scrape() {
        console.log(`🎯 Starting ChasZmin scraper for ${this.listingPages.length} listing pages...`);

        try {
            const allLinks = new Set();

            for (const { url, needsScroll } of this.listingPages) {
                const links = needsScroll
                    ? await this._loadWithScroll(url)
                    : await this._loadStatic(url);

                links.forEach(l => allLinks.add(l));
                console.log(`📊 Running total after ${url}: ${allLinks.size} unique links`);
            }

            const grantLinks = [...allLinks];

            if (grantLinks.length === 0) {
                console.warn(`⚠️ No grant links found for ${this.name}`);
                return [];
            }

            console.log(`🔗 Found ${grantLinks.length} total unique grant links`);

            const linksToCheck = grantLinks.slice(0, this.maxGrantsToProcess);
            const newLinks = await this._filterNewUrls(linksToCheck);

            if (newLinks.length === 0) {
                console.log(`✅ All URLs already exist in database for ${this.name}. Skipping.`);
                return [];
            }

            console.log(`📊 New URLs to process: ${newLinks.length}`);

            const grants = await this._processUrlsInBatches(newLinks);

            console.log(`✅ ${this.name} scraping completed: ${grants.length} grants collected`);
            return grants;

        } catch (error) {
            console.error(`🔥 Critical error in ${this.name} scraper: ${error.message}`);
            return [];
        }
    }
}

module.exports = new ChasZminScraper();
