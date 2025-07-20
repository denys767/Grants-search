const { chromium } = require('playwright');
const BaseScraper = require('./baseScraper');

class EUScraper extends BaseScraper {
    constructor() {
        super('EU Portal', 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/calls-for-proposals?keywords=Ukraine&isExactMatch=true&status=31094501,31094502&programmePeriod=2021%20-%202027&order=DESC&pageNumber=1&pageSize=50&sortBy=startDate');
        this.maxPages = parseInt(process.env.MAX_PAGES) || 5;
        this.maxGrantsToProcess = parseInt(process.env.MAX_GRANTS) || 50;
        this.batchSize = parseInt(process.env.BATCH_SIZE) || 5;
        this.delayBetweenBatches = parseInt(process.env.BATCH_DELAY) || 1000;
    }

    async scrape() {
        console.log(`🚀 Starting ${this.name} scraping with Playwright...`);
        
        const browser = await chromium.launch({ 
            headless: true,
            timeout: 60000
        });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();
        
        let allGrantLinks = [];
        let currentPage = 1;
        
        try {
            while (currentPage <= this.maxPages) {
                console.log(`📄 Processing page ${currentPage}/${this.maxPages}`);
                
                // Construct URL for current page
                const pageUrl = this.url.replace('pageNumber=1', `pageNumber=${currentPage}`);
                console.log(`🔗 Navigating to: ${pageUrl}`);
                
                await page.goto(pageUrl, { 
                    waitUntil: 'networkidle',
                    timeout: 60000 
                });
                
                // Wait for content to load (2-4 seconds as mentioned)
                console.log('⏳ Waiting for initial page load...');
                await page.waitForTimeout(4000);
                
                // Wait for loading animations to end and content to appear
                console.log('⏳ Waiting for loading animations to end...');
                try {
                    // Wait for the main content container to appear
                    await page.waitForSelector('sedia-result-card-calls-for-proposals', { timeout: 10000 });
                    
                    // Wait for any loading spinners to disappear
                    await page.waitForFunction(() => {
                        const spinners = document.querySelectorAll('.eui-icon-spinner, [class*="loading"], [class*="spinner"]');
                        return spinners.length === 0 || Array.from(spinners).every(spinner => 
                            spinner.style.display === 'none' || 
                            !spinner.offsetParent
                        );
                    }, { timeout: 15000 });
                    
                    // Additional wait to ensure content is stable
                    await page.waitForTimeout(2000);
                    
                } catch (error) {
                    console.log(`⚠️  Timeout waiting for content on page ${currentPage}, proceeding anyway`);
                }
                
                // Extract grant links using the correct selectors based on HTML structure
                const pageLinks = await page.$$eval(
                    'eui-card-header-title a.eui-u-text-link', 
                    links => links.map(link => link.href)
                );
                
                console.log(`📋 Found ${pageLinks.length} grant links on page ${currentPage}`);
                
                if (pageLinks.length === 0) {
                    console.log(`⚠️  No grants found on page ${currentPage}, stopping pagination`);
                    break;
                }
                
                allGrantLinks.push(...pageLinks);
                
                // Check if we've reached the maximum number of grants
                if (this.maxGrantsToProcess > 0 && allGrantLinks.length >= this.maxGrantsToProcess) {
                    console.log(`✅ Reached maximum grants limit (${this.maxGrantsToProcess}), stopping pagination`);
                    break;
                }
                
                // Check if there's a next page by looking for pagination controls
                const hasNextPage = await page.$eval('eui-paginator', (paginator) => {
                    // Check if next page button is enabled (not disabled)
                    const nextButton = paginator.querySelector('button[aria-label*="next"], button[aria-label*="Next"]');
                    return nextButton && !nextButton.disabled;
                }).catch(() => false);
                
                if (!hasNextPage) {
                    console.log(`⚠️  No next page available on page ${currentPage}, stopping pagination`);
                    break;
                }
                
                currentPage++;
                
                // Add delay between pages
                console.log('⏳ Waiting before next page...');
                await page.waitForTimeout(3000);
            }
        } catch (error) {
            console.error(`❌ Error during EU Portal scraping:`, error.message);
        } finally {
            await browser.close();
        }
        
        console.log(`📊 Total grant links found: ${allGrantLinks.length}`);
        const uniqueLinks = [...new Set(allGrantLinks)];
        console.log(`📊 Unique grant links: ${uniqueLinks.length}`);

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
        
        // Process grants in batches using the base scraper's method
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
