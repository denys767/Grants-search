/**
 * Test script: prints all links discovered by scrapers without touching the DB or OpenAI.
 *
 * Usage:
 *   node test-scraper-links.js <scraper1> [scraper2] ...
 *   node test-scraper-links.js all
 *
 * Available scrapers:
 *   gurt, prostir, grantMarket, eu, opportunityDesk, bigIdea, grantSense, veteranFund, ngoNetwork, chasZmin
 *
 * Examples:
 *   node test-scraper-links.js bigIdea
 *   node test-scraper-links.js gurt prostir
 *   node test-scraper-links.js all
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const SCRAPERS = {
    gurt:            './src/scrapers/gurtScraper',
    prostir:         './src/scrapers/prostirScraper',
    grantMarket:     './src/scrapers/grantMarketScraper',
    eu:              './src/scrapers/euScraper',
    opportunityDesk: './src/scrapers/opportunityDeskScraper',
    bigIdea:         './src/scrapers/bigIdeaScraper',
    grantSense:      './src/scrapers/grantSenseScraper',
    veteranFund:     './src/scrapers/veteranFundScraper',
    ngoNetwork:      './src/scrapers/ngoNetworkScraper',
    chasZmin:        './src/scrapers/chasZminScraper',
};

async function testScraper(scraperName) {
    const scraperPath = SCRAPERS[scraperName];

    if (!scraperPath) {
        console.error(`❌ Unknown scraper: "${scraperName}"`);
        console.error(`   Available: ${Object.keys(SCRAPERS).join(', ')}`);
        return { name: scraperName, links: [], elapsed: 0, error: 'Unknown scraper' };
    }

    const scraper = require(scraperPath);
    const foundLinks = [];

    // --- Patch: skip DB filtering, return all URLs as-is ---
    scraper._filterNewUrls = async (urls) => {
        console.log(`\n🗄️  [DB check skipped] ${urls.length} URLs passed through`);
        return urls;
    };

    // --- Patch: skip OpenAI extraction, just record the URL ---
    scraper._extractDataFromUrl = async (url) => {
        foundLinks.push(url);
        return null;
    };

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🧪 Testing scraper: ${scraper.name}`);
    console.log(`🔗 Source URL: ${scraper.url}`);
    console.log('─'.repeat(60));

    const startTime = Date.now();
    let error = null;

    try {
        await scraper.scrape();
    } catch (err) {
        error = err.message;
        console.error(`\n❌ Scraper threw an error: ${err.message}`);
    } finally {
        if (scraper.cleanup) await scraper.cleanup().catch(() => {});
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n' + '─'.repeat(60));
    console.log(`📋 Links found by ${scraper.name} (${foundLinks.length} total):`);
    console.log('─'.repeat(60));
    foundLinks.forEach((link, i) => {
        console.log(`  ${String(i + 1).padStart(3)}. ${link}`);
    });
    console.log('─'.repeat(60));
    console.log(`✅ Done in ${elapsed}s — ${foundLinks.length} links discovered`);

    return { name: scraper.name, links: foundLinks, elapsed, error };
}

async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.error('Usage: node test-scraper-links.js <scraper1> [scraper2] ...');
        console.error('       node test-scraper-links.js all');
        console.error(`Available: ${Object.keys(SCRAPERS).join(', ')}`);
        process.exit(1);
    }

    const names = args[0] === 'all' ? Object.keys(SCRAPERS) : args;

    // Validate all names upfront
    const unknown = names.filter(n => !SCRAPERS[n]);
    if (unknown.length > 0) {
        console.error(`❌ Unknown scraper(s): ${unknown.join(', ')}`);
        console.error(`   Available: ${Object.keys(SCRAPERS).join(', ')}`);
        process.exit(1);
    }

    console.log(`\n🚀 Running link test for: ${names.join(', ')}`);

    const results = [];
    for (const name of names) {
        const result = await testScraper(name);
        results.push(result);
    }

    // Summary table when testing multiple scrapers
    if (results.length > 1) {
        console.log('\n' + '═'.repeat(60));
        console.log('📊 SUMMARY');
        console.log('─'.repeat(60));
        results.forEach(r => {
            const status = r.error ? '❌' : '✅';
            console.log(`  ${status}  ${r.name.padEnd(20)} ${String(r.links.length).padStart(4)} links   ${r.elapsed}s`);
        });
        const total = results.reduce((sum, r) => sum + r.links.length, 0);
        console.log('─'.repeat(60));
        console.log(`       ${'TOTAL'.padEnd(20)} ${String(total).padStart(4)} links`);
    }
}

main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
