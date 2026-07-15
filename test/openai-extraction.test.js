const test = require('node:test');
const assert = require('node:assert/strict');
const { extractGrantInfo, CONFIG } = require('../src/services/openai');

const sourceText = 'Достатньо довгий текст можливості для перевірки структурованого витягання даних. '.repeat(2);

function mockPost(payload, requests) {
  return async (url, body) => {
    requests.push({ url, body });
    return { data: { choices: [{ message: { content: JSON.stringify(payload) } }] } };
  };
}

test('OpenAI extraction sends low temperature and returns opportunity metadata', async () => {
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

  assert.equal(CONFIG.TEMPERATURE, 0.2);
  assert.equal(requests[0].body.temperature, 0.2);
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
