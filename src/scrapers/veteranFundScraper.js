const cheerio = require('cheerio');
const BaseScraper = require('./baseScraper');

class VeteranFundScraper extends BaseScraper {
    constructor() {
        super('VeteranFund', 'https://veteranfund.com.ua/contests/');
        this.maxGrantsToProcess = parseInt(process.env.MAX_GRANTS) || 50;
        this.batchSize = parseInt(process.env.BATCH_SIZE) || 5;
        this.delayBetweenBatches = parseInt(process.env.BATCH_DELAY) || 1000;
    }

    /**
     * Validate if a link is a valid veteranfund contest link
     * @param {string} link
     * @returns {boolean}
     */
    _isValidGrantLink(link) {
        if (!link) return false;
        // Valid: /contests/some-slug/ or full URL — but NOT the listing page itself
        return (
            link.includes('/contests/') &&
            !link.endsWith('/contests/') &&
            !link.includes('#') &&
            !link.includes('?') &&
            !link.includes('/en/')
        );
    }

    /**
     * Extract contest links from loaded HTML
     * @param {CheerioAPI} $
     * @returns {string[]} Array of contest URLs
     */
    _extractGrantLinks($) {
        const links = [];

        $('a[href*="/contests/"]').each((i, el) => {
            const link = $(el).attr('href');
            if (link && this._isValidGrantLink(link)) {
                const fullUrl = link.startsWith('http') ? link : `https://veteranfund.com.ua${link}`;
                links.push(fullUrl);
            }
        });

        const unique = [...new Set(links)];

        if (unique.length > 0) {
            console.log(`✅ Found ${unique.length} links`);
        } else {
            console.warn(`⚠️ No contest links found on veteranfund.com.ua`);
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
        console.log(`🎯 Starting scraping for ${this.name}...`);

        try {
            const content = await this._getPageContent(this.url);
            const $ = cheerio.load(content);

            const grantLinks = this._extractGrantLinks($);

            if (grantLinks.length === 0) {
                console.warn(`⚠️ No contest links found for ${this.name}`);
                return [];
            }

            console.log(`🔗 Found ${grantLinks.length} total contest links`);

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

module.exports = new VeteranFundScraper();
