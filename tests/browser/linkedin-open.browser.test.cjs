// The Easy Apply panel hydrates after the click. A cold job page can open it
// after several seconds, and the open must not be reported as missing.

const assert = require('node:assert/strict');
const test = require('node:test');

const { withPage, closeBrowser } = require('./harness.cjs');

const slowPanel = `
  <h1>Software Engineer (Java)</h1>
  <div class="jobs-description-content__text">Java and Spring Boot.</div>
  <button aria-label="Easy Apply to this job">Easy Apply</button>
  <div id="panel" role="dialog" hidden>
    <p>Apply to Acme</p>
    <input aria-label="Email address">
  </div>
  <script>
    document.querySelector('button').addEventListener('click', () => {
      setTimeout(() => { document.getElementById('panel').hidden = false; }, 3500);
    });
  </script>
`;

test('a slow apply panel is waited for instead of reported missing', async () => {
  const record = await withPage(slowPanel, async (page) => {
    await page.goto('https://www.linkedin.com/jobs/view/4488999999/');
    return page.evaluate(async () => {
      const api = window.__JAT_API__;
      return api.openApply(window.__JAT_PAGE__, {
        id: '4488999999',
        url: 'https://www.linkedin.com/jobs/view/4488999999/',
      });
    });
  });
  try {
    assert.equal(record.status, 'open');
    assert.ok(record.controls >= 1);
  } finally {
    await closeBrowser();
  }
});
