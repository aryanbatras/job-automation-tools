const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const { chromium } = require('playwright');

const workflowPath = (name) => path.join(__dirname, '..', '..', 'automation', 'mcp', name);

function loadWorkflow(name) {
  const source = fs.readFileSync(workflowPath(name), 'utf8');
  const workflow = vm.runInNewContext(source, { URL, Set, Map, Array, Object, String, RegExp, JSON, Boolean, Number });
  assert.equal(typeof workflow, 'function', `${name} must evaluate to an async function`);
  return workflow;
}

let browser;

test.before(async () => {
  browser = await chromium.launch();
});

test.after(async () => {
  await browser.close();
});

async function run(name, html, { url = 'https://example.test/apply' } = {}) {
  const page = await browser.newPage();
  await page.route('**/*', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: html }),
  );
  await page.goto(url);
  const result = await loadWorkflow(name)(page);
  return { result, page };
}

test('inspection reports a prefilled field as filled without exposing its value', async () => {
  const sentinel = 'PRIVATE-FORM-VALUE-DO-NOT-RETURN@example.test';
  const { result } = await run('inspect-application.js', `
    <form>
      <label for="email">Email</label>
      <input id="email" name="email" type="email" value="${sentinel}" required>
    </form>
  `);

  assert.equal(result.status, 'ok');
  assert.equal(result.fields.length, 1);
  assert.equal(result.fields[0].filled, true);
  assert.equal(result.fields[0].label, 'Email');
  assert.equal(result.fields[0].required, true);
  assert.equal(JSON.stringify(result).includes(sentinel), false);
});

test('inspection reports labels, options, and radio groups', async () => {
  const { result } = await run('inspect-application.js', `
    <form>
      <label for="country">Country</label>
      <select id="country" name="country" required>
        <option value="">Select</option>
        <option value="de">Germany</option>
        <option value="nl">Netherlands</option>
      </select>
      <fieldset>
        <legend>Work mode</legend>
        <input type="radio" id="mode-remote" name="mode" value="remote">
        <label for="mode-remote">Remote</label>
        <input type="radio" id="mode-onsite" name="mode" value="onsite" checked>
        <label for="mode-onsite">Onsite</label>
      </fieldset>
    </form>
  `);

  const country = result.fields.find((field) => field.label === 'Country');
  assert.deepEqual(country.options, ['Germany', 'Netherlands']);
  assert.equal(country.filled, false);

  const mode = result.fields.find((field) => field.type === 'radio');
  assert.equal(mode.label, 'Work mode');
  assert.deepEqual(mode.options, ['Remote', 'Onsite']);
  assert.equal(mode.filled, true);
});

test('inspection flags an unlabeled required field instead of guessing it', async () => {
  const { result } = await run('inspect-application.js', `
    <form><input type="text" name="mystery" required></form>
  `);

  assert.equal(result.status, 'needs_answers');
  const field = result.fields[0];
  assert.equal(field.label, '');
  assert.equal(field.required, true);
  assert.equal(field.filled, false);
});

test('inspection reports iframes, custom widgets, and file inputs as unsupported', async () => {
  const { result } = await run('inspect-application.js', `
    <form>
      <label for="name">Name</label>
      <input id="name" name="name" type="text">
      <div role="combobox" aria-label="Country picker" style="width:220px;height:32px"></div>
      <input type="file" name="resume">
      <iframe title="resume frame"></iframe>
    </form>
  `);

  assert.equal(result.status, 'manual_step');
  const kinds = result.unsupported.map((entry) => entry.kind);
  assert.ok(kinds.includes('custom_widget'));
  assert.ok(kinds.includes('file_input'));
  assert.ok(kinds.includes('iframe'));
  assert.equal(result.unsupported.find((entry) => entry.kind === 'iframe').label, 'resume frame');
});

test('inspection stops on a CAPTCHA challenge before reading fields', async () => {
  const { result } = await run('inspect-application.js', `
    <form>
      <div class="g-recaptcha" data-sitekey="sentinel-sitekey"></div>
      <label for="email">Email</label>
      <input id="email" name="email" type="email" required>
    </form>
  `);

  assert.equal(result.status, 'human_intervention_required');
  assert.equal(result.reason, 'captcha_detected');
});

