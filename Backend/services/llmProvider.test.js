const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyQuestion, generateAnswer, getProviderConfig, getProviderConfigs, requestText, resetProviderCooldowns } = require('./llmProvider');

const jsonResponse = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });

test('provider config selects only the configured server-side key and default model', () => {
  resetProviderCooldowns();
  assert.deepEqual(getProviderConfig('deepseek', { AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'secret' }), {
    provider: 'deepseek', label: 'DeepSeek', apiKey: 'secret', model: 'deepseek-flash',
  });
  assert.deepEqual(getProviderConfigs({ AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'g', OPENAI_API_KEY: 'o', DEEPSEEK_API_KEY: 'd' }).map(({ provider }) => provider), ['gemini', 'openai', 'deepseek']);
});

test('write requests are rejected before an LLM network call', async () => {
  resetProviderCooldowns();
  const intent = await classifyQuestion('Please enroll this student', [], { fetchImpl: async () => { throw new Error('network should not be called'); } });
  assert.equal(intent.intent, 'write_action');
});

test('classifies with Gemini JSON response and does not include any database records', async () => {
  resetProviderCooldowns();
  let request;
  const intent = await classifyQuestion('How much fee is outstanding?', [], {
    env: { AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-key' },
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return jsonResponse({ candidates: [{ content: { parts: [{ text: '{"intent":"fees"}' }] } }] });
    },
  });
  assert.equal(intent.intent, 'fees');
  assert.equal(intent.providerLabel, 'Gemini');
  assert.match(request.url, /models\/gemini-3\.8-flash:generateContent$/);
  assert.equal(request.options.headers['x-goog-api-key'], 'test-key');
  assert.doesNotMatch(request.body.contents[0].parts[0].text, /studentDocId|feeRecords/);
});

test('uses OpenAI-compatible DeepSeek endpoint and JSON response format', async () => {
  resetProviderCooldowns();
  let request;
  const result = await requestText('{"question":"x"}', 'system', {
    json: true,
    env: { AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'test-key' },
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return jsonResponse({ choices: [{ message: { content: '{"intent":"counts"}' } }] });
    },
  });
  assert.equal(result.text, '{"intent":"counts"}');
  assert.equal(result.provider, 'deepseek');
  assert.equal(request.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(request.body.response_format.type, 'json_object');
  assert.deepEqual(request.body.thinking, { type: 'disabled' });
  assert.equal(request.options.headers.Authorization, 'Bearer test-key');
});

test('falls back to the verified summary if the generated answer adds unsupported numbers', async () => {
  resetProviderCooldowns();
  const answer = await generateAnswer('How many students?', 'There are 4 students in this scope.', {
    env: { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'test-key' },
    fetchImpl: async () => jsonResponse({ choices: [{ message: { content: 'There are 5 students in this scope.' } }] }),
  });
  assert.equal(answer.answer, 'There are 4 students in this scope.');
  assert.equal(answer.providerLabel, 'OpenAI');
});

test('keeps generated answers to at most four short lines', async () => {
  resetProviderCooldowns();
  const answer = await generateAnswer('Summarize the records', 'There are 4 active students.', {
    env: { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'test-key' },
    fetchImpl: async () => jsonResponse({ choices: [{ message: { content: 'There are 4 active students.\nThey are currently enrolled.\nThe records are current.\nNo action is needed.\nHere is an extra sentence.' } }] }),
  });
  assert.equal(answer.answer.split('\n').length, 4);
  assert.doesNotMatch(answer.answer, /extra sentence/i);
});

test('provider failures are sanitized and never include response body text', async () => {
  resetProviderCooldowns();
  await assert.rejects(requestText('question', 'system', {
    env: { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'test-key' },
    fetchImpl: async () => jsonResponse({ error: 'sensitive request body' }, 401),
  }), (error) => error.code === 'AI_PROVIDERS_FAILED' && !error.message.includes('sensitive request body'));
});

test('reports safe provider HTTP diagnostics while redacting secret-like values', async () => {
  resetProviderCooldowns();
  await assert.rejects(requestText('question', 'system', {
    env: { AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'test-secret-key-should-not-appear' },
    fetchImpl: async () => jsonResponse({ error: { message: 'Unknown model; token test-secret-key-should-not-appear' } }, 400),
  }), (error) => error.code === 'AI_PROVIDERS_FAILED'
    && error.message.includes('HTTP 400: invalid request format')
    && error.message.includes('Unknown model')
    && !error.message.includes('test-secret-key-should-not-appear'));
});

test('falls through a rejected primary key and uses the next configured provider', async () => {
  resetProviderCooldowns();
  const calls = [];
  const result = await requestText('question', 'system', {
    env: { AI_PROVIDER: 'gemini', AI_FALLBACK_PROVIDERS: 'openai,deepseek', GEMINI_API_KEY: 'bad', OPENAI_API_KEY: 'good', DEEPSEEK_API_KEY: 'unused' },
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.includes('generativelanguage')) return jsonResponse({}, 401);
      return jsonResponse({ choices: [{ message: { content: 'answer' } }] });
    },
  });
  assert.equal(result.text, 'answer');
  assert.equal(result.provider, 'openai');
  assert.equal(calls.length, 2);
  assert.match(calls[0], /generativelanguage/);
  assert.equal(calls[1], 'https://api.openai.com/v1/chat/completions');
});
