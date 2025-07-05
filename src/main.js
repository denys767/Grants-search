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

const sources = [
    // gurtScraper,
    prostirScraper,
    // grantMarketScraper,
    // euScraper,
    // opportunityDeskScraper
];

async function scrapeAll() {
    console.log('Scraping started...');
    
    // Ensure database table exists
    await setupDatabase();
    
    const allGrants = [];
    for (const scraper of sources) {
        try {
            const grants = await scraper.scrape();
            allGrants.push(...grants);
        } catch (error) {
            console.error(`Error scraping ${scraper.name}:`, error);
        }
    }

    if (allGrants.length > 0) {
        await saveGrants(allGrants);
    }
    console.log('Scraping finished.');
}

cron.schedule('0 9 * * 1', () => { // Every Monday at 9 AM
    console.log('Running weekly grant scraping and notification job.');
    scrapeAll();
    sendWeeklyGrants();
});

// Start the Slack App
startSlackApp();

// Optional: Run once on startup for testing
// scrapeAll();
// sendWeeklyGrants();