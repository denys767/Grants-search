const { chromium } = require('playwright');
const axios = require('axios');
const BaseScraper = require('./baseScraper');

function firstValue(metadata, key) {
    const value = metadata?.[key];
    return Array.isArray(value) ? value[0] : value;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

class EUScraper extends BaseScraper {
    constructor() {
        super('EU Portal', 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/calls-for-proposals?keywords=Ukraine&isExactMatch=true&status=31094501,31094502&programmePeriod=2021%20-%202027&order=DESC&pageNumber=1&pageSize=50&sortBy=startDate');
        this.maxPages = parseInt(process.env.MAX_PAGES) || 5;
        this.maxGrantsToProcess = parseInt(process.env.MAX_GRANTS) || 50;
        this.batchSize = parseInt(process.env.BATCH_SIZE) || 5;
        this.delayBetweenBatches = parseInt(process.env.BATCH_DELAY) || 1000;
        this.euContentWaitTime = parseInt(process.env.EU_CONTENT_WAIT_TIME) || 6000;
        this.euResultsTimeout = parseInt(process.env.EU_RESULTS_TIMEOUT) || 45000;
        this.apiUrl = 'https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA&text=Ukraine';
        this.apiPageSize = 50;
    }

    async _fetchApiPage(pageNumber) {
        const query = {
            bool: {
                must: [
                    { terms: { type: ['1'] } },
                    { terms: { status: ['31094501', '31094502'] } },
                    { term: { programmePeriod: '2021 - 2027' } }
                ]
            }
        };
        const form = new FormData();
        form.append('query', new Blob([JSON.stringify(query)], { type: 'application/json' }), 'query.json');
        const response = await axios.post(`${this.apiUrl}&pageSize=${this.apiPageSize}&pageNumber=${pageNumber}`, form, {
            timeout: 30000
        });
        return response.data.results || [];
    }

    _apiResultToContent(result) {
        const metadata = result.metadata || {};
        const values = [
            firstValue(metadata, 'title'),
            result.summary,
            firstValue(metadata, 'descriptionByte'),
            firstValue(metadata, 'additionalInfos'),
            firstValue(metadata, 'budgetOverview'),
            firstValue(metadata, 'actions'),
            firstValue(metadata, 'deadlineDate')
        ].filter(Boolean);
        return `<article>${escapeHtml(values.join('\n\n'))}</article>`;
    }

    async scrape() {
        console.log(`🚀 Starting ${this.name} scraping with the public Funding & Tenders API...`);
        const opportunities = new Map();

        for (let page = 1; page <= this.maxPages && opportunities.size < this.maxGrantsToProcess; page++) {
            const results = await this._fetchApiPage(page);
            if (results.length === 0) break;

            for (const result of results) {
                const metadata = result.metadata || {};
                const url = result.url;
                const status = firstValue(metadata, 'status');
                if (!url?.includes('/topic-details/') || !['31094501', '31094502'].includes(status)) continue;
                if (!opportunities.has(url)) opportunities.set(url, this._apiResultToContent(result));
            }
            if (results.length < this.apiPageSize) break;
        }

        const urls = [...opportunities.keys()].slice(0, this.maxGrantsToProcess);
        const newUrls = await this._filterNewUrls(urls);
        const grants = [];

        for (let i = 0; i < newUrls.length; i += this.batchSize) {
            const batch = newUrls.slice(i, i + this.batchSize);
            const results = await Promise.all(batch.map(url => this._processPageContent(opportunities.get(url), url)));
            grants.push(...results.filter(Boolean));
        }

        console.log(`✅ ${this.name}: ${grants.length} grants extracted from ${urls.length} API opportunities`);
        return grants;
    }

    /**
     * Custom extraction method for EU Portal that handles dynamic content loading
     * @param {string} url - The URL to extract data from
     * @returns {Promise<Object|null>} - The extracted grant data or null
     */
    async _extractDataFromUrlWithPlaywright(url) {
        const browser = await chromium.launch({ 
            headless: true,
            timeout: 60000
        });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();
        
        try {
            console.log(`🔍 Extracting data from EU Portal: ${url}`);
            
            // Navigate to the grant page
            await page.goto(url, { 
                waitUntil: 'networkidle',
                timeout: 60000 
            });
            
            // Wait for initial content to load (EU Portal specific timing)
            console.log('⏳ Waiting for EU Portal content to load...');
            await page.waitForTimeout(this.euContentWaitTime);
            
            // Wait for the page shell; content extraction below remains limited to
            // article-specific containers inherited from BaseScraper.
            try {
                // Wait for main content elements to load
                await page.waitForSelector('main, .main-content, [role="main"]', { timeout: 5000 });
            } catch (error) {
                console.log(`⚠️  Main content selector not found for ${url}, proceeding anyway`);
            }
            
            // Extract the page content after it has loaded
            const content = await page.content();
            
            // Use the parent class's content processing but with our loaded content
            return await this._processExtractedContent(content, url);
            
        } catch (error) {
            console.error(`❌ Error extracting data from EU Portal ${url}:`, error.message);
            return null;
        } finally {
            await browser.close();
        }
    }

    /**
     * Process the extracted content using the base scraper's logic
     * @param {string} content - HTML content
     * @param {string} url - The original URL
     * @returns {Promise<Object|null>} - The processed grant data
     */
    async _processExtractedContent(content, url) {
        try {
            return await this._processPageContent(content, url);
        } catch (error) {
            console.error(`❌ Error processing content for ${url}:`, error.message);
            return null;
        }
    }
}

module.exports = new EUScraper();
