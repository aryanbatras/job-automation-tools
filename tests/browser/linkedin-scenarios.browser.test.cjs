// Engine scenarios: the cases that used to end a run with nothing applied.
//
// Each test serves a small job board and runs the real bundle. The assertions
// are about the outcome of the run, not about the calls it made.

const assert = require('node:assert/strict');
const test = require('node:test');

const { loadEngine, withRoutes, closeBrowser } = require('./harness.cjs');

test.after(async () => {
  await closeBrowser();
});

const preferences = {
  version: 1,
  search: {
    keywords: 'java',
    location: 'India',
    remoteOnly: true,
    easyApplyOnly: true,
    maxPages: 1,
    maxApplications: 3,
    maxAttempts: 3,
  },
  targets: { includeTitles: [], excludeTitles: [], excludeCompanies: [], excludeWords: [] },
  answers: { resumeFile: 'resume.pdf', autoFillUnknown: false },
  policy: { requireVerifiedSubmission: true, stopOnChallenge: true, fieldTimeoutSeconds: 30 },
  logging: { markdownFile: 'linkedin/content/local/applications.md' },
};

const answers = [
  { label: 'email address', value: 'person@example.test', keywords: ['email'] },
  { label: 'phone number', value: '+91 9000000000', keywords: ['phone'] },
  { label: 'resume', value: 'resume.pdf', keywords: ['resume'] },
  {
    label: "What's your current / last drawn salary package in LPA?",
    value: '25K per month; 4 LPA if annual expectation is asked',
    keywords: ['current salary package'],
  },
];

const card = (id, title, extra = '') => `
  <li class="jobs-search-results__list-item">
    <div>
      <p><a href="/jobs/view/${id}/">${title}</a></p>
      <p>Acme</p>
      <p>India (Remote)</p>
      ${extra}
    </div>
  </li>`;

const board = (jobs) => `<ul>${jobs.map(([id, title]) => card(id, title)).join('')}</ul>`;

const run = (resolveHtml, config = {}, inspect) =>
  withRoutes(resolveHtml, async (page) => {
    const result = await loadEngine()(page, {
      preferences: { ...preferences, ...(config.preferences || {}) },
      answers,
      preflight: { status: 'ready' },
    });
    const body = await page.locator('body').innerText();
    const extra = inspect ? await inspect(page) : {};
    return { result, body, ...extra };
  });

test('the questions an application asked are recorded with their answers', async () => {
  const html = `
    <button aria-label="Easy Apply to this job">Easy Apply</button>
    <div role="dialog" aria-label="Apply to Java Engineer">
      <h2>Apply to Java Engineer</h2>
      <label for="email">Email address</label>
      <input id="email" type="email" required>
      <label for="salary">What is your current CTC?</label>
      <input id="salary" type="text" required>
      <button type="button" id="submit" onclick="document.body.innerHTML='<p>Application submitted now</p>'">Submit application</button>
    </div>`;
  const { result } = await run((url) =>
    url.includes('/jobs/search-results/') ? board([['4490000071', 'Java Engineer']]) : html,
  );
  assert.equal(result.results[0].result, 'submitted', JSON.stringify(result.results[0]));
  const questions = result.results[0].questions || [];
  const labels = questions.map((question) => question.label);
  assert.ok(labels.includes('Email address'), JSON.stringify(questions));
  assert.ok(labels.includes('What is your current CTC?'), JSON.stringify(questions));
  const salary = questions.find((question) => question.label === 'What is your current CTC?');
  assert.equal(salary.value, '25K per month; 4 LPA if annual expectation is asked');
  assert.equal(salary.source, 'confirmed');
});

test('a job whose apply button leads off LinkedIn is skipped, never clicked', async () => {
  const html = `
    <button id="external" onclick="window.__EXTERNAL_CLICKED__ = true">Apply on company website</button>`;
  const { result, clicked } = await run(
    (url) => (url.includes('/jobs/search-results/') ? board([['4490000011', 'Java Engineer']]) : html),
    {},
    (page) => page.evaluate(() => ({ clicked: Boolean(window.__EXTERNAL_CLICKED__) })),
  );
  assert.equal(result.applications, 0);
  assert.equal(result.results[0].result, 'external_application_system');
  assert.equal(clicked, false);
});

test('a challenge stops the whole run at the first job', async () => {
  const html = `
    <button aria-label="Easy Apply to this job" onclick="document.getElementById('apply').style.display='block'">Easy Apply</button>
    <div id="apply" role="dialog" aria-label="Apply to Java Engineer" style="display:none">
      <h2>Apply to Java Engineer</h2>
      <iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe>
      <button>Next</button>
    </div>`;
  const { result } = await run((url) =>
    url.includes('/jobs/search-results/')
      ? board([
          ['4490000021', 'Java Engineer'],
          ['4490000022', 'Backend Engineer'],
        ])
      : html,
  );
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].result, 'human_intervention_required');
  assert.equal(result.applications, 0);
});

