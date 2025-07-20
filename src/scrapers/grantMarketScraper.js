const cheerio = require('cheerio');
const BaseScraper = require('./baseScraper');

class GrantMarketScraper extends BaseScraper {
    constructor() {
      super('Grant.Market', 'https://grant.market/opp');
      this.maxLoadMoreClicks = parseInt(process.env.MAX_LOAD_MORE) || parseInt(process.env.MAX_PAGES) || 20;
      this.maxGrantsToProcess = parseInt(process.env.MAX_GRANTS) || 50;
      this.batchSize = parseInt(process.env.BATCH_SIZE) || 5;
      this.delayBetweenBatches = parseInt(process.env.BATCH_DELAY) || 1000;
    }

    /**
     * Load all grants by clicking "Show More" button until it's disabled
     * @param {string} url 
     * @returns {Promise<string>} Complete HTML content with all grants
     */
    async _loadAllGrantsWithPagination(url) {
        const browser = await this._initBrowser();
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        });
        
        try {
            const page = await context.newPage();
            
            console.log(`🌐 Loading page: ${url}`);
            await page.goto(url, { 
                waitUntil: 'domcontentloaded',
                timeout: 30000 
            });
            
            // Wait for initial content to load
            await page.waitForTimeout(2000);
            
            let clickCount = 0;
            let totalGrants = 0;
            
            while (clickCount < this.maxLoadMoreClicks) {
                // Check if "Show More" button exists and is enabled
                const showMoreButton = await page.locator('button:has-text("Показати ще")').first();
                
                if (!(await showMoreButton.isVisible())) {
                    console.log('📄 "Show More" button not found, pagination complete');
                    break;
                }
                
                const isDisabled = await showMoreButton.isDisabled();
                if (isDisabled) {
                    console.log('📄 "Show More" button is disabled, reached end of grants');
                    break;
                }
                
                // Count current grants before clicking
                const currentGrants = await page.locator('a.relative.flex.flex-col.group').count();
                console.log(`📊 Current grants on page: ${currentGrants}`);
                
                try {
                    console.log(`🖱️ Clicking "Show More" button (click ${clickCount + 1}/${this.maxLoadMoreClicks})`);
                    
                    // Click the button and wait for new content to load
                    await showMoreButton.click();
                    
                    // Wait for loading to complete (look for wire:loading state to finish)
                    await page.waitForTimeout(1500);
                    
                    // Wait for new grants to appear
                    await page.waitForFunction(
                        (expectedCount) => {
                            const currentCount = document.querySelectorAll('a.relative.flex.flex-col.group').length;
                            return currentCount > expectedCount;
                        },
                        currentGrants,
                        { timeout: 10000 }
                    ).catch(() => {
                        console.log('⚠️ No new grants loaded, possibly reached the end');
                    });
                    
                    clickCount++;
                    
                    // Check if we got new grants
                    const newGrantCount = await page.locator('a.relative.flex.flex-col.group').count();
                    if (newGrantCount === currentGrants) {
                        console.log('📄 No new grants loaded, stopping pagination');
                        break;
                    }
                    
                    totalGrants = newGrantCount;
                    console.log(`✅ Loaded ${newGrantCount - currentGrants} new grants (total: ${totalGrants})`);
                    
                } catch (error) {
                    console.warn(`⚠️ Error clicking "Show More" button: ${error.message}`);
                    break;
                }
            }
            
            if (clickCount >= this.maxLoadMoreClicks) {
                console.warn(`⚠️ Reached maximum click limit (${this.maxLoadMoreClicks}), stopping pagination`);
            }
            
            console.log(`🎯 Pagination complete: clicked ${clickCount} times, total grants: ${totalGrants}`);
            
            // Get final page content
            const content = await page.content();
            return content;
            
        } finally {
            await context.close();
        }
    }

    /**
     * Validate if a link is a valid grant link based on grant.market URL structure
     * @param {string} link 
     * @returns {boolean}
     */
    _isValidGrantLink(link) {
        if (!link) return false;
        
        // Grant.market grant links follow the pattern: /opp/grant-slug
        if (link.startsWith('/opp/') && !link.includes('?') && !link.includes('#')) {
            return true;
        }
        
        // Also accept full URLs
        if (link.includes('grant.market/opp/')) {
            return true;
        }
        
        return false;
    }

    /**
     * Extract grant links with fallback selectors
     * @param {CheerioAPI} $ 
     * @returns {string[]} Array of grant URLs
     */
    _extractGrantLinks($) {
        let grantLinks = [];
        
        // Primary selector: based on your HTML sample
        $('a.relative.flex.flex-col.group').each((i, el) => {
            const link = $(el).attr('href');
            if (link && this._isValidGrantLink(link)) {
                const fullUrl = link.startsWith('http') ? link : `https://grant.market${link}`;
                grantLinks.push(fullUrl);
            }
        });
        
        if (grantLinks.length > 0) {
            console.log(`✅ Found ${grantLinks.length} links using primary selector`);
            return [...new Set(grantLinks)]; // Remove duplicates
        }
        
        // Fallback selectors if the primary one fails
        const fallbackSelectors = [
            'a[href*="/opp/"]',           // Any link containing "/opp/"
            '.items-grid a',              // Links in items grid
            'li a[href^="/opp/"]',        // List item links starting with "/opp/"
            'article a',                  // Article links
            '.grant-card a',              // Grant card links (if they use this class)
            'a.item-title'                // Original selector (fallback)
        ];
        
        for (const selector of fallbackSelectors) {
            grantLinks = [];
            $(selector).each((i, el) => {
                const link = $(el).attr('href');
                if (link && this._isValidGrantLink(link)) {
                    const fullUrl = link.startsWith('http') ? link : `https://grant.market${link}`;
                    grantLinks.push(fullUrl);
                }
            });
            
            if (grantLinks.length > 0) {
                console.log(`✅ Found ${grantLinks.length} links using fallback selector: ${selector}`);
                return [...new Set(grantLinks)]; // Remove duplicates
            }
        }
        
        console.warn(`⚠️ No grant links found with any selector on grant.market`);
        return [];
    }

    /**
     * Process URLs in parallel batches for better performance
     * @param {string[]} urls 
     * @returns {Promise<any[]>} Array of grant data
     */
    async _processUrlsInBatches(urls) {
        console.log(`🚀 Processing ${urls.length} URLs in batches of ${this.batchSize}`);
        
        const allGrants = [];
        let processedCount = 0;
        let successCount = 0;
        let errorCount = 0;
        
        for (let i = 0; i < urls.length; i += this.batchSize) {
            const batch = urls.slice(i, i + this.batchSize);
            const batchNumber = Math.floor(i / this.batchSize) + 1;
            const totalBatches = Math.ceil(urls.length / this.batchSize);
            
            console.log(`📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} URLs)`);
            
            try {
                // Process batch in parallel
                const batchResults = await Promise.allSettled(
                    batch.map(async (url) => {
                        try {
                            const grantData = await this._extractDataFromUrl(url);
                            return { url, data: grantData, success: true };
                        } catch (error) {
                            console.warn(`❌ Failed to process ${url}: ${error.message}`);
                            return { url, error: error.message, success: false };
                        }
                    })
                );
                
                // Process batch results
                batchResults.forEach((result, index) => {
                    processedCount++;
                    
                    if (result.status === 'fulfilled') {
                        if (result.value.success && result.value.data) {
                            allGrants.push(result.value.data);
                            successCount++;
                        } else {
                            errorCount++;
                        }
                    } else {
                        console.error(`🔥 Batch processing error for ${batch[index]}: ${result.reason}`);
                        errorCount++;
                    }
                });
                
                // Progress update
                const progress = (processedCount / urls.length * 100).toFixed(1);
                console.log(`📊 Progress: ${processedCount}/${urls.length} (${progress}%) - Success: ${successCount}, Errors: ${errorCount}`);
                
                // Rate limiting between batches (except for the last batch)
                if (i + this.batchSize < urls.length) {
                    console.log(`⏳ Waiting ${this.delayBetweenBatches}ms before next batch...`);
                    await new Promise(resolve => setTimeout(resolve, this.delayBetweenBatches));
                }
                
            } catch (error) {
                console.error(`🔥 Critical error processing batch ${batchNumber}: ${error.message}`);
                errorCount += batch.length;
                processedCount += batch.length;
            }
        }
        
        console.log(`🎯 Final results: ${allGrants.length} grants collected, ${successCount} successful, ${errorCount} errors`);
        return allGrants;
    }

    async scrape() {
        console.log(`🎯 Starting scraping for ${this.name} with dynamic pagination...`);
        
        try {
            // Use dynamic pagination loading instead of simple page content
            const content = await this._loadAllGrantsWithPagination(this.url);
            const $ = cheerio.load(content);
            
            // Extract grant links using enhanced method with fallbacks
            const grantLinks = this._extractGrantLinks($);
            
            if (grantLinks.length === 0) {
                console.warn(`⚠️ No grant links found for ${this.name}`);
                return [];
            }
            
            console.log(`🔗 Found ${grantLinks.length} total grant links`);
            
            // Filter out URLs that already exist in the database  
            const linksToCheck = grantLinks.slice(0, this.maxGrantsToProcess);
            console.log(`📊 Processing up to ${this.maxGrantsToProcess} grants (limited from ${grantLinks.length} total)`);
            
            const newLinks = await this._filterNewUrls(linksToCheck);
            
            if (newLinks.length === 0) {
                console.log(`✅ All URLs already exist in database for ${this.name}. Skipping content extraction.`);
                return [];
            }
            
            console.log(`📊 Database check results:`);
            console.log(`   • Total URLs found: ${grantLinks.length}`);
            console.log(`   • URLs checked: ${linksToCheck.length}`);
            console.log(`   • New URLs to process: ${newLinks.length}`);
            
            // Process grant links in parallel batches
            const grants = await this._processUrlsInBatches(newLinks);
            
            console.log(`✅ ${this.name} scraping completed: ${grants.length} grants collected`);
            return grants;
            
        } catch (error) {
            console.error(`🔥 Critical error in ${this.name} scraper: ${error.message}`);
            return [];
        }
    }
}

module.exports = new GrantMarketScraper();
