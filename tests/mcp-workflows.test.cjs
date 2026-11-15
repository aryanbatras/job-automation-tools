const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const workflowPath = (name) => path.join(__dirname, '..', 'automation', 'mcp', name);

function loadWorkflow(name) {
  const source = fs.readFileSync(workflowPath(name), 'utf8');
  const workflow = vm.runInNewContext(source, { URL, Set, Map, Array, Object, String, RegExp });
  assert.equal(typeof workflow, 'function', `${name} must evaluate to an async function`);
  return workflow;
}

function control({ label = '', value = '', type = 'text', required = false, invalid = false, options = [], checked = false } = {}) {
  const attributes = {
    'aria-label': label,
    placeholder: '',
    'aria-required': required ? 'true' : null,
    'aria-invalid': invalid ? 'true' : null,
  };
  return {
    tagName: type === 'textarea' ? 'TEXTAREA' : type === 'select' ? 'SELECT' : 'INPUT',
    type,
    value,
    checked,
    required,
    labels: label ? [{ innerText: label }] : [],
    options: options.map((text) => ({ text, label: text })),
    validity: { valid: !invalid },
    getAttribute(name) { return attributes[name] ?? null; },
    getBoundingClientRect() { return { width: 100, height: 24 }; },
  };
}

function button(text, { disabled = false } = {}) {
  return {
    innerText: text,
    disabled,
    clicks: 0,
    getAttribute(name) { return name === 'aria-disabled' && disabled ? 'true' : null; },
    getBoundingClientRect() { return { width: 100, height: 24 }; },
  };
}

function fakePage({
  url = 'https://example.com/apply',
  captchaCount = 0,
  fields = [],
  buttons = [],
  anchors = [],
  messages = [],
} = {}) {
  return {
    url: () => url,
    title: async () => 'Test application',
    waitForTimeout: async () => {},
    locator(selector) {
      return {
        count: async () => selector.includes('captcha') ? captchaCount : 0,
        evaluateAll: async (callback) => {
          if (selector.includes('/jobs/view/')) return callback(anchors);
          if (selector.includes('selectable-text') || selector.includes('copyable-text')) return callback(messages);
          if (selector.includes('button')) return callback(buttons);
          if (selector.includes('input:not')) return callback(fields);
          return callback([]);
        },
      };
    },
    getByRole(role, { name } = {}) {
      const match = buttons.find((item) => {
        if (role !== 'button') return false;
        return name instanceof RegExp ? name.test(item.innerText) : item.innerText === name;
      });
      return {
        count: async () => match ? 1 : 0,
        click: async () => { if (match) match.clicks += 1; },
      };
    },
  };
}

test('LinkedIn collection normalizes and deduplicates job links', async () => {
  const card = (text) => ({ innerText: text });
  const anchors = [
    { href: 'https://www.linkedin.com/jobs/view/123/?tracking=one', innerText: 'Backend Engineer', closest: () => card('Backend Engineer\nAcme\nRemote') },
    { href: 'https://www.linkedin.com/jobs/view/123/?tracking=two', innerText: 'Duplicate', closest: () => card('Duplicate') },
    { href: 'https://www.linkedin.com/jobs/view/456/', innerText: 'Frontend Engineer', closest: () => card('Frontend Engineer\nExample Co\nRemote') },
    { href: 'https://www.linkedin.com/in/not-a-job/', innerText: 'Ignore', closest: () => card('Ignore') },
  ];
  const result = await loadWorkflow('collect-linkedin-jobs.js')(fakePage({
    url: 'https://www.linkedin.com/jobs/search/', anchors,
  }));

  assert.equal(result.status, 'ok');
  assert.deepEqual(JSON.parse(JSON.stringify(result.jobs)), [
    { title: 'Backend Engineer', company: 'Acme', location: 'Remote', url: 'https://www.linkedin.com/jobs/view/123/' },
    { title: 'Frontend Engineer', company: 'Example Co', location: 'Remote', url: 'https://www.linkedin.com/jobs/view/456/' },
  ]);
});

test('form preparation reports filled state without exposing entered values', async () => {
  const secretSentinel = 'PRIVATE-FORM-VALUE-DO-NOT-RETURN';
  const result = await loadWorkflow('prepare-application.js')(fakePage({
    fields: [control({ label: 'Email', value: secretSentinel, required: true })],
  }));

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(secretSentinel), false);
  assert.equal(result.fields[0].filled, true);
  assert.equal(result.status, 'ready_for_review');
});

test('form preparation never clicks a final submission control', async () => {
  const submit = button('Submit application');
  const result = await loadWorkflow('prepare-application.js')(fakePage({
    fields: [control({ label: 'Name', value: 'Filled', required: true })],
    buttons: [submit],
  }));

  assert.equal(result.status, 'approval_required');
  assert.equal(submit.clicks, 0);
});

test('form preparation stops at CAPTCHA before clicking anything', async () => {
  const next = button('Next');
  const result = await loadWorkflow('prepare-application.js')(fakePage({
    captchaCount: 1,
    buttons: [next],
  }));

  assert.equal(result.status, 'human_intervention_required');
  assert.equal(next.clicks, 0);
});

test('form preparation does not advance with a missing required answer', async () => {
  const next = button('Next');
  const result = await loadWorkflow('prepare-application.js')(fakePage({
    fields: [control({ label: 'Work authorization', required: true })],
    buttons: [next],
  }));

  assert.equal(result.status, 'needs_answers');
  assert.equal(next.clicks, 0);
});

test('form preparation does not advance with an invalid required field', async () => {
  const next = button('Continue');
  const result = await loadWorkflow('prepare-application.js')(fakePage({
    fields: [control({ label: 'Email', value: 'entered', required: true, invalid: true })],
    buttons: [next],
  }));

  assert.equal(result.status, 'needs_answers');
  assert.equal(next.clicks, 0);
});

test('form preparation advances only one safe step after required fields are valid', async () => {
  const next = button('Review');
  const result = await loadWorkflow('prepare-application.js')(fakePage({
    fields: [control({ label: 'Name', value: 'Filled', required: true })],
    buttons: [next],
  }));

  assert.equal(result.status, 'advanced');
  assert.equal(next.clicks, 1);
});

test('WhatsApp reading deduplicates messages and links and caps message output', async () => {
  const messages = [
    { innerText: 'Role one https://jobs.example/1' },
    { innerText: 'Role one https://jobs.example/1' },
    ...Array.from({ length: 105 }, (_, index) => ({ innerText: `Role ${index + 2} https://jobs.example/${index + 2}` })),
  ];
  const result = await loadWorkflow('read-whatsapp-channel.js')(fakePage({
    url: 'https://web.whatsapp.com/', messages,
  }));

  assert.equal(result.status, 'ok');
  assert.equal(result.messages.length, 100);
  assert.equal(result.links.length, 100);
  assert.equal(new Set(result.messages).size, result.messages.length);
});
