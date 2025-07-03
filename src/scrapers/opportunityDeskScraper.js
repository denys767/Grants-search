const cheerio = require('cheerio');
const BaseScraper = require('./baseScraper');

class OpportunityDeskScraper extends BaseScraper {
    constructor() {
        super('OpportunityDesk', 'https://opportunitydesk.org/');
    }

    async scrape() {
        const content = await this._getPageContent(this.url);
        const $ = cheerio.load(content);
        const grantLinks = [];

        $('article .entry-title a').each((i, el) => {
            const link = $(el).attr('href');
            if (link) {
                grantLinks.push(link);
            }
        });

        console.log(`Found ${grantLinks.length} links on ${this.name}`);
        const grants = [];
        for (const link of grantLinks.slice(0, 5)) {
            const grantData = await this._extractDataFromUrl(link);
            if (grantData) {
                grants.push(grantData);
            }
        }
        return grants;
    }
}

module.exports = new OpportunityDeskScraper();
