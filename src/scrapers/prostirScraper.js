const cheerio = require('cheerio');
const BaseScraper = require('./baseScraper');
const { getExistingUrls } = require('../lib/db');

class ProstirScraper extends BaseScraper {
    constructor() {
        super('Prostir', 'https://www.prostir.ua/category/grants/');
        this.maxPages = 4; // Safety limit for pagination
        this.batchSize = 5; // Process 3 URLs in parallel
        this.delayBetweenBatches = 500; // 1 second delay between batches
    }

    /**
     * Dynamically discovers all available pages by checking for next page button
     * @param {string} baseUrl 
     * @returns {Promise<string[]>} Array of page URLs
     */
    async _getAllPageUrls(baseUrl) {
        const urls = [baseUrl]; // Перша сторінка (без параметрів)
        
        console.log(`🔍 Discovering pages for ${this.name}...`);
        console.log(`📄 Page 1: ${baseUrl}`);
        
        // Починаємо з ?next_page=1 для другої сторінки
        for (let pageNum = 1; pageNum <= this.maxPages; pageNum++) {
            try {
                const pageUrl = `${baseUrl}?next_page=${pageNum}`;
                console.log(`🔍 Checking page ${pageNum + 1}: ${pageUrl}`);
                
                const content = await this._getPageContent(pageUrl);
                const $ = cheerio.load(content);
                
                // Перевіряємо чи є на сторінці гранти
                const grantElements = this._extractLinksFromPage($);
                
                if (grantElements.length > 0) {
                    urls.push(pageUrl);
                    console.log(`📄 Page ${pageNum + 1}: ${grantElements.length} grants found`);
                } else {
                    console.log(`🏁 Page ${pageNum + 1} has no grants, stopping pagination`);
                    break;
                }
                
                // Також перевіряємо чи є кнопка "наступна сторінка"
                const nextPageButton = $('a[href*="next_page="]').last();
                if (nextPageButton.length === 0) {
                    console.log(`🏁 No "next page" button found on page ${pageNum + 1}, stopping`);
                    break;
                }
                
                // Rate limiting між запитами
                await new Promise(resolve => setTimeout(resolve, 500));
                
            } catch (error) {
                console.warn(`⚠️ Error checking page ${pageNum + 1}: ${error.message}`);
                break;
            }
        }
        
        console.log(`📋 Total pages discovered: ${urls.length}`);
        return urls;
    }

    /**
     * Extract links from a page using the correct selectors based on prostir.ua HTML structure
     * @param {CheerioAPI} $ 
     * @returns {string[]} Array of grant URLs
     */
    _extractLinksFromPage($) {
        const links = [];
        
        // Based on the HTML sample: each grant is in <div class="newsblock"> with <h3><a href="...">
        $('.newsblock h3 a').each((i, el) => {
            const link = $(el).attr('href');
            if (link && this._isValidGrantLink(link)) {
                // Ensure absolute URL
                const absoluteUrl = link.startsWith('http') ? link : `https://www.prostir.ua${link}`;
                links.push(absoluteUrl);
            }
        });
        
        console.log(`🔗 Found ${links.length} grant links on this page`);
        return [...new Set(links)]; // Remove duplicates
    }

    /**
     * Extract links with multiple fallback selectors (keeping for compatibility)
     * @param {CheerioAPI} $ 
     * @returns {string[]} Array of grant URLs
     */
    _extractLinksWithFallback($) {
        // Try the primary selector first (based on HTML sample)
        let links = this._extractLinksFromPage($);
        
        if (links.length > 0) {
            return links;
        }
        
        // Fallback selectors if the primary one fails
        const fallbackSelectors = [
            'div.newsblock h3 a',          // Alternative spacing
            '.newsblock a[href*="grants="]', // Any link in newsblock containing "grants="
            'article h2 a',                 // Alternative article structure
            '.post-title a',                // Post title links
            '.entry-title a',               // Entry title links
            'h3 a[href*="grant"]',          // Links in h3 containing "grant"
            'a[href*="/?grants="]',         // Any link containing "/?grants="
        ];
        
        for (const selector of fallbackSelectors) {
            links = [];
            $(selector).each((i, el) => {
                const link = $(el).attr('href');
                if (link && this._isValidGrantLink(link)) {
                    // Ensure absolute URL
                    const absoluteUrl = link.startsWith('http') ? link : `https://www.prostir.ua${link}`;
                    links.push(absoluteUrl);
                }
            });
            
            if (links.length > 0) {
                console.log(`✅ Found ${links.length} links using fallback selector: ${selector}`);
                return [...new Set(links)]; // Remove duplicates
            }
        }
        
        console.warn(`⚠️ No links found with any selector on this page`);
        return [];
    }

