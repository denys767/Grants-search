const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const cron = require('node-cron');
const gurtScraper = require('./scrapers/gurtScraper');
const prostirScraper = require('./scrapers/prostirScraper');
const grantMarketScraper = require('./scrapers/grantMarketScraper');
const euScraper = require('./scrapers/euScraper');
const opportunityDeskScraper = require('./scrapers/opportunityDeskScraper');
const { saveGrants, setupDatabase } = require('./lib/db');
const { sendWeeklyGrants, startSlackApp } = require('./services/slack');

// Configuration
const CONFIG = {
    SCHEDULED_SCRAPING_ENABLED: process.env.ENABLE_SCHEDULED_SCRAPING === 'true',
    SCHEDULED_REPORTS_ENABLED: process.env.ENABLE_SCHEDULED_REPORTS === 'true',
    RUN_SCRAPING_ON_STARTUP: process.env.RUN_SCRAPING_ON_STARTUP === 'true',
    RUN_WEEKLY_REPORT_ON_STARTUP: process.env.RUN_WEEKLY_REPORT_ON_STARTUP === 'true'
};

const sources = [
    // gurtScraper,
   // prostirScraper,
    grantMarketScraper
    // euScraper,
    // opportunityDeskScraper
];

async function scrapeAll() {
    console.log('🚀 Starting grant scraping process...');
    
    try {
        // Ensure database table exists
        await setupDatabase();
        
        const allGrants = [];
        let successCount = 0;
        let errorCount = 0;

        for (const scraper of sources) {
            try {
                console.log(`📡 Scraping ${scraper.name}...`);
                const grants = await scraper.scrape();
                allGrants.push(...grants);
                successCount++;
                console.log(`✅ ${scraper.name}: ${grants.length} grants found`);
            } catch (error) {
                errorCount++;
                console.error(`❌ Error scraping ${scraper.name}:`, error.message);
            } finally {
                // Clean up browser resources for each scraper
                if (scraper.cleanup && typeof scraper.cleanup === 'function') {
                    try {
                        await scraper.cleanup();
                    } catch (cleanupError) {
                        console.warn(`⚠️ Error cleaning up ${scraper.name}: ${cleanupError.message}`);
                    }
                }
            }
        }

        if (allGrants.length > 0) {
            await saveGrants(allGrants);
            console.log(`💾 Saved ${allGrants.length} grants to database`);
        } else {
            console.log('ℹ️  No new grants found to save');
        }
        
        console.log(`📊 Scraping completed. Success: ${successCount}/${sources.length}, Errors: ${errorCount}`);
        return allGrants;
    } catch (error) {
        console.error('💥 Critical error during scraping:', error.message);
        throw error;
    } finally {
        // Ensure all scrapers are cleaned up
        console.log('🧹 Final cleanup of all scrapers...');
        for (const scraper of sources) {
            if (scraper.cleanup && typeof scraper.cleanup === 'function') {
                try {
                    await scraper.cleanup();
                } catch (cleanupError) {
                    console.warn(`⚠️ Final cleanup error for ${scraper.name}: ${cleanupError.message}`);
                }
            }
        }
    }
}

async function handleWeeklyReport() {
    try {
        console.log('📧 Sending weekly grants report...');
        await sendWeeklyGrants();
        console.log('✅ Weekly report sent successfully');
    } catch (error) {
        console.error('❌ Error sending weekly report:', error.message);
    }
}

// Schedule scraping every Monday at 8 AM
if (CONFIG.SCHEDULED_SCRAPING_ENABLED) {
    cron.schedule('0 8 * * 1', async () => {
        console.log('⏰ Running scheduled weekly grant scraping...');
        await scrapeAll();
    });
}

// Schedule weekly report every Monday at 9 AM (after scraping)
if (CONFIG.SCHEDULED_REPORTS_ENABLED) {
    cron.schedule('0 9 * * 1', async () => {
        console.log('⏰ Running scheduled weekly report...');
        await handleWeeklyReport();
    });
}

// Graceful shutdown handling
process.on('SIGINT', async () => {
    console.log('🛑 Received SIGINT, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('🛑 Received SIGTERM, shutting down gracefully...');
    process.exit(0);
});

// Start the Slack App
startSlackApp().catch(error => {
    console.error('💥 Failed to start Slack app:', error.message);
    process.exit(1);
});

// Run startup tasks if enabled
if (CONFIG.RUN_SCRAPING_ON_STARTUP || CONFIG.RUN_WEEKLY_REPORT_ON_STARTUP) {
    console.log('🔄 Running startup tasks...');
    
    (async () => {
        try {
            if (CONFIG.RUN_SCRAPING_ON_STARTUP) {
                console.log('🚀 Starting scraping on startup...');
                await scrapeAll();
            }
            
            if (CONFIG.RUN_WEEKLY_REPORT_ON_STARTUP) {
                console.log('📧 Starting weekly report on startup...');
                await handleWeeklyReport();
            }
        } catch (error) {
            console.error('❌ Error during startup tasks:', error.message);
        }
    })();
}

console.log('🎯 Grant Scraper application started successfully');

// Export functions for testing
module.exports = { scrapeAll, handleWeeklyReport };