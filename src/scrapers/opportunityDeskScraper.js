

const cheerio = require('cheerio');
const BaseScraper = require('./baseScraper');

class OpportunityDeskScraper extends BaseScraper {
    constructor() {
        super('OpportunityDesk', 'https://opportunitydesk.org/category/grants/');
        this.feedUrl = 'https://opportunitydesk.org/category/grants/feed/';
        this.maxPages = parseInt(process.env.MAX_PAGES) || 5;
        this.maxGrantsToProcess = parseInt(process.env.MAX_GRANTS) || 50;
        this.batchSize = parseInt(process.env.BATCH_SIZE) || 5;
        this.delayBetweenBatches = parseInt(process.env.BATCH_DELAY) || 1000;
    }

    _extractGrantLinksFromFeed(content) {
        // Playwright renders XML documents inside a <pre> element. Parse that
        // text as XML rather than relying on the Cloudflare-protected HTML page.
        const $document = cheerio.load(content);
        const xml = $document('pre').text().trim() || content;
        const $feed = cheerio.load(xml, { xmlMode: true });

        return [...new Set(
            $feed('item > link').map((i, el) => $feed(el).text().trim()).get()
                .filter(link => link.startsWith('https://opportunitydesk.org/'))
        )];
    }

    /**
     * Scrape grants from the site's public RSS feed. The HTML category page is
     * protected by Cloudflare, while the publisher-provided feed is accessible.
     * @returns {Promise<Array>} Array of grant data
     */
    async scrape() {
        console.log(`🔍 Starting ${this.name} scraper`);
        console.log(`📄 Max pages: ${this.maxPages}, Max grants: ${this.maxGrantsToProcess}`);
        
        const allGrantLinks = [];
        let currentPage = 1;
        
        // Scrape grants from multiple pages
        while (currentPage <= this.maxPages) {
            const pageUrl = currentPage === 1
                ? this.feedUrl
                : `${this.feedUrl}?paged=${currentPage}`;
                
            console.log(`📖 Scraping page ${currentPage}: ${pageUrl}`);
            
            try {
                const content = await this._getPageContent(pageUrl);
                const pageGrantLinks = this._extractGrantLinksFromFeed(content);

                console.log(`📄 Found ${pageGrantLinks.length} grant links on page ${currentPage}`);
                
                if (pageGrantLinks.length === 0) {
                    console.log(`🔚 No grants found on page ${currentPage}, stopping pagination`);
                    break;
                }
                
                allGrantLinks.push(...pageGrantLinks);
                
                // Check if we've reached the maximum number of grants
                if (this.maxGrantsToProcess > 0 && allGrantLinks.length >= this.maxGrantsToProcess) {
                    console.log(`🎯 Reached maximum grants limit (${this.maxGrantsToProcess}), stopping pagination`);
                    break;
                }
                
                currentPage++;
                
                // Add delay between page requests
                await this._delay(this.delayBetweenBatches);
                
            } catch (error) {
                console.error(`❌ Error scraping page ${currentPage}:`, error.message);
                break;
            }
        }

        console.log(`📊 Total grant links found: ${allGrantLinks.length}`);
        
        // Remove duplicates
        const uniqueGrantLinks = [...new Set(allGrantLinks)];
        console.log(`📊 Unique grant links: ${uniqueGrantLinks.length}`);
        
        // Limit the number of grants to process
        const grantsToProcess = this.maxGrantsToProcess > 0 
            ? uniqueGrantLinks.slice(0, this.maxGrantsToProcess)
            : uniqueGrantLinks;
            
        console.log(`🔄 Processing ${grantsToProcess.length} grants in batches of ${this.batchSize}`);
        
        // Process grants in batches
        return await this._processGrantsInBatches(grantsToProcess);
    }

    /**
     * Process grants in batches to avoid overwhelming the server
     * @param {Array} grantLinks Array of grant URLs
     * @returns {Promise<Array>} Array of processed grant data
     */
    async _processGrantsInBatches(grantLinks) {
        // Filter out URLs that already exist in the database
        const newLinks = await this._filterNewUrls(grantLinks);
        
        if (newLinks.length === 0) {
            console.log(`✅ All URLs already exist in database for ${this.name}. Skipping content extraction.`);
            return [];
        }

        console.log(`🔄 Processing ${newLinks.length} grants in batches of ${this.batchSize}`);
        
        const grants = [];
        
        for (let i = 0; i < newLinks.length; i += this.batchSize) {
            const batch = newLinks.slice(i, i + this.batchSize);
            const batchNumber = Math.floor(i / this.batchSize) + 1;
            const totalBatches = Math.ceil(newLinks.length / this.batchSize);
            
            console.log(`🔄 Processing batch ${batchNumber}/${totalBatches} (${batch.length} grants)`);
            
            // Process batch in parallel
            const batchPromises = batch.map(async (link) => {
                try {
                    return await this._extractDataFromUrl(link);
                } catch (error) {
                    console.error(`❌ Error processing grant ${link}:`, error.message);
                    return null;
                }
            });
            
            const batchResults = await Promise.all(batchPromises);
            const validResults = batchResults.filter(result => result !== null);
            
            grants.push(...validResults);
            console.log(`✅ Batch ${batchNumber} completed: ${validResults.length}/${batch.length} grants processed successfully`);
            
            // Add delay between batches (except for the last batch)
            if (i + this.batchSize < newLinks.length) {
                console.log(`⏳ Waiting ${this.delayBetweenBatches}ms before next batch...`);
                await this._delay(this.delayBetweenBatches);
            }
        }
        
        console.log(`🎉 ${this.name} scraping completed: ${grants.length} grants processed`);
        return grants;
    }

    /**
     * Add delay between requests
     * @param {number} ms Milliseconds to wait
     */
    async _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = new OpportunityDeskScraper();
