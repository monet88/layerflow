// API Connection Test for local LLM server
const API_URL = 'http://127.0.0.1:5580/v1/chat/completions';
const API_KEY = 'sk-6jbztubk1tguss7sr4s4ejxjtx70o3w61xbe13rsx0lw8k6j';

const models = [
  'claude-opus-4.7',
  'claude-sonnet-4.6',
  'claude-haiku-4.5-20251001'
];

async function testModel(model) {
  const payload = {
    model: model,
    messages: [{ role: 'user', content: 'Hello, respond with exactly: "Model X is working"' }],
    max_tokens: 20,
    temperature: 0
  };

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!res.ok) {
      return { model, success: false, status: res.status, error: data.error?.message || data.raw || 'Unknown error' };
    }

    const content = data.choices?.[0]?.message?.content || 'No content';
    return { model, success: true, content };
  } catch (err) {
    return { model, success: false, error: err.message };
  }
}

async function main() {
  console.log('Testing connection to http://127.0.0.1:5580');
  console.log('='.repeat(60));

  for (const model of models) {
    console.log(`\nTesting: ${model}`);
    const result = await testModel(model);
    if (result.success) {
      console.log(`  SUCCESS: ${result.content}`);
    } else {
      console.log(`  FAILED: ${result.error}`);
    }
  }
  console.log('\n' + '='.repeat(60));
}

main().catch(console.error);