const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractGrantInfo,
  isOpenAIUnavailable,
  resetOpenAIAvailability,
  CONFIG
} = require('../src/services/openai');

const sourceText = 'Достатньо довгий текст можливості для перевірки структурованого витягання даних. '.repeat(2);

function mockPost(payload, requests) {
  return async (url, body) => {
    requests.push({ url, body });
    return { data: { choices: [{ message: { content: JSON.stringify(payload) } }] } };
  };
}

test('OpenAI extraction uses the model default temperature and returns opportunity metadata', async () => {
  const requests = [];
  const result = await extractGrantInfo(sourceText, 'https://example.test/grant', {
    post: mockPost({
      title: 'Навчання менеджменту',
      deadline: '31-12-2026',
      category: 'Освіта',
      type: 'competition',
      low_budget: true,
      rejection_reason: null
    }, requests),
    saveRejectedGrant: async () => assert.fail('A valid opportunity must not be rejected')
  });

  assert.equal(CONFIG.TEMPERATURE, undefined);
  assert.equal('temperature' in requests[0].body, false);
  assert.equal(result.type, 'competition');
  assert.equal(result.low_budget, true);
  assert.match(requests[0].body.messages[0].content, /internal_kse_opportunity/);
  assert.match(requests[0].body.messages[0].content, /irrelevant_topic/);
});

test('OpenAI extraction rejects internal KSE opportunities with the dedicated reason', async () => {
  const rejections = [];
  const result = await extractGrantInfo(sourceText, 'https://example.test/internal', {
    post: mockPost({
      title: 'Come Back Home',
      deadline: null,
      category: null,
      type: 'grant',
      low_budget: false,
      rejection_reason: 'internal_kse_opportunity'
    }, []),
    saveRejectedGrant: async (...args) => rejections.push(args)
  });

  assert.equal(result, null);
  assert.deepEqual(rejections[0].slice(0, 3), [
    'https://example.test/internal',
    'Come Back Home',
    'internal_kse_opportunity'
  ]);
});

test('OpenAI extraction rejects an opportunity whose principal theme is irrelevant', async () => {
  const rejections = [];
  const result = await extractGrantInfo(sourceText, 'https://example.test/advocacy', {
    post: mockPost({
      title: 'Advocacy campaign',
      deadline: null,
      category: null,
      type: 'grant',
      low_budget: false,
      rejection_reason: 'irrelevant_topic'
    }, []),
    saveRejectedGrant: async (...args) => rejections.push(args)
  });

  assert.equal(result, null);
  assert.equal(rejections[0][2], 'irrelevant_topic');
});

test('OpenAI request failures do not blacklist an opportunity URL', async (t) => {
  resetOpenAIAvailability();
  t.after(resetOpenAIAvailability);
  let rejected = false;
  const result = await extractGrantInfo(sourceText, 'https://example.test/retry-later', {
    post: async () => {
      const error = new Error('Too many requests');
      error.response = {
        status: 429,
        data: { error: { code: 'rate_limit_exceeded', message: 'Rate limit reached.' } }
      };
      throw error;
    },
    saveRejectedGrant: async () => { rejected = true; },
    sleep: async () => {}
  });

  assert.equal(result, null);
  assert.equal(rejected, false);
  assert.equal(isOpenAIUnavailable(), false);
});

function quotaError(status, code, message) {
  const error = new Error(message);
  error.response = { status, data: { error: { code, message } } };
  return error;
}

test('exhausted credits stop further OpenAI calls until availability is reset', async (t) => {
  resetOpenAIAvailability();
  t.after(resetOpenAIAvailability);

  let calls = 0;
  let slept = false;
  const deps = {
    post: async () => {
      calls++;
      throw quotaError(429, 'insufficient_quota', 'You exceeded your current quota.');
    },
    saveRejectedGrant: async () => assert.fail('Must not blacklist on API failure'),
    sleep: async () => { slept = true; }
  };

  assert.equal(await extractGrantInfo(sourceText, 'https://example.test/a', deps), null);
  assert.equal(calls, 1);
  assert.equal(slept, false);
  assert.equal(isOpenAIUnavailable(), true);

  assert.equal(await extractGrantInfo(sourceText, 'https://example.test/b', deps), null);
  assert.equal(calls, 1);

  resetOpenAIAvailability();
  await extractGrantInfo(sourceText, 'https://example.test/c', deps);
  assert.equal(calls, 2);
});

test('an invalid API key (401) also stops further OpenAI calls', async (t) => {
  resetOpenAIAvailability();
  t.after(resetOpenAIAvailability);

  await extractGrantInfo(sourceText, 'https://example.test/auth', {
    post: async () => { throw quotaError(401, 'invalid_api_key', 'Incorrect API key'); },
    saveRejectedGrant: async () => assert.fail('Must not blacklist on API failure'),
    sleep: async () => {}
  });

  assert.equal(isOpenAIUnavailable(), true);
});
