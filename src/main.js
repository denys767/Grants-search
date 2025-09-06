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
const { logRecommendationEngineStatus } = require('./services/openai');

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
    console.log('🚀 [MAIN PROCESS] Starting grant scraping and recommendation process...');
    console.log(`📋 [MAIN PROCESS] Configured scrapers: ${sources.map(s => s.name).join(', ')}`);
    
    // Log recommendation engine configuration
    logRecommendationEngineStatus();
    
    try {
        // Ensure database table exists
        console.log('🗄️ [MAIN PROCESS] Setting up database...');
        await setupDatabase();
        
        // Clean up expired grants before scraping
        console.log('🧹 [MAIN PROCESS] Cleaning up expired grants...');
        const { cleanupExpiredGrants } = require('./lib/db');
        await cleanupExpiredGrants();
        
        const allGrants = [];
        let successCount = 0;
        let errorCount = 0;
        console.log(`🎯 [MAIN PROCESS] Starting data collection from ${sources.length} sources...`);

        for (const scraper of sources) {
            try {
                console.log(`📡 [MAIN PROCESS] Starting scraper: ${scraper.name}...`);
                const startTime = Date.now();
                const grants = await scraper.scrape();
                const endTime = Date.now();
                const duration = ((endTime - startTime) / 1000).toFixed(1);
                
                allGrants.push(...grants);
                successCount++;
                console.log(`✅ [MAIN PROCESS] ${scraper.name} completed: ${grants.length} grants collected in ${duration}s`);
            } catch (error) {
                errorCount++;
                console.error(`❌ [MAIN PROCESS] Error in ${scraper.name}:`, error.message);
            } finally {
                // Clean up browser resources for each scraper
                if (scraper.cleanup && typeof scraper.cleanup === 'function') {
                    try {
                        await scraper.cleanup();
                        console.log(`🧹 [MAIN PROCESS] Cleaned up ${scraper.name} resources`);
                    } catch (cleanupError) {
                        console.warn(`⚠️ [MAIN PROCESS] Error cleaning up ${scraper.name}: ${cleanupError.message}`);
                    }
                }
            }
        }

        console.log(`📊 [MAIN PROCESS] Data collection completed:`);
        console.log(`   • Successful scrapers: ${successCount}/${sources.length}`);
        console.log(`   • Failed scrapers: ${errorCount}/${sources.length}`);
        console.log(`   • Total grants collected: ${allGrants.length}`);

        let newlyInserted = [];
        if (allGrants.length > 0) {
            console.log(`💾 [MAIN PROCESS] Processing ${allGrants.length} collected grants...`);
            newlyInserted = await saveGrants(allGrants);
            console.log(`📈 [MAIN PROCESS] Database processing completed:`);
            console.log(`   • Total grants processed: ${allGrants.length}`);
            console.log(`   • New grants added: ${newlyInserted.length}`);
            console.log(`   • Recommendation pipeline success rate: ${((newlyInserted.length / allGrants.length) * 100).toFixed(1)}%`);
        } else {
            console.log('ℹ️ [MAIN PROCESS] No grants collected from any scraper');
        }
        
        console.log(`🎉 [MAIN PROCESS] Scraping and recommendation process completed successfully!`);
        return { allGrants, newlyInserted };
    } catch (error) {
        console.error('💥 [MAIN PROCESS] Critical error during scraping:', error.message);
        throw error;
    } finally {
        // Ensure all scrapers are cleaned up
        console.log('🧹 [MAIN PROCESS] Final cleanup of all scrapers...');
        for (const scraper of sources) {
            if (scraper.cleanup && typeof scraper.cleanup === 'function') {
                try {
                    await scraper.cleanup();
                } catch (cleanupError) {
                    console.warn(`⚠️ [MAIN PROCESS] Final cleanup error for ${scraper.name}: ${cleanupError.message}`);
                }
            }
        }
        console.log('✅ [MAIN PROCESS] All resources cleaned up');
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