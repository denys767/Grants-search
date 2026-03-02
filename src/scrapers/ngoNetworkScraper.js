const cheerio = require('cheerio');
const BaseScraper = require('./baseScraper');

class NgoNetworkScraper extends BaseScraper {
    constructor() {
        super('NgoNetwork', 'https://ngonetwork.org.ua/category/mozhlyvosti/');
        this.maxGrantsToProcess = parseInt(process.env.MAX_GRANTS) || 50;
        this.batchSize = parseInt(process.env.BATCH_SIZE) || 5;
        this.delayBetweenBatches = parseInt(process.env.BATCH_DELAY) || 1000;
    }

    /**
     * Validate if a link is a valid ngonetwork.org.ua post link.
     * Post links are root-level slugs, not category/navigation/pagination pages.
     * @param {string} link
     * @returns {boolean}
     */
    _isValidGrantLink(link) {
        if (!link) return false;

        const excluded = [
            '/category/', '/page/', '/tag/', '/author/',
            '/about/', '/contacts/', '/dlya-zmi/', '/chleny-spilky/',
            '/biblioteka/', '/uspikh/', '/navchannya-stazhuvannya/',
            '/novyny/', '/festyvali/',
            '#', 'javascript:', 'mailto:',
            'facebook.com', 'twitter.com', 'feedburner.com',
            'old.ngonetwork.org.ua',
        ];

        if (excluded.some(pattern => link.includes(pattern))) return false;

        // Must be a ngonetwork.org.ua URL with a slug path
        return link.includes('ngonetwork.org.ua/') && !link.endsWith('ngonetwork.org.ua/');
    }

    /**
     * Extract post links — WordPress category pages put post titles in h2 elements
     * @param {CheerioAPI} $
     * @returns {string[]}
     */
    _extractGrantLinks($) {
        const links = [];

        // WordPress post titles in category listing are wrapped in <h2> tags
        $('h2 a[href*="ngonetwork.org.ua"]').each((i, el) => {
            const link = $(el).attr('href');
            if (link && this._isValidGrantLink(link)) {
                links.push(link);
            }
        });

        const unique = [...new Set(links)];

        if (unique.length > 0) {
            console.log(`✅ Found ${unique.length} links`);
        } else {
            console.warn(`⚠️ No post links found on ngonetwork.org.ua`);
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
                console.warn(`⚠️ No links found for ${this.name}`);
                return [];
            }

            console.log(`🔗 Found ${grantLinks.length} total links`);

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

module.exports = new NgoNetworkScraper();
