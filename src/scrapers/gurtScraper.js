const cheerio = require('cheerio');
const BaseScraper = require('./baseScraper');

class GurtScraper extends BaseScraper {
    constructor() {
        super('Gurt', 'https://gurt.org.ua/news/grants/');
    }

    async scrape() {
        const content = await this._getPageContent(this.url);
        const $ = cheerio.load(content);
        const grantLinks = [];

        $('div.publication-item a').each((i, el) => {
            const link = $(el).attr('href');
            if (link && !link.startsWith('#')) {
                grantLinks.push(link);
            }
        });

        console.log(`Found ${grantLinks.length} links on ${this.name}`);
        const grants = [];
        // Process a limited number of links for testing purposes
        for (const link of grantLinks.slice(0, 5)) { 
            const grantData = await this._extractDataFromUrl(link);
            if (grantData) {
                grants.push(grantData);
            }
        }
        return grants;
    }
}

module.exports = new GurtScraper();
