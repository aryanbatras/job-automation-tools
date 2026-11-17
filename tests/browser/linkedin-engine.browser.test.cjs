const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const { chromium } = require('playwright');

const engineDirectory = path.join(__dirname, '..', '..', 'linkedin', 'automation');
const bundlePath = path.join(engineDirectory, 'dist', 'linkedin-apply.js');

let browser;

const preferences = {
  version: 1,
  search: { keywords: 'remote java engineer', location: 'India', remoteOnly: true, easyApplyOnly: true, maxPages: 1, maxApplications: 3 },
  targets: { includeTitles: [], excludeTitles: [], excludeCompanies: [], excludeWords: [] },
  answers: { resumeFile: 'resume.pdf', autoFillUnknown: false },
  policy: { requireVerifiedSubmission: true, stopOnChallenge: true, fieldTimeoutSeconds: 30 },
  logging: { markdownFile: 'linkedin/content/local/applications.md' },
};

const answers = [
  { label: 'email address', value: 'person@example.test', keywords: ['email'] },
  { label: 'phone number', value: '+91 9000000000', keywords: ['phone'] },
  { label: 'resume', value: 'resume.pdf', keywords: ['resume'] },
];

function loadEngine() {
  childProcess.execFileSync('node', [path.join(engineDirectory, 'build.js')], { stdio: 'ignore' });
  const source = fs.readFileSync(bundlePath, 'utf8');
  const engine = vm.runInNewContext(source, { URL, Set, Map, Array, Object, String, RegExp, JSON, Boolean, Number, Date });
  assert.equal(typeof engine, 'function');
  return engine;
}

const searchHtml = `
  <label>Easy Apply</label>
  <label>Remote</label>
  <ul>
    <li class="jobs-search-results__list-item">
      <div><p><a href="/jobs/view/4490000001/">Java Engineer</a></p><p>Acme</p><p>India (Remote)</p></div>
    </li>
  </ul>
`;

const jobHtml = (form) => `
  <button aria-label="Easy Apply to this job">Easy Apply</button>
  <div role="dialog" aria-label="Apply to Java Engineer">
    <h2>Apply to Java Engineer</h2>
    ${form}
  </div>
`;

// A job page has its own "Next" control for moving to the next job in the
// list, next to the Easy Apply surface. The engine must never touch it.
const wizardJobHtml = `
  <input id="search" placeholder="Search">
  <button id="jobnav" onclick="window.__JOB_NAV_CLICKED__ = true">Next</button>
  <button aria-label="Easy Apply to this job" onclick="document.getElementById('apply').style.display = 'block'">Easy Apply</button>
  <div id="apply" role="dialog" aria-label="Apply to Java Engineer" style="display:none">
    <h2>Apply to Java Engineer</h2>
    <label for="email">Email address</label><input id="email" type="email" required>
    <div id="step1">
      <button id="form-next" onclick="document.getElementById('step1').style.display = 'none'; document.getElementById('step2').style.display = 'block'">Next</button>
    </div>
    <div id="step2" style="display:none">
      <button id="submit" onclick="document.body.innerHTML = '<p>Application submitted now</p>'">Submit application</button>
    </div>
  </div>
`;

const readyForm = `
  <label for="email">Email address</label><input id="email" type="email" required>
  <label for="phone">Phone number</label><input id="phone" type="tel" required>
  <label for="site">Website</label><input id="site" type="url">
  <button type="button" id="submit" onclick="document.body.innerHTML='<p>Application submitted now</p>'">Submit application</button>
`;

const gapForm = `
  <label for="email">Email address</label><input id="email" type="email" required>
  <label for="ctc">Current salary in INR</label><input id="ctc" type="text" required>
  <button type="button" id="submit" onclick="document.body.innerHTML='<p>Application submitted now</p>'">Submit application</button>
`;

async function runEngine(html) {
  const page = await browser.newPage();
  await page.route('**/*', (route) => {
    const url = route.request().url();
    const body = url.includes('/jobs/search-results/') ? searchHtml : html;
    return route.fulfill({ status: 200, contentType: 'text/html', body });
  });
  await page.goto('https://www.linkedin.com/jobs/search-results/?keywords=remote');
  const result = await loadEngine()(page, {
    preferences,
    answers,
    preflight: { status: 'ready' },
  });
  const body = await page.locator('body').innerText();
  return { result, body, page };
}

test.before(async () => {
  browser = await chromium.launch();
});

test.after(async () => {
  await browser.close();
});

test('the engine fills every known field, submits once and verifies the submission', async () => {
  const { result, body, page } = await runEngine(jobHtml(readyForm));

  assert.equal(result.status, 'ok');
  assert.equal(result.applications, 1);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].result, 'submitted');
  assert.equal(result.results[0].gaps.length, 0);
  assert.match(body, /Application submitted/i);
  // An anchor card is not clickable as a panel; the job URL is the fallback.
  assert.match(page.url(), /\/jobs\/view\/4490000001\//);
});

test('the engine refuses to submit when a required field has no answer', async () => {
  const { result, body } = await runEngine(jobHtml(gapForm));

  assert.equal(result.status, 'ok');
  assert.equal(result.applications, 0);
  assert.equal(result.results[0].result, 'needs_answers');
  assert.match(result.results[0].reason, /Current salary/i);
  assert.doesNotMatch(body, /Application submitted/i);
  assert.ok(result.gaps.some((gap) => /Current salary/i.test(gap.gap)));
});

test('the engine advances the form and never clicks the job list navigation', async () => {
  const page = await browser.newPage();
  await page.route('**/*', (route) => {
    const url = route.request().url();
    const body = url.includes('/jobs/search-results/') ? searchHtml : wizardJobHtml;
    return route.fulfill({ status: 200, contentType: 'text/html', body });
  });
  await page.goto('https://www.linkedin.com/jobs/search-results/?keywords=remote');
  const result = await loadEngine()(page, {
    preferences,
    answers,
    preflight: { status: 'ready' },
  });
  const jobNavClicked = await page.evaluate(() => Boolean(window.__JOB_NAV_CLICKED__));
  const body = await page.locator('body').innerText();

  assert.equal(result.results[0].result, 'submitted', JSON.stringify(result.results[0]));
  assert.equal(jobNavClicked, false, 'the job list navigation must not be clicked');
  assert.match(body, /Application submitted/i);
});

test('the engine stops with an error when the profile is not ready', async () => {
  const page = await browser.newPage();
  await page.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: searchHtml }));
  await page.goto('https://www.linkedin.com/jobs/search-results/?keywords=remote');
  const result = await loadEngine()(page, {
    preferences,
    answers,
    preflight: { status: 'blocked' },
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'preflight_failed');
  assert.ok(result.errors.includes('profile_preflight_not_ready'));
});
