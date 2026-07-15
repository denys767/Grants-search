const test = require('node:test');
const assert = require('node:assert/strict');
const { formatOpportunityType, formatGrantMetadata } = require('../src/services/grantFormatting');

test('Slack metadata displays type and low-budget label', () => {
  assert.equal(formatOpportunityType('competition'), 'Конкурс');
  assert.equal(formatOpportunityType('unknown'), 'Грант');
  assert.equal(
    formatGrantMetadata({ type: 'tender', low_budget: true }),
    'Тип: Тендер\n⚠️ low_budget'
  );
  assert.equal(
    formatGrantMetadata({ type: 'grant', low_budget: false }, true),
    ' | Тип: Грант'
  );
});
