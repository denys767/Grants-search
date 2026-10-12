const cheerio = require('cheerio');
const BaseScraper = require('./baseScraper');

class BigIdeaScraper extends BaseScraper {
    constructor() {
        super('BigIdea', 'https://biggggidea.com/opportunities/?category=1');
        this.maxGrantsToProcess = parseInt(process.env.MAX_GRANTS) || 50;
        this.batchSize = parseInt(process.env.BATCH_SIZE) || 5;
        this.delayBetweenBatches = parseInt(process.env.BATCH_DELAY) || 1000;
    }

    /**
     * Scroll to the bottom of the page repeatedly until all grants are loaded
     * (biggggidea.com uses infinite scroll pagination)
     * @param {string} url
     * @returns {Promise<string>} Complete HTML content with all grants
     */
    async _loadAllGrantsWithScroll(url) {
        const browser = await this._initBrowser();
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        });

        try {
            const page = await context.newPage();

            console.log(`🌐 Loading page: ${url}`);
            await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });

            // Wait for initial grants to appear
            await page.waitForSelector('.opportunity-list-item', { timeout: 15000 });
            await page.waitForTimeout(1500);

            let previousCount = 0;
            let sameCountStreak = 0;
            const maxSameCountStreak = 3; // Stop after 3 scrolls with no new items

            console.log(`🔄 Starting infinite scroll loading...`);

            while (sameCountStreak < maxSameCountStreak) {
                const currentCount = await page.locator('.opportunity-list-item').count();
                console.log(`📊 Current grants on page: ${currentCount}`);

                if (currentCount === previousCount) {
                    sameCountStreak++;
                    console.log(`⏳ No new grants loaded (streak: ${sameCountStreak}/${maxSameCountStreak})`);
                } else {
                    sameCountStreak = 0;
                    console.log(`✅ Loaded ${currentCount - previousCount} new grants (total: ${currentCount})`);
                    previousCount = currentCount;
                }

                // Check if we already have enough grants
                if (currentCount >= this.maxGrantsToProcess) {
                    console.log(`📄 Reached max grants limit (${this.maxGrantsToProcess}), stopping scroll`);
                    break;
                }

                // Scroll to the bottom of the page
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

                // Wait for potential new content to load
                await page.waitForTimeout(2000);
            }

            const finalCount = await page.locator('.opportunity-list-item').count();
            console.log(`🎯 Scroll complete: ${finalCount} total grants loaded`);

            const content = await page.content();
            return content;

        } finally {
            await context.close();
        }
    }

    /**
     * Validate if a link is a valid biggggidea.com grant link
     * @param {string} link
     * @returns {boolean}
     */
    _isValidGrantLink(link) {
        if (!link) return false;

        // biggggidea.com opportunity links: /opportunities/some-slug/
        if (link.includes('biggggidea.com/opportunities/') && !link.endsWith('/opportunities/')) {
            return true;
        }

        if (link.startsWith('/opportunities/') && link.length > '/opportunities/'.length) {
            return true;
        }

        return false;
    }

    /**
     * Override base extraction: grab text from the specific grant-detail div
     * on biggggidea.com grant pages (.opportunity-detail-description).
     */
    async _extractDataFromUrl(url) {
        const cheerio = require('cheerio');
        const { extractGrantInfo, isLlmUnavailable } = require('../services/llm');
        const { saveRejectedGrant } = require('../lib/db');

        if (isLlmUnavailable()) return null;

        try {
            console.log(`🔍 Scraping content from ${url}`);
            const pageContent = await this._getPageContent(url);
            const $ = cheerio.load(pageContent);

            // Primary: the dedicated description block on biggggidea.com grant pages
            let articleText = $('.opportunity-detail-description').text().trim();

            // Fallback: short-info block (deadline, amount, etc.)
            if (!articleText || articleText.length < 50) {
                articleText = $('.opportunity-detail').text().trim();
            }

            if (!articleText || articleText.length < 50) {
                await saveRejectedGrant(url, null, 'no_meaningful_content');
                throw new Error('No meaningful content found on the page');
            }

            const maxTextLength = 20000;
            if (articleText.length > maxTextLength) {
                articleText = articleText.substring(0, maxTextLength) + '...';
            }

            console.log(`📄 Extracted text length: ${articleText.length} characters`);

            const grantInfo = await extractGrantInfo(articleText, url);

            if (grantInfo) {
                console.log(`✅ Successfully extracted grant info from ${url}`);
            } else {
                console.warn(`⚠️ No grant info extracted from ${url}`);
            }

            return grantInfo;
        } catch (error) {
            console.error(`❌ Error extracting data from ${url}:`, error.message);
            return null;
        }
    }

    /**
     * Extract grant links from loaded page HTML
     * @param {CheerioAPI} $
     * @returns {string[]} Array of grant URLs
     */
    _extractGrantLinks($) {
        const grantLinks = [];

        // Primary selector: .opportunity-list-item h2 a
        $('.opportunity-list-item h2 a').each((i, el) => {
            const link = $(el).attr('href');
            if (link && this._isValidGrantLink(link)) {
                const fullUrl = link.startsWith('http') ? link : `https://biggggidea.com${link}`;
                grantLinks.push(fullUrl);
            }
        });

        if (grantLinks.length > 0) {
            console.log(`✅ Found ${grantLinks.length} links using primary selector`);
            return [...new Set(grantLinks)];
        }

        // Fallback: any link to /opportunities/ pages
        $('a[href*="/opportunities/"]').each((i, el) => {
            const link = $(el).attr('href');
            if (link && this._isValidGrantLink(link)) {
                const fullUrl = link.startsWith('http') ? link : `https://biggggidea.com${link}`;
                grantLinks.push(fullUrl);
            }
        });

        if (grantLinks.length > 0) {
            console.log(`✅ Found ${grantLinks.length} links using fallback selector`);
            return [...new Set(grantLinks)];
        }

        console.warn(`⚠️ No grant links found on biggggidea.com`);
        return [];
    }

    /**
     * Process URLs in parallel batches for better performance
     * @param {string[]} urls
     * @returns {Promise<any[]>} Array of grant data
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

            try {
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

                    if (result.status === 'fulfilled') {
                        if (result.value.success && result.value.data) {
                            allGrants.push(result.value.data);
                            successCount++;
                        } else {
                            errorCount++;
                        }
                    } else {
                        console.error(`🔥 Batch processing error for ${batch[index]}: ${result.reason}`);
                        errorCount++;
                    }
                });

                const progress = (processedCount / urls.length * 100).toFixed(1);
                console.log(`📊 Progress: ${processedCount}/${urls.length} (${progress}%) - Success: ${successCount}, Errors: ${errorCount}`);

                if (i + this.batchSize < urls.length) {
                    console.log(`⏳ Waiting ${this.delayBetweenBatches}ms before next batch...`);
                    await new Promise(resolve => setTimeout(resolve, this.delayBetweenBatches));
                }

            } catch (error) {
                console.error(`🔥 Critical error processing batch ${batchNumber}: ${error.message}`);
                errorCount += batch.length;
                processedCount += batch.length;
            }
        }

        console.log(`🎯 Final results: ${allGrants.length} grants collected, ${successCount} successful, ${errorCount} errors`);
        return allGrants;
    }

    async scrape() {
        console.log(`🎯 Starting scraping for ${this.name} with infinite scroll...`);

        try {
            const content = await this._loadAllGrantsWithScroll(this.url);
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

module.exports = new BigIdeaScraper();
