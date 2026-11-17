// The results list reloads after the filter panel closes and the cards mount
// a moment later. An empty first read must not end the run.

const assert = require('node:assert/strict');
const test = require('node:test');

const { collectJobsWhenReady } = require('../../linkedin/automation/03-collect.js');
const { withPage, closeBrowser } = require('./harness.cjs');

test('collection waits for cards that mount after the first read', async () => {
  const html = `
    <ul id="list"></ul>
    <script>
      setTimeout(() => {
        const item = document.createElement('li');
        item.className = 'jobs-search-results__list-item';
        item.innerHTML = '<a href="/jobs/view/4488000001/">Software Engineer</a>'
          + '<div>Acme</div><div>India (Remote)</div>';
        document.getElementById('list').appendChild(item);
      }, 900);
    </script>
  `;
  const jobs = await withPage(html, (page) => collectJobsWhenReady(page));
  try {
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].id, '4488000001');
    assert.match(jobs[0].location, /remote/i);
  } finally {
    await closeBrowser();
  }
});