test('an unverified submission stops the run instead of stacking another one', async () => {
  const html = `
    <button aria-label="Easy Apply to this job">Easy Apply</button>
    <div role="dialog" aria-label="Apply to Java Engineer">
      <h2>Apply to Java Engineer</h2>
      <label for="email">Email address</label>
      <input id="email" type="email" required>
      <button type="button" id="submit">Submit application</button>
    </div>`;
  const { result } = await run((url) =>
    url.includes('/jobs/search-results/')
      ? board([
          ['4490000031', 'Java Engineer'],
          ['4490000032', 'Backend Engineer'],
        ])
      : html,
  );
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].result, 'submission_unverified');
  assert.equal(result.applications, 0);
});

test('a step that renders slowly is still filled and submitted', async () => {
  // LinkedIn paints the next step after the click, not on it. Reading the
  // previous step's DOM would find every field filled and click Next again.
  const html = `
    <button aria-label="Easy Apply to this job">Easy Apply</button>
    <div role="dialog" aria-label="Apply to Java Engineer">
      <h2>Apply to Java Engineer</h2>
      <label for="email">Email address</label>
      <input id="email" type="email" required>
      <button type="button" id="next">Next</button>
      <script>
        document.getElementById('next').addEventListener('click', () => {
          document.getElementById('next').remove();
          setTimeout(() => {
            const label = document.createElement('label');
            label.htmlFor = 'salary';
            label.textContent = "What's your current / last drawn salary package in LPA?";
            const salary = document.createElement('input');
            salary.id = 'salary';
            salary.required = true;
            const submit = document.createElement('button');
            submit.textContent = 'Submit application';
            submit.addEventListener('click', () => {
              document.body.innerHTML = '<p>Application submitted now</p>';
            });
            const dialog = document.querySelector('[role="dialog"]');
            dialog.append(label, salary, submit);
          }, 2000);
        });
      </script>
    </div>`;
  const { result, body } = await run((url) =>
    url.includes('/jobs/search-results/') ? board([['4490000061', 'Java Engineer']]) : html,
  );
  assert.equal(result.results[0].result, 'submitted', JSON.stringify(result.results[0]));
  assert.equal(result.applications, 1);
  assert.match(body, /Application submitted/i);
});

test('an answer rejected only when the step advances is bridged and retried', async () => {
  // LinkedIn prints "Invalid input" after the click, not while typing.
  const html = `
    <button aria-label="Easy Apply to this job">Easy Apply</button>
    <div role="dialog" aria-label="Apply to Java Engineer">
      <h2>Apply to Java Engineer</h2>
      <label for="email">Email address</label>
      <input id="email" type="email" required>
      <label for="salary">What's your current / last drawn salary package in LPA?</label>
      <input id="salary" type="text" required aria-describedby="salary-error">
      <p id="salary-error"></p>
      <button type="button" id="next">Next</button>
      <button type="button" id="submit" style="display:none" onclick="document.body.innerHTML='<p>Application submitted now</p>'">Submit application</button>
      <script>
        document.getElementById('next').addEventListener('click', () => {
          const salary = document.getElementById('salary');
          const ok = /^[0-9.]+$/.test(salary.value);
          document.getElementById('salary-error').textContent = ok ? '' : 'Invalid input';
          if (ok) {
            document.getElementById('next').style.display = 'none';
            document.getElementById('submit').style.display = 'block';
          }
        });
      </script>
    </div>`;
  const { result, body } = await run((url) =>
    url.includes('/jobs/search-results/') ? board([['4490000051', 'Java Engineer']]) : html,
  );
  assert.equal(result.results[0].result, 'submitted', JSON.stringify(result.results[0]));
  assert.equal(result.applications, 1);
  assert.match(body, /Application submitted/i);
});

test('a rejected free-text answer is bridged, and the job is submitted', async () => {
  const html = `
    <button aria-label="Easy Apply to this job">Easy Apply</button>
    <div role="dialog" aria-label="Apply to Java Engineer">
      <h2>Apply to Java Engineer</h2>
      <label for="email">Email address</label>
      <input id="email" type="email" required>
      <label for="salary">What's your current / last drawn salary package in LPA?</label>
      <input id="salary" type="text" required pattern="[0-9.]+" aria-describedby="salary-error">
      <p id="salary-error"></p>
      <button type="button" id="submit" onclick="document.body.innerHTML='<p>Application submitted now</p>'">Submit application</button>
      <script>
        const salary = document.getElementById('salary');
        const error = document.getElementById('salary-error');
        salary.addEventListener('input', () => {
          error.textContent = salary.checkValidity() ? '' : 'Invalid input';
        });
      </script>
    </div>`;
  const { result, body } = await run((url) =>
    url.includes('/jobs/search-results/') ? board([['4490000041', 'Java Engineer']]) : html,
  );
  assert.equal(result.results[0].result, 'submitted', JSON.stringify(result.results[0]));
  assert.equal(result.applications, 1);
  assert.match(body, /Application submitted/i);
});
