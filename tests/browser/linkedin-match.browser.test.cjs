// The second filter: the posting is read before the apply form is opened.
//
// A job whose description asks for more experience than the profile has, or
// that names none of the profile skills, must be skipped without touching the
// Easy Apply control.

const assert = require('node:assert/strict');
const test = require('node:test');

const { withPage, loadHelpers, closeBrowser } = require('./harness.cjs');

const profile = {
  skills: { items: ['Java', 'Spring Boot'] },
  employment: { items: [{ start: '2025-01', end: '2026-01' }] },
  preferences: { targetRoles: ['Software Engineer'] },
};

const jobPage = (description) => `
  <h1>Software Engineer (Java)</h1>
  <div class="jobs-description-content__text">${description}</div>
  <button id="easy">Easy Apply</button>
  <div id="dialog" hidden>Apply to Software Engineer</div>
  <script>
    window.__dialogOpened = false;
    document.getElementById('easy').addEventListener('click', () => {
      window.__dialogOpened = true;
      document.getElementById('dialog').hidden = false;
    });
  </script>
`;

const openOnJobPage = (html) =>
  withPage(html, async (page) => {
    await page.goto('https://www.linkedin.com/jobs/view/4488999999/');
    await loadHelpers(page);
    return page.evaluate(async (profileValue) => {
      const api = window.__JAT_API__;
      const record = await api.openApply(
        window.__JAT_PAGE__,
        { id: '4488999999', url: 'https://www.linkedin.com/jobs/view/4488999999/' },
        { profile: profileValue, preferences: { targets: {} } },
      );
      return { record, dialogOpened: window.__dialogOpened };
    }, profile);
  });

test('a job that needs more experience is skipped before the form opens', async () => {
  const result = await openOnJobPage(jobPage('Java and Spring Boot. 5+ years of experience.'));
  try {
    assert.equal(result.record.status, 'skipped');
    assert.match(result.record.reason, /needs_5_years/);
    assert.equal(result.dialogOpened, false);
  } finally {
    await closeBrowser();
  }
});

test('a job outside the profile skills is skipped before the form opens', async () => {
  const result = await openOnJobPage(jobPage('Unreal Engine and C++ only. 1+ years of experience.'));
  try {
    assert.equal(result.record.status, 'skipped');
    assert.match(result.record.reason, /no_matching_skill/);
    assert.equal(result.dialogOpened, false);
  } finally {
    await closeBrowser();
  }
});
