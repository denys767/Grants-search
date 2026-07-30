const test = require('node:test');
const assert = require('node:assert/strict');
const scraper = require('../src/scrapers/opportunityDeskScraper');

test('OpportunityDesk extracts article URLs from the public RSS feed rendered in a pre element', () => {
  const content = `
    <html><body><pre>&lt;rss&gt;&lt;channel&gt;
      &lt;item&gt;&lt;link&gt;https://opportunitydesk.org/2026/07/29/example-grant/&lt;/link&gt;&lt;/item&gt;
      &lt;item&gt;&lt;link&gt;https://opportunitydesk.org/2026/07/28/another-grant/&lt;/link&gt;&lt;/item&gt;
      &lt;item&gt;&lt;link&gt;https://example.test/not-an-opportunity/&lt;/link&gt;&lt;/item&gt;
    &lt;/channel&gt;&lt;/rss&gt;</pre></body></html>
  `;

  assert.deepEqual(scraper._extractGrantLinksFromFeed(content), [
    'https://opportunitydesk.org/2026/07/29/example-grant/',
    'https://opportunitydesk.org/2026/07/28/another-grant/'
  ]);
});
