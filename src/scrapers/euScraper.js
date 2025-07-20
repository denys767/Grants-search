const cheerio = require('cheerio');
const BaseScraper = require('./baseScraper');

class EUScraper extends BaseScraper {
    constructor() {
        super('EU Portal', 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/calls-for-proposals?order=DESC&pageNumber=1&pageSize=50&sortBy=startDate&keywords=Ukraine&isExactMatch=true&status=31094501,31094502&programmePeriod=2021%20-%202027');
        this.maxGrantsToProcess = parseInt(process.env.MAX_GRANTS) || 50;
        this.batchSize = parseInt(process.env.BATCH_SIZE) || 5;
        this.delayBetweenBatches = parseInt(process.env.BATCH_DELAY) || 1000;
    }

    async scrape() {
        const content = await this._getPageContent(this.url);
        const $ = cheerio.load(content);
        const grantLinks = [];

        $('a.ng-star-inserted').each((i, el) => {
            const link = $(el).attr('href');
            if (link && link.includes('/opportunities/portal/screen/opportunities/topic-details/')) {
                const fullUrl = new URL(link, 'https://ec.europa.eu').href;
                grantLinks.push(fullUrl);
            }
        });

        console.log(`Found ${grantLinks.length} links on ${this.name}`);
        const uniqueLinks = [...new Set(grantLinks)];
        console.log(`Found ${uniqueLinks.length} unique links on ${this.name}`);

        // Apply max grants limit
        const limitedLinks = this.maxGrantsToProcess > 0 
            ? uniqueLinks.slice(0, this.maxGrantsToProcess)
            : uniqueLinks;

        // Filter out URLs that already exist in the database
        const newLinks = await this._filterNewUrls(limitedLinks);
        
        if (newLinks.length === 0) {
            console.log(`✅ All URLs already exist in database for ${this.name}. Skipping content extraction.`);
            return [];
        }

        console.log(`🔄 Processing ${newLinks.length} grants in batches of ${this.batchSize}`);
        
        // Process grants in batches
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
                await new Promise(resolve => setTimeout(resolve, this.delayBetweenBatches));
            }
        }
        
        return grants;
    }
}

module.exports = new EUScraper();
