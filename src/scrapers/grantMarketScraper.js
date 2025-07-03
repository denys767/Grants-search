const cheerio = require('cheerio');
const BaseScraper = require('./baseScraper');

class GrantMarketScraper extends BaseScraper {
    constructor() {
        super('Grant.Market', 'https://grant.market/opp?mode=fresh');
    }

    async scrape() {
        const content = await this._getPageContent(this.url);
        const $ = cheerio.load(content);
        const grantLinks = [];

        $('a.item-title').each((i, el) => {
            const link = $(el).attr('href');
            if (link) {
                const fullUrl = new URL(link, this.url).href;
                grantLinks.push(fullUrl);
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

module.exports = new GrantMarketScraper();