test('form preparation never triggers a native submit control named Next', async () => {
  const { result, page } = await run('prepare-application.js', `
    <form id="application">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" value="filled@example.test" required>
      <button type="submit">Next</button>
    </form>
    <script>
      window.submitEvents = 0;
      document.getElementById('application').addEventListener('submit', () => { window.submitEvents += 1; });
    </script>
  `);

  const submitEvents = await page.evaluate(() => window.submitEvents);
  assert.equal(submitEvents, 0);
  assert.notEqual(result.status, 'advanced');
});

test('form preparation stops before any click when a challenge is present', async () => {
  const { result, page } = await run('prepare-application.js', `
    <form>
      <div class="h-captcha"></div>
      <button type="button">Next</button>
    </form>
  `);

  assert.equal(result.status, 'human_intervention_required');
  assert.equal(await page.locator('button').count(), 1);
});

test('form preparation stops for unsupported controls', async () => {
  const { result } = await run('prepare-application.js', `
    <form>
      <div role="combobox" aria-label="Country picker" style="width:220px;height:32px"></div>
      <button type="button">Next</button>
    </form>
  `);

  assert.equal(result.status, 'manual_step');
  assert.equal(result.reason, 'unsupported_control');
});

test('form preparation asks for answers when a required field is missing', async () => {
  const { result } = await run('prepare-application.js', `
    <form>
      <label for="auth">Work authorization</label>
      <input id="auth" name="auth" type="text" required>
      <button type="button">Next</button>
    </form>
  `);

  assert.equal(result.status, 'needs_answers');
  assert.equal(result.fields[0].filled, false);
});

test('form preparation reports a final submit control without clicking it', async () => {
  const { result, page } = await run('prepare-application.js', `
    <form>
      <label for="email">Email</label>
      <input id="email" name="email" type="email" value="filled@example.test" required>
      <button type="submit">Submit application</button>
    </form>
  `);

  assert.equal(result.status, 'approval_required');
  assert.equal(await page.locator('button[type="submit"]:focus').count(), 0);
});

test('application entry opens one Apply control on a supported job page', async () => {
  const { result, page } = await run('start-application.js', `
    <button type="button" id="apply">Apply</button>
    <script>
      window.applyClicks = 0;
      document.getElementById('apply').addEventListener('click', () => { window.applyClicks += 1; });
    </script>
  `, { url: 'https://www.linkedin.com/jobs/view/4490325744/' });

  assert.equal(result.status, 'started');
  assert.equal(await page.evaluate(() => window.applyClicks), 1);
});

test('application entry refuses an unsupported domain', async () => {
  const { result } = await run('start-application.js', `
    <button type="button" id="apply">Apply</button>
  `, { url: 'https://careers.example.test/jobs/1' });

  assert.equal(result.status, 'unsupported_site');
});

test('submission clicks exactly one final control and detects the success marker', async () => {
  const { result, page } = await run('submit-application.js', `
    <form id="application">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" value="filled@example.test" required>
      <button type="submit" id="submit">Submit application</button>
    </form>
    <script>
      window.submitClicks = 0;
      document.getElementById('submit').addEventListener('click', () => {
        window.submitClicks += 1;
        document.body.innerHTML = '<p>Your application has been submitted</p>';
      });
    </script>
  `);

  assert.equal(result.status, 'submitted');
  assert.equal(await page.evaluate(() => window.submitClicks), 1);
});

test('submission refuses to guess between two final controls', async () => {
  const { result, page } = await run('submit-application.js', `
    <form>
      <button type="submit" id="submit">Submit application</button>
      <button type="submit" id="send">Send application</button>
    </form>
    <script>
      window.submitClicks = 0;
      document.getElementById('submit').addEventListener('click', () => { window.submitClicks += 1; });
      document.getElementById('send').addEventListener('click', () => { window.submitClicks += 1; });
    </script>
  `);

  assert.equal(result.status, 'ambiguous_final_control');
  assert.equal(await page.evaluate(() => window.submitClicks), 0);
});

test('submission reports unverified success without retrying', async () => {
  const { result, page } = await run('submit-application.js', `
    <form id="application">
      <button type="submit" id="submit">Submit application</button>
    </form>
    <script>
      window.submitClicks = 0;
      document.getElementById('application').addEventListener('submit', (event) => {
        event.preventDefault();
        window.submitClicks += 1;
      });
    </script>
  `);

  assert.equal(result.status, 'submission_unverified');
  assert.equal(await page.evaluate(() => window.submitClicks), 1);
});