    /**
     * Validate if a link is likely a grant link based on prostir.ua URL structure
     * @param {string} link 
     * @returns {boolean}
     */
    _isValidGrantLink(link) {
        if (!link) return false;
        
        // Prostir.ua grant links follow the pattern: /?grants=slug-name
        if (link.includes('/?grants=')) {
            return true;
        }
        
        // Filter out navigation, category, and other non-grant links
        const excludePatterns = [
            '/category/',
            '/tag/',
            '/author/',
            '/page/',
            '?next_page=',
            '#',
            'javascript:',
            'mailto:',
            '.pdf',
            '.doc',
            '.jpg',
            '.png',
            '.jpeg',
            '.gif'
        ];
        
        return !excludePatterns.some(pattern => link.includes(pattern));
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
        console.log(`🎯 Starting enhanced scraping for ${this.name}...`);
        
        try {
            const baseUrl = 'https://www.prostir.ua/category/grants/';
            
            // Step 1: Discover all available pages
            const pageUrls = await this._getAllPageUrls(baseUrl);
            
            // Step 2: Extract all grant links from all pages
            console.log(`🔗 Extracting grant links from ${pageUrls.length} pages...`);
            const allGrantLinks = [];
            
            for (const [index, url] of pageUrls.entries()) {
                try {
                    console.log(`📄 Processing page ${index + 1}/${pageUrls.length}: ${url}`);
                    const content = await this._getPageContent(url);
                    const $ = cheerio.load(content);
                    const pageLinks = this._extractLinksFromPage($);
                    allGrantLinks.push(...pageLinks);
                    
                    // Small delay between page requests
                    if (index < pageUrls.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 300));
                    }
                } catch (error) {
                    console.error(`❌ Error processing page ${url}: ${error.message}`);
                }
            }
            
            // Remove duplicates
            const uniqueGrantLinks = [...new Set(allGrantLinks)];
            console.log(`🔗 Found ${allGrantLinks.length} total links, ${uniqueGrantLinks.length} unique links`);
            
            if (uniqueGrantLinks.length === 0) {
                console.warn(`⚠️ No grant links found for ${this.name}`);
                return [];
            }
            
            // Step 3: Check which URLs are already in the database
            console.log(`🔍 Checking database for existing URLs...`);
            const existingUrls = await getExistingUrls(uniqueGrantLinks);
            const newUrls = uniqueGrantLinks.filter(url => !existingUrls.has(url));
            
            console.log(`📊 Database check results:`);
            console.log(`   • Total unique URLs: ${uniqueGrantLinks.length}`);
            console.log(`   • Already in database: ${existingUrls.size}`);
            console.log(`   • New URLs to process: ${newUrls.length}`);
            
            if (newUrls.length === 0) {
                console.log(`✅ All URLs already exist in database. Skipping content extraction.`);
                return [];
            }
            
            // Step 4: Process only new grant links in parallel batches
            const grants = await this._processUrlsInBatches(newUrls);
            
            console.log(`✅ ${this.name} scraping completed: ${grants.length} grants collected`);
            return grants;
            
        } catch (error) {
            console.error(`🔥 Critical error in ${this.name} scraper: ${error.message}`);
            return [];
        }
    }
}

module.exports = new ProstirScraper();