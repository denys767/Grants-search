const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const cron = require('node-cron');
const gurtScraper = require('./scrapers/gurtScraper');
const prostirScraper = require('./scrapers/prostirScraper');
const grantMarketScraper = require('./scrapers/grantMarketScraper');
const euScraper = require('./scrapers/euScraper');
const opportunityDeskScraper = require('./scrapers/opportunityDeskScraper');
const { saveGrants, setupDatabase } = require('./lib/db');
const { sendWeeklyGrants, startSlackApp, sendImmediateNewGrants } = require('./services/slack');

// Configuration
const CONFIG = {
    SCHEDULED_SCRAPING_ENABLED: process.env.ENABLE_SCHEDULED_SCRAPING === 'true',
    SCHEDULED_REPORTS_ENABLED: process.env.ENABLE_SCHEDULED_REPORTS === 'true',
    RUN_SCRAPING_ON_STARTUP: process.env.RUN_SCRAPING_ON_STARTUP === 'true',
    RUN_WEEKLY_REPORT_ON_STARTUP: process.env.RUN_WEEKLY_REPORT_ON_STARTUP === 'true'
};

const sources = [
     gurtScraper,
     prostirScraper,
     grantMarketScraper,
     euScraper,
     opportunityDeskScraper
];

async function scrapeAll() {
    console.log('🚀 Starting grant scraping process...');
    
    try {
        // Ensure database table exists
        await setupDatabase();
        
        // Clean up expired grants before scraping
        const { cleanupExpiredGrants } = require('./lib/db');
        await cleanupExpiredGrants();
        
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

        let newlyInserted = [];
        if (allGrants.length > 0) {
            newlyInserted = await saveGrants(allGrants);
            console.log(`💾 Processed ${allGrants.length} scraped grants (new: ${newlyInserted.length})`);
        } else {
            console.log('ℹ️  No grants scraped to process');
        }
        
        console.log(`📊 Scraping completed. Success: ${successCount}/${sources.length}, Errors: ${errorCount}`);
        return { allGrants, newlyInserted };
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
        console.log('📧 Preparing weekly grants report...');
        
        // Спочатку видаляємо застарілі гранти
        const { cleanupExpiredGrants } = require('./lib/db');
        await cleanupExpiredGrants();
        
        // Потім відправляємо звіт
        await sendWeeklyGrants();
        console.log('✅ Weekly report sent successfully');
    } catch (error) {
        console.error('❌ Error sending weekly report:', error.message);
    }
}

// Schedule scraping every Monday at 8 AM and send report for newly found grants
if (CONFIG.SCHEDULED_SCRAPING_ENABLED) {
    cron.schedule('0 8 * * 1', async () => {
        console.log('⏰ Running scheduled weekly grant scraping...');
        const { newlyInserted } = await scrapeAll();
        if (newlyInserted.length > 0) {
            console.log('📧 Sending report for newly found grants...');
            await sendWeeklyGrants(newlyInserted);
        } else {
            console.log('📧 No new grants found, skipping report');
        }
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
        let scrapingDone = false;
        try {
            if (CONFIG.RUN_SCRAPING_ON_STARTUP) {
                console.log('🚀 Starting scraping on startup...');
                const { newlyInserted } = await scrapeAll();
                if (newlyInserted.length > 0) {
                    await sendWeeklyGrants(newlyInserted);
                }
                scrapingDone = true;
            }
            if (CONFIG.RUN_WEEKLY_REPORT_ON_STARTUP && !scrapingDone) {
                console.log('📧 Starting weekly report on startup...');
                await handleWeeklyReport();
            }
        } catch (error) {
            console.error('❌ Error during startup tasks:', error.message);
        }
    })();
}

console.log('🎯 Grant Scraper application started successfully');

module.exports = { scrapeAll, handleWeeklyReport };
