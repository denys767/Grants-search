const cheerio = require('cheerio');
const BaseScraper = require('./baseScraper');

class GrantSenseScraper extends BaseScraper {
    constructor() {
        super('GrantSense', 'https://www.grantsense.com.ua/grants2025');
        this.maxGrantsToProcess = parseInt(process.env.MAX_GRANTS) || 50;
        this.batchSize = parseInt(process.env.BATCH_SIZE) || 5;
        this.delayBetweenBatches = parseInt(process.env.BATCH_DELAY) || 1000;
    }

    /**
     * Load page and wait for Next.js to render the grant cards
     * @param {string} url
     * @returns {Promise<string>} HTML content
     */
    async _loadPage(url) {
        const browser = await this._initBrowser();
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        });

        try {
            const page = await context.newPage();

            console.log(`🌐 Loading page: ${url}`);
            const response = await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });

            if (!response || !response.ok()) {
                throw new Error(`HTTP ${response?.status() ?? 'no response'} while loading ${url}`);
            }

            // Wait for Next.js grant cards to render
            await page.waitForSelector('a[href*="/grants2025/"]', { timeout: 15000 });
            await page.waitForTimeout(1000);

            const count = await page.locator('a[href*="/grants2025/"]').count();
            console.log(`📊 Found ${count} grant cards on page`);

            const content = await page.content();
            return content;

        } finally {
            await context.close();
        }
    }

    /**
     * Validate if a link is a valid grantsense.com.ua grant link
     * @param {string} link
     * @returns {boolean}
     */
    _isValidGrantLink(link) {
        if (!link) return false;
        // Grant links: /grants2025/some-slug or full URL
        return (link.includes('/grants2025/') && !link.endsWith('/grants2025/') && !link.includes('?'));
    }

    /**
     * Extract grant links from loaded HTML
     * @param {CheerioAPI} $
     * @returns {string[]} Array of grant URLs
     */
    _extractGrantLinks($) {
        const grantLinks = [];

        // Primary selector based on HTML structure
        $('a[href*="/grants2025/"]').each((i, el) => {
            const link = $(el).attr('href');
            if (link && this._isValidGrantLink(link)) {
                const fullUrl = link.startsWith('http') ? link : `https://www.grantsense.com.ua${link}`;
                grantLinks.push(fullUrl);
            }
        });

        const unique = [...new Set(grantLinks)];

        if (unique.length > 0) {
            console.log(`✅ Found ${unique.length} links`);
        } else {
            console.warn(`⚠️ No grant links found on grantsense.com.ua`);
        }

        return unique;
    }

    /**
     * Process URLs in parallel batches
     * @param {string[]} urls
     * @returns {Promise<any[]>}
     */
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

            batchResults.forEach((result, index) => {
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
        console.log(`🎯 Starting scraping for ${this.name}...`);

        try {
            const content = await this._loadPage(this.url);
            const $ = cheerio.load(content);

            const grantLinks = this._extractGrantLinks($);

            if (grantLinks.length === 0) {
                console.warn(`⚠️ No grant links found for ${this.name}`);
                return [];
            }

            console.log(`🔗 Found ${grantLinks.length} total grant links`);

            const linksToCheck = grantLinks.slice(0, this.maxGrantsToProcess);
            console.log(`📊 Processing up to ${this.maxGrantsToProcess} grants (limited from ${grantLinks.length} total)`);

            const newLinks = await this._filterNewUrls(linksToCheck);

            if (newLinks.length === 0) {
                console.log(`✅ All URLs already exist in database for ${this.name}. Skipping content extraction.`);
                return [];
            }

            console.log(`📊 Database check results:`);
            console.log(`   • Total URLs found: ${grantLinks.length}`);
            console.log(`   • URLs checked: ${linksToCheck.length}`);
            console.log(`   • New URLs to process: ${newLinks.length}`);

            const grants = await this._processUrlsInBatches(newLinks);

            console.log(`✅ ${this.name} scraping completed: ${grants.length} grants collected`);
            return grants;

        } catch (error) {
            console.error(`🔥 Critical error in ${this.name} scraper: ${error.message}`);
            return [];
        }
    }
}

module.exports = new GrantSenseScraper();
