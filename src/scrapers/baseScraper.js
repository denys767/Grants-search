const playwright = require('playwright');
const cheerio = require('cheerio');
const { extractGrantInfo } = require('../services/openai');
const { getExistingUrls, saveRejectedGrant } = require('../lib/db');

class BaseScraper {
  constructor(name, url) {
    this.name = name;
    this.url = url;
    this.browser = null;
    this.retryAttempts = 3;
    this.timeoutMs = 30000;
  }

  async scrape() {
    throw new Error('Scrape method not implemented');
  }

  /**
   * Initialize browser instance (reused across requests)
   */
  async _initBrowser() {
    if (!this.browser) {
      this.browser = await playwright.chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    }
    return this.browser;
  }

  /**
   * Enhanced page content retrieval with retry logic and error handling
   */
  async _getPageContent(url, retries = this.retryAttempts) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      let context = null;
      try {
        const browser = await this._initBrowser();
        context = await browser.newContext({
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        });
        
        const page = await context.newPage();
        
        // Set timeout and navigation options
        await page.goto(url, { 
          waitUntil: 'domcontentloaded',
          timeout: this.timeoutMs 
        });
        
        // Wait a bit for dynamic content to load
        await page.waitForTimeout(1000);
        
        const content = await page.content();
        await context.close();
        
        return content;
        
      } catch (error) {
        if (context) {
          try {
            await context.close();
          } catch (closeError) {
            console.warn(`Failed to close context: ${closeError.message}`);
          }
        }
        
        console.warn(`Attempt ${attempt}/${retries} failed for ${url}: ${error.message}`);
        
        if (attempt === retries) {
          throw new Error(`Failed to load ${url} after ${retries} attempts: ${error.message}`);
        }
        
        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        console.log(`⏳ Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  async _extractDataFromUrl(url) {
    try {
      console.log(`🔍 [DATA EXTRACTION] Starting content extraction from ${url}`);
      const pageContent = await this._getPageContent(url);
      const $ = cheerio.load(pageContent);

      // Enhanced content extraction with multiple fallbacks
      const contentSelectors = [
        'article',
        '.post-content', 
        '.entry-content',
        '.content',
        'main',
        '.main-content',
        '#content',
        'body'
      ];
      
      console.log(`🔧 [DATA EXTRACTION] Trying ${contentSelectors.length} content selectors for meaningful text extraction`);
      
      let articleText = '';
      let usedSelector = '';
      for (const selector of contentSelectors) {
        const text = $(selector).text().trim();
        if (text && text.length > 100) { // Ensure meaningful content
          articleText = text;
          usedSelector = selector;
          break;
        }
      }

      if (!articleText) {
        console.warn(`❌ [DATA EXTRACTION] No meaningful content found on ${url} using any selector`);
        // Save to rejected grants table
        await saveRejectedGrant(url, null, 'no_meaningful_content');
        throw new Error('No meaningful content found on the page');
      }

      console.log(`✅ [DATA EXTRACTION] Successfully extracted content using selector: "${usedSelector}"`);

      // Limit text length to avoid OpenAI token limits
      const maxTextLength = 20000;
      if (articleText.length > maxTextLength) {
        console.log(`✂️ [DATA EXTRACTION] Truncating text from ${articleText.length} to ${maxTextLength} characters`);
        articleText = articleText.substring(0, maxTextLength) + '...';
      }

      console.log(`📄 [DATA EXTRACTION] Extracted text length: ${articleText.length} characters`);
      console.log(`📤 [DATA EXTRACTION] Sending to recommendation engine for AI analysis...`);
      
      const grantInfo = await extractGrantInfo(articleText, url);
      
      if (grantInfo) {
        console.log(`✅ [DATA EXTRACTION] Successfully extracted and categorized grant info from ${url}`);
      } else {
        console.warn(`⚠️ [DATA EXTRACTION] AI recommendation engine returned null for ${url} (likely filtered out)`);
      }
      
      return grantInfo;
    } catch (error) {
      console.error(`❌ [DATA EXTRACTION] Error extracting data from ${url}:`, error.message);
      return null;
    }
  }

  /**
   * Filter out URLs that already exist in the database
   * @param {string[]} urls Array of URLs to check
   * @returns {Promise<string[]>} Array of new URLs not in database
   */
  async _filterNewUrls(urls) {
    if (!urls || urls.length === 0) {
      return [];
    }

    try {
      console.log(`🔍 [URL FILTERING] Checking ${urls.length} URLs against database...`);
      const existingUrls = await getExistingUrls(urls);
      const newUrls = urls.filter(url => !existingUrls.has(url));
      
      console.log(`📊 [URL FILTERING] Results for ${this.name}:`);
      console.log(`   • Total URLs: ${urls.length}`);
      console.log(`   • Already in database: ${existingUrls.size}`);
      console.log(`   • New URLs to process: ${newUrls.length}`);
      
      if (newUrls.length === 0) {
        console.log(`✅ [URL FILTERING] All URLs already processed - skipping content extraction phase`);
      } else {
        console.log(`🎯 [URL FILTERING] Found ${newUrls.length} new URLs requiring recommendation analysis`);
      }
      
      return newUrls;
    } catch (error) {
      console.error(`❌ [URL FILTERING] Error filtering URLs for ${this.name}:`, error.message);
      console.log(`⚠️ [URL FILTERING] Proceeding with all URLs due to database error`);
      return urls; // Return all URLs if database check fails
    }
  }

  /**
   * Clean up browser resources
   */
  async cleanup() {
    if (this.browser) {
      try {
        await this.browser.close();
        console.log(`🧹 Browser cleaned up for ${this.name}`);
      } catch (error) {
        console.warn(`⚠️ Error closing browser for ${this.name}: ${error.message}`);
      } finally {
        this.browser = null;
      }
    }
  }
}

module.exports = BaseScraper;