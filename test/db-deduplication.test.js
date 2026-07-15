const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeGrantTitle, saveGrants } = require('../src/lib/db');

test('normalizeGrantTitle ignores case, punctuation, and repeated whitespace', () => {
  assert.equal(
    normalizeGrantTitle('  Visegrad+ — Пакети   культурних продуктів! '),
    'visegrad пакети культурних продуктів'
  );
});

test('saveGrants rejects a new URL with an existing normalized title', async () => {
  const executed = [];
  const rejections = [];
  const connection = {
    beginTransaction: async () => executed.push('begin'),
    commit: async () => executed.push('commit'),
    rollback: async () => executed.push('rollback'),
    execute: async (sql, params = []) => {
      executed.push({ sql, params });
      if (sql === 'SELECT id FROM grants WHERE url = ?') return [[]];
      if (sql.startsWith('SELECT id FROM grants WHERE normalized_title')) return [[{ id: 17 }]];
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  const inserted = await saveGrants([{
    title: 'Visegrad+ — Пакети культурних продуктів',
    url: 'https://secondary.example/grant',
    deadline: null,
    category: 'Освіта'
  }], {
    connection,
    saveRejectedGrant: async (...args) => rejections.push(args)
  });

  assert.deepEqual(inserted, []);
  assert.deepEqual(rejections[0], [
    'https://secondary.example/grant',
    'Visegrad+ — Пакети культурних продуктів',
    'duplicate_title'
  ]);
  assert.ok(executed.includes('commit'));
});

test('saveGrants updates an existing URL with type and low_budget metadata', async () => {
  const executed = [];
  const connection = {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    execute: async (sql, params = []) => {
      executed.push({ sql, params });
      if (sql === 'SELECT id FROM grants WHERE url = ?') return [[{ id: 3 }]];
      if (sql.startsWith('UPDATE grants SET')) return [{}];
      throw new Error(`Unexpected query: ${sql}`);
    }
  };

  await saveGrants([{
    title: 'Оновлений конкурс',
    url: 'https://example.test/existing',
    deadline: null,
    category: 'Освіта',
    type: 'tender',
    low_budget: true
  }], { connection });

  const update = executed.find(query => query.sql.startsWith('UPDATE grants SET'));
  assert.match(update.sql, /type = \?, low_budget = \?/);
  assert.equal(update.params[4], 'tender');
  assert.equal(update.params[5], 1);
});
