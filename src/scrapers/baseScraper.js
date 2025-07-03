const playwright = require('playwright');
const cheerio = require('cheerio');
const { extractGrantInfo } = require('../services/openai');

class BaseScraper {
    constructor(name, url) {
        this.name = name;
        this.url = url;
    }

    async scrape() {
        throw new Error('Scrape method not implemented');
    }

    async _getPageContent(url) {
        const browser = await playwright.chromium.launch();
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        const content = await page.content();
        await browser.close();
        return content;
    }

    async _extractDataFromUrl(url) {
        try {
            console.log(`Scraping content from ${url}`);
            const pageContent = await this._getPageContent(url);
            const $ = cheerio.load(pageContent);

            // Try to find the main content of the article
            const articleText = $('article').text() || $('.post-content').text() || $('.entry-content').text() || $('body').text();
            
            console.log(`Extracted text length: ${articleText.length}`);
            console.log(`First 5000 chars of extracted text: ${articleText.substring(0, 5000)}...`);

            const grantInfo = await extractGrantInfo(articleText, url);
            console.log('Received from OpenAI:', grantInfo);
            return grantInfo;
        } catch (error) {
            console.error(`Error extracting data from ${url}:`, error);
            return null;
        }
    }
}

module.exports = BaseScraper;
