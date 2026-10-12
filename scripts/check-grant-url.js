#!/usr/bin/env node
/**
 * Live check: fetch grant pages and run them through the LLM filter without
 * touching the database. Needs ANTHROPIC_API_KEY (env or .env).
 *
 *   node scripts/check-grant-url.js <url> [<url>...]
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const cheerio = require('cheerio');
const BaseScraper = require('../src/scrapers/baseScraper');
const llm = require('../src/services/llm');

async function fetchText(url) {
  const { data: html } = await axios.get(url, {
    timeout: 30000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
  });
  const $ = cheerio.load(html);
  // Same primary selector as BigIdeaScraper
  const bigIdeaText = $('.opportunity-detail-description').text().trim();
  if (bigIdeaText.length >= 50) return bigIdeaText;
  return BaseScraper.extractMainArticleText(html);
}

async function main() {
  const urls = process.argv.slice(2);
  if (!urls.length) {
    console.error('Usage: node scripts/check-grant-url.js <url> [<url>...]');
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set');
    process.exit(1);
  }
  const client = new Anthropic({ maxRetries: 0, timeout: 60000 });

  for (const url of urls) {
    console.log(`\n=== ${url}`);
    let text;
    try {
      text = await fetchText(url);
    } catch (error) {
      console.error(`Fetch failed: ${error.message}`);
      continue;
    }
    console.log(`Extracted ${text.length} characters`);

    let raw = null;
    const result = await llm.extractGrantInfo(text, url, {
      saveRejectedGrant: async () => {},
      createMessage: async (params) => {
        const response = await client.messages.create(params);
        raw = response.content.find(block => block.type === 'text')?.text ?? `(stop_reason: ${response.stop_reason})`;
        return response;
      }
    });
    console.log('Model output:', raw);
    console.log('Verdict:', result ? `ACCEPTED (${result.category})` : 'REJECTED / failed (see log above)');
  }
}

main();
