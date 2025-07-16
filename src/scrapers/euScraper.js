const cheerio = require('cheerio');
const BaseScraper = require('./baseScraper');

class EUScraper extends BaseScraper {
    constructor() {
        super('EU Portal', 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/calls-for-proposals?order=DESC&pageNumber=1&pageSize=50&sortBy=startDate&keywords=Ukraine&isExactMatch=true&status=31094501,31094502&programmePeriod=2021%20-%202027');
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

        // Filter out URLs that already exist in the database
        const newLinks = await this._filterNewUrls(uniqueLinks.slice(0, 5));
        
        if (newLinks.length === 0) {
            console.log(`✅ All URLs already exist in database for ${this.name}. Skipping content extraction.`);
            return [];
        }

        const grants = [];
        for (const link of newLinks) {
            const grantData = await this._extractDataFromUrl(link);
            if (grantData) {
                grants.push(grantData);
            }
        }
        return grants;
    }
}

module.exports = new EUScraper();
