const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const workflowPath = (name) => path.join(__dirname, '..', 'automation', 'mcp', name);
const radioGroupScopes = new Map();

function loadWorkflow(name) {
  const source = fs.readFileSync(workflowPath(name), 'utf8');
  const workflow = vm.runInNewContext(source, { URL, Set, Map, Array, Object, String, RegExp });
  assert.equal(typeof workflow, 'function', `${name} must evaluate to an async function`);
  return workflow;
}

function control({ label = '', value = '', type = 'text', required = false, invalid = false, options = [], checked = false, name = '', groupLabel = '', visible = true } = {}) {
  let group = null;
  if (groupLabel) {
    group = radioGroupScopes.get(groupLabel);
    if (!group) {
      group = { querySelector: () => ({ innerText: groupLabel }), getAttribute: () => null };
      radioGroupScopes.set(groupLabel, group);
    }
  }
  const attributes = {
    'aria-label': label,
    placeholder: '',
    'aria-required': required ? 'true' : null,
    'aria-invalid': invalid ? 'true' : null,
  };
  return {
    tagName: type === 'textarea' ? 'TEXTAREA' : type === 'select' ? 'SELECT' : 'INPUT',
    type,
    name,
    value,
    checked,
    required,
    visible,
    labels: label ? [{ innerText: label }] : [],
    options: options.map((text) => ({ text, label: text })),
    validity: { valid: !invalid },
    getAttribute(name) { return attributes[name] ?? null; },
    closest() {
      return group;
    },
    getBoundingClientRect() { return { width: visible ? 100 : 0, height: visible ? 24 : 0 }; },
  };
}

function button(text, { disabled = false, insideForm = false, nativeSubmit = false, visible = true } = {}) {
  return {
    innerText: text,
    value: '',
    disabled,
    insideForm,
    nativeSubmit,
    visible,
    clicks: 0,
    tagName: 'BUTTON',
    role: '',
    getAttribute(name) {
      if (name === 'aria-disabled' && disabled) return 'true';
      if (name === 'type' && nativeSubmit) return 'submit';
      return null;
    },
    closest(selector) { return selector === 'form' && insideForm ? {} : null; },
    getBoundingClientRect() { return { width: visible ? 100 : 0, height: visible ? 24 : 0 }; },
  };
}

