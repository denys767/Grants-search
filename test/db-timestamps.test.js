const test = require('node:test');
const assert = require('node:assert/strict');
const { ensureGrantsTimestamps } = require('../src/lib/db');

function makeConnection(columns) {
  const alters = [];
  return {
    alters,
    execute: async (sql) => {
      if (sql.startsWith('SELECT COLUMN_NAME')) return [columns];
      alters.push(sql);
      return [[]];
    }
  };
}

const goodMysql = [
  { COLUMN_NAME: 'created_at', COLUMN_DEFAULT: 'CURRENT_TIMESTAMP', EXTRA: 'DEFAULT_GENERATED' },
  { COLUMN_NAME: 'updated_at', COLUMN_DEFAULT: 'CURRENT_TIMESTAMP', EXTRA: 'DEFAULT_GENERATED on update CURRENT_TIMESTAMP' }
];

test('ensureGrantsTimestamps does nothing when defaults already exist', async () => {
  const connection = makeConnection(goodMysql);
  await ensureGrantsTimestamps(connection);
  assert.deepEqual(connection.alters, []);
});

test('ensureGrantsTimestamps accepts the MariaDB representation', async () => {
  const connection = makeConnection([
    { COLUMN_NAME: 'created_at', COLUMN_DEFAULT: 'current_timestamp()', EXTRA: '' },
    { COLUMN_NAME: 'updated_at', COLUMN_DEFAULT: 'current_timestamp()', EXTRA: 'on update current_timestamp()' }
  ]);
  await ensureGrantsTimestamps(connection);
  assert.deepEqual(connection.alters, []);
});

test('ensureGrantsTimestamps modifies columns that lack defaults', async () => {
  const connection = makeConnection([
    { COLUMN_NAME: 'created_at', COLUMN_DEFAULT: null, EXTRA: '' },
    { COLUMN_NAME: 'updated_at', COLUMN_DEFAULT: null, EXTRA: '' }
  ]);
  await ensureGrantsTimestamps(connection);
  assert.equal(connection.alters.length, 2);
  assert.match(connection.alters[0], /MODIFY COLUMN created_at .*DEFAULT CURRENT_TIMESTAMP/);
  assert.match(connection.alters[1], /MODIFY COLUMN updated_at .*ON UPDATE CURRENT_TIMESTAMP/);
});

test('ensureGrantsTimestamps fixes only updated_at when ON UPDATE is missing', async () => {
  const connection = makeConnection([
    goodMysql[0],
    { COLUMN_NAME: 'updated_at', COLUMN_DEFAULT: 'CURRENT_TIMESTAMP', EXTRA: 'DEFAULT_GENERATED' }
  ]);
  await ensureGrantsTimestamps(connection);
  assert.equal(connection.alters.length, 1);
  assert.match(connection.alters[0], /updated_at/);
});

test('ensureGrantsTimestamps adds missing columns', async () => {
  const connection = makeConnection([]);
  await ensureGrantsTimestamps(connection);
  assert.equal(connection.alters.length, 2);
  assert.match(connection.alters[0], /ADD COLUMN created_at/);
  assert.match(connection.alters[1], /ADD COLUMN updated_at/);
});
