const test = require('node:test');
const assert = require('node:assert/strict');
const Anthropic = require('@anthropic-ai/sdk');
const {
  extractGrantInfo,
  isLlmUnavailable,
  resetLlmAvailability,
  CONFIG
} = require('../src/services/llm');

const sourceText = 'Достатньо довгий текст можливості для перевірки структурованого витягання даних. '.repeat(2);
const today = new Date(2026, 9, 12);

function textResponse(payload, extra = {}) {
  return {
    stop_reason: 'end_turn',
    content: [
      { type: 'thinking', thinking: '' },
      { type: 'text', text: JSON.stringify(payload) }
    ],
    ...extra
  };
}

function mockCreate(payload, requests) {
  return async (params) => {
    requests.push(params);
    return textResponse(payload);
  };
}

function verdict(overrides) {
  return {
    title: 'Тест',
    deadline: null,
    category: null,
    type: 'grant',
    low_budget: false,
    rejection_reason: 'no_matching_category',
    ...overrides
  };
}

test('extraction calls Claude Haiku 5.5 with low effort, structured output and no sampling params', async () => {
  const requests = [];
  const result = await extractGrantInfo(sourceText, 'https://example.test/grant', {
    today,
    createMessage: mockCreate(verdict({
      title: 'Навчання менеджменту',
      deadline: '31-12-2026',
      category: 'Освіта',
      type: 'competition',
      low_budget: true,
      rejection_reason: null
    }), requests),
    saveRejectedGrant: async () => assert.fail('A valid opportunity must not be rejected')
  });

  const request = requests[0];
  assert.equal(request.model, 'claude-haiku-5-5');
  assert.equal(CONFIG.MODEL, 'claude-haiku-5-5');
  for (const key of ['temperature', 'top_p', 'top_k', 'thinking']) {
    assert.equal(key in request, false, `${key} must not be sent`);
  }
  assert.equal(request.output_config.effort, 'low');
  assert.equal(request.output_config.format.type, 'json_schema');
  assert.deepEqual(request.output_config.format.schema.properties.rejection_reason.enum.slice(-3), [
    'kse_not_service_provider',
    'expired',
    null
  ]);
  assert.equal(request.messages.at(-1).role, 'user');
  assert.match(request.system, /internal_kse_opportunity/);
  assert.match(request.system, /irrelevant_topic/);
  assert.match(request.system, /kse_not_service_provider/);
  assert.match(request.system, /Карітас/);
  // Current date is in the user message so the system prompt stays stable.
  assert.match(request.messages[0].content, /12-10-2026/);
  assert.doesNotMatch(request.system, /12-10-2026/);
  assert.equal(result.type, 'competition');
  assert.equal(result.low_budget, true);
});

test('extraction rejects internal KSE opportunities with the dedicated reason', async () => {
  const rejections = [];
  const result = await extractGrantInfo(sourceText, 'https://example.test/internal', {
    today,
    createMessage: mockCreate(verdict({ title: 'Come Back Home', rejection_reason: 'internal_kse_opportunity' }), []),
    saveRejectedGrant: async (...args) => rejections.push(args)
  });

  assert.equal(result, null);
  assert.deepEqual(rejections[0].slice(0, 3), [
    'https://example.test/internal',
    'Come Back Home',
    'internal_kse_opportunity'
  ]);
});

test('extraction rejects an opportunity whose principal theme is irrelevant', async () => {
  const rejections = [];
  const result = await extractGrantInfo(sourceText, 'https://example.test/advocacy', {
    today,
    createMessage: mockCreate(verdict({ title: 'Advocacy campaign', rejection_reason: 'irrelevant_topic' }), []),
    saveRejectedGrant: async (...args) => rejections.push(args)
  });

  assert.equal(result, null);
  assert.equal(rejections[0][2], 'irrelevant_topic');
});

test('grants paid to individuals are rejected as kse_not_service_provider', async () => {
  const rejections = [];
  const result = await extractGrantInfo(sourceText, 'https://example.test/caritas', {
    today,
    createMessage: mockCreate(verdict({
      title: 'Індивідуальний грант на перепідготовку ВПО',
      rejection_reason: 'kse_not_service_provider'
    }), []),
    saveRejectedGrant: async (...args) => rejections.push(args)
  });

  assert.equal(result, null);
  assert.deepEqual(rejections[0].slice(0, 3), [
    'https://example.test/caritas',
    'Індивідуальний грант на перепідготовку ВПО',
    'kse_not_service_provider'
  ]);
});

test('an outdated programme flagged by the model is rejected as expired', async () => {
  const rejections = [];
  const result = await extractGrantInfo(sourceText, 'https://example.test/old', {
    today,
    createMessage: mockCreate(verdict({ title: 'Програма 2016', rejection_reason: 'expired' }), []),
    saveRejectedGrant: async (...args) => rejections.push(args)
  });

  assert.equal(result, null);
  assert.equal(rejections[0][2], 'expired');
});