function fakePage({
  url = 'https://example.com/apply',
  captchaCount = 0,
  fields = [],
  buttons = [],
  cards = [],
  anchors = [],
  messages = [],
  bodyText = '',
} = {}) {
  const controls = [...buttons];
  return {
    url: () => url,
    title: async () => 'Test application',
    waitForTimeout: async () => {},
    locator(selector) {
      return {
        count: async () => selector.includes('captcha') ? captchaCount : 0,
        innerText: async () => bodyText,
        evaluateAll: async (callback) => {
          if (selector.includes('input[type="submit"]')) return callback(buttons);
          if (selector.includes('a[href]')) return callback(controls);
          if (selector.includes('[role="button"]')) return callback(cards);
          if (selector.includes('/jobs/view/')) return callback(anchors.map((anchor) => ({
            ...anchor,
            getBoundingClientRect: anchor.getBoundingClientRect || (() => ({ width: 100, height: 24 })),
          })));
          if (selector.includes('selectable-text') || selector.includes('copyable-text')) return callback(messages.map((message) => ({
            ...message,
            getBoundingClientRect: message.getBoundingClientRect || (() => ({ width: 100, height: 24 })),
          })));
          if (selector.includes('button')) return callback(buttons);
          if (selector.includes('input:not')) return callback(selector.includes(':visible') ? fields.filter((field) => field.visible) : fields);
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
    { href: 'https://www.linkedin.com/jobs/view/789/', innerText: 'Hidden Engineer', closest: () => card('Hidden Engineer\nHidden Co\nRemote'), getBoundingClientRect: () => ({ width: 0, height: 0 }) },
    { href: 'https://www.linkedin.com/in/not-a-job/', innerText: 'Ignore', closest: () => card('Ignore') },
  ];
  const result = await loadWorkflow('collect-linkedin-jobs.js')(fakePage({
    url: 'https://www.linkedin.com/jobs/search/', anchors,
  }));

  assert.equal(result.status, 'ok');
  assert.deepEqual(JSON.parse(JSON.stringify(result.jobs)), [
    { title: 'Backend Engineer', company: 'Acme', location: 'Remote', url: 'https://www.linkedin.com/jobs/view/123/', selected: false },
    { title: 'Frontend Engineer', company: 'Example Co', location: 'Remote', url: 'https://www.linkedin.com/jobs/view/456/', selected: false },
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

test('form preparation does not mistake a job-level Apply button for final submission', async () => {
  const apply = button('Apply');
  const result = await loadWorkflow('prepare-application.js')(fakePage({ buttons: [apply] }));

  assert.equal(result.status, 'ready_for_review');
  assert.equal(apply.clicks, 0);
});

test('form preparation gates an Apply button inside an application form', async () => {
  const apply = button('Apply', { insideForm: true });
  const result = await loadWorkflow('prepare-application.js')(fakePage({ buttons: [apply] }));

  assert.equal(result.status, 'approval_required');
  assert.equal(apply.clicks, 0);
});

test('form preparation recognizes a compound final-submit label', async () => {
  const submit = button('Review and Submit');
  const result = await loadWorkflow('prepare-application.js')(fakePage({ buttons: [submit] }));

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

test('form preparation treats a selected required radio group as filled', async () => {
  const result = await loadWorkflow('prepare-application.js')(fakePage({
    fields: [
      control({ label: 'Yes', type: 'radio', name: 'authorization', required: true, checked: true, groupLabel: 'Work authorization' }),
      control({ label: 'No', type: 'radio', name: 'authorization', required: true, checked: false, groupLabel: 'Work authorization' }),
    ],
  }));

  assert.equal(result.status, 'ready_for_review');
  assert.equal(result.fields.length, 1);
  assert.equal(result.fields[0].filled, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.fields[0].options)), ['Yes', 'No']);
});

test('form preparation ignores hidden required fields', async () => {
  const next = button('Next');
  const result = await loadWorkflow('prepare-application.js')(fakePage({
    fields: [control({ label: 'Conditional field', required: true, visible: false })],
    buttons: [next],
  }));

  assert.equal(result.status, 'manual_step');
  assert.equal(result.reason, 'progression_requires_verified_adapter');
  assert.equal(next.clicks, 0);
});

test('form preparation never clicks a progression control without a verified adapter', async () => {
  const next = button('Review');
  const result = await loadWorkflow('prepare-application.js')(fakePage({
    fields: [control({ label: 'Name', value: 'Filled', required: true })],
    buttons: [next],
  }));

  assert.equal(result.status, 'manual_step');
  assert.equal(next.clicks, 0);
});

test('form preparation flags a native submit control that may submit the form', async () => {
  const next = button('Next', { nativeSubmit: true });
  const result = await loadWorkflow('prepare-application.js')(fakePage({
    fields: [control({ label: 'Name', value: 'Filled', required: true })],
    buttons: [next],
  }));

  assert.equal(result.status, 'manual_step');
  assert.equal(result.reason, 'progression_control_may_submit');
  assert.equal(next.clicks, 0);
});

test('WhatsApp reading deduplicates messages and links and caps message output', async () => {
  const messages = [
    { innerText: 'Hidden role https://jobs.example/hidden', getBoundingClientRect: () => ({ width: 0, height: 0 }) },
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
  assert.equal(result.messages.some((message) => message.startsWith('Hidden role')), false);
  assert.equal(result.links.includes('https://jobs.example/hidden'), false);
});

test('local content examples are placeholders and private store paths are ignored', () => {
  const examples = path.join(__dirname, '..', 'automation', 'content', 'examples');
  const profile = JSON.parse(fs.readFileSync(path.join(examples, 'profile.example.json'), 'utf8'));
  const answerBank = JSON.parse(fs.readFileSync(path.join(examples, 'answer-bank.example.json'), 'utf8'));
  const sitePolicies = JSON.parse(fs.readFileSync(path.join(examples, 'site-policies.example.json'), 'utf8'));

  assert.equal(profile.onboarding.confirmed, false);
  assert.equal(profile.identity.legalName, '');
  assert.equal(profile.contact.email, '');
  assert.equal(answerBank.entries.length, 0);
  assert.equal(sitePolicies.default.captcha, 'stop');
  for (const domain of ['linkedin.com', 'wellfound.com', 'ashbyhq.com', 'docs.google.com']) {
    assert.equal(sitePolicies.domains[domain].captcha, 'stop');
  }

  const ignoreRules = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
  assert.match(ignoreRules, /^automation\/content\/local\/$/m);
  assert.match(ignoreRules, /^automation\/profile\.local\.json$/m);
});

test('active browser workflows do not use direct Playwright/CDP or embed personal contact data', () => {
  const roots = ['linkedin', 'wellfound', 'careers', 'googleforms', 'whatsapp', 'automation/mcp'];
  const sourceFiles = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else if (/\.(?:cjs|js)$/i.test(entry.name)) sourceFiles.push(fullPath);
    }
  };
  for (const root of roots) visit(path.join(__dirname, '..', root));

  assert.ok(sourceFiles.length >= 3);
  for (const file of sourceFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /connectOverCDP|CDP_ENDPOINT|remote-debugging-port|127\.0\.0\.1:9222/i, file);
    assert.doesNotMatch(source, /require\s*\(\s*['"]playwright['"]\s*\)/i, file);
    assert.doesNotMatch(source, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, file);
    assert.doesNotMatch(source, /Aryan\s+Batra/i, file);
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(manifest.dependencies?.playwright, undefined);
});
