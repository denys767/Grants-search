const cheerio = require('cheerio');
const BaseScraper = require('./baseScraper');

class ProstirScraper extends BaseScraper {
    constructor() {
        super('Prostir', 'https://www.prostir.ua/category/grants/');
    }

    async scrape() {
        const grantLinks = [];
        const baseUrl = 'https://www.prostir.ua/category/grants/';
        const pageUrls = [baseUrl];

        for (let i = 1; i <= 3; i++) {
            pageUrls.push(`${baseUrl}?next_page=${i}`);
        }

        for (const url of pageUrls) {
            const content = await this._getPageContent(url);
            const $ = cheerio.load(content);

            $('div.newsblock h3 a').each((i, el) => {
                const link = $(el).attr('href');
                if (link) {
                    grantLinks.push(link);
                }
            });
        }

        console.log(`Found ${grantLinks.length} links on ${this.name}`);
        const grants = [];
        for (const link of grantLinks) { 
            const grantData = await this._extractDataFromUrl(link);
            if (grantData) {
                grants.push(grantData);
            }
        }
        return grants;
    }
}

module.exports = new ProstirScraper();