test('a deadline in the past overrides a category returned by the model', async () => {
  const rejections = [];
  const result = await extractGrantInfo(sourceText, 'https://example.test/past', {
    today,
    createMessage: mockCreate(verdict({
      title: 'Минулий конкурс',
      deadline: '11-10-2026',
      category: 'Освіта',
      rejection_reason: null
    }), []),
    saveRejectedGrant: async (...args) => rejections.push(args)
  });

  assert.equal(result, null);
  assert.equal(rejections[0][2], 'expired');
});

test('a deadline today is still open', async () => {
  const result = await extractGrantInfo(sourceText, 'https://example.test/today', {
    today,
    createMessage: mockCreate(verdict({ deadline: '12-10-2026', category: 'Освіта', rejection_reason: null }), []),
    saveRejectedGrant: async () => assert.fail('Must not reject')
  });

  assert.equal(result.deadline, '12-10-2026');
});

test('a refusal is an extraction failure and is not saved as a rejection', async () => {
  let calls = 0;
  const result = await extractGrantInfo(sourceText, 'https://example.test/refused', {
    today,
    createMessage: async () => {
      calls++;
      return { stop_reason: 'refusal', stop_details: { type: 'refusal', category: null }, content: [] };
    },
    saveRejectedGrant: async () => assert.fail('A refusal must not blacklist the URL'),
    sleep: async () => {}
  });

  assert.equal(result, null);
  assert.equal(calls, 1);
  assert.equal(isLlmUnavailable(), false);
});

test('API request failures do not blacklist an opportunity URL and are retried', async (t) => {
  resetLlmAvailability();
  t.after(resetLlmAvailability);
  let calls = 0;
  const result = await extractGrantInfo(sourceText, 'https://example.test/retry-later', {
    today,
    createMessage: async () => {
      calls++;
      throw new Anthropic.RateLimitError(429, { type: 'error', error: { type: 'rate_limit_error', message: 'Rate limited' } }, 'Rate limited', new Headers());
    },
    saveRejectedGrant: async () => assert.fail('Must not blacklist on API failure'),
    sleep: async () => {}
  });

  assert.equal(result, null);
  assert.equal(calls, CONFIG.RETRY_COUNT);
  assert.equal(isLlmUnavailable(), false);
});

test('overloaded (529) responses are retried and can recover', async (t) => {
  resetLlmAvailability();
  t.after(resetLlmAvailability);
  let calls = 0;
  const result = await extractGrantInfo(sourceText, 'https://example.test/overloaded', {
    today,
    createMessage: async () => {
      calls++;
      if (calls === 1) throw new Anthropic.APIError(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 'Overloaded', new Headers());
      return textResponse(verdict({ category: 'Освіта', rejection_reason: null }));
    },
    saveRejectedGrant: async () => assert.fail('Must not reject'),
    sleep: async () => {}
  });

  assert.equal(calls, 2);
  assert.equal(result.category, 'Освіта');
});

function apiError(status, message) {
  return Anthropic.APIError.generate(status, { type: 'error', error: { type: 'x', message } }, message, new Headers());
}

test('an invalid API key (401) stops further calls until availability is reset', async (t) => {
  resetLlmAvailability();
  t.after(resetLlmAvailability);

  let calls = 0;
  let slept = false;
  const deps = {
    today,
    createMessage: async () => {
      calls++;
      throw apiError(401, 'invalid x-api-key');
    },
    saveRejectedGrant: async () => assert.fail('Must not blacklist on API failure'),
    sleep: async () => { slept = true; }
  };

  assert.equal(await extractGrantInfo(sourceText, 'https://example.test/a', deps), null);
  assert.equal(calls, 1);
  assert.equal(slept, false);
  assert.equal(isLlmUnavailable(), true);

  assert.equal(await extractGrantInfo(sourceText, 'https://example.test/b', deps), null);
  assert.equal(calls, 1);

  resetLlmAvailability();
  await extractGrantInfo(sourceText, 'https://example.test/c', deps);
  assert.equal(calls, 2);
});

test('403 and an exhausted credit balance are fatal too', async (t) => {
  t.after(resetLlmAvailability);
  for (const error of [
    apiError(403, 'Forbidden'),
    apiError(400, 'Your credit balance is too low to access the Anthropic API.')
  ]) {
    resetLlmAvailability();
    let calls = 0;
    await extractGrantInfo(sourceText, 'https://example.test/fatal', {
      today,
      createMessage: async () => { calls++; throw error; },
      saveRejectedGrant: async () => assert.fail('Must not blacklist on API failure'),
      sleep: async () => {}
    });
    assert.equal(calls, 1);
    assert.equal(isLlmUnavailable(), true);
  }
});
