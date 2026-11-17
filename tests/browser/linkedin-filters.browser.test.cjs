// Regression tests for the jobs filter panel and for opening one job per page.
//
// LinkedIn drops f_WT/f_E from the URL on redirect, so the filters must be set
// in the panel. A card click in the virtualised results list can select a
// different job, so the engine must navigate to the job page instead.

const assert = require('node:assert/strict');
const test = require('node:test');

const { applySearchFilters } = require('../../linkedin/automation/02-search.js');
const { withPage, withRoutes, loadHelpers, closeBrowser } = require('./harness.cjs');

const filtersPage = `
  <button id="all-filters" role="button">All filters</button>
  <div id="bar"></div>
  <div id="panel" hidden>
    <h1>Jobs filters</h1>
    <label><input type="radio" name="date" aria-label="Past week">Past week</label>
    <label><input type="radio" name="date" aria-label="Past month">Past month</label>
    <label><input type="checkbox" role="switch" aria-label="Easy Apply">Easy Apply</label>
    <label><input type="checkbox" aria-label="Remote">Remote</label>
    <label><input type="checkbox" aria-label="Hybrid">Hybrid</label>
    <label><input type="checkbox" aria-label="Entry-level">Entry-level</label>
    <span id="show-results">Show results</span>
  </div>
  <script>
    const panel = document.getElementById('panel');
    const bar = document.getElementById('bar');
    document.getElementById('all-filters').addEventListener('click', () => {
      panel.hidden = false;
    });
    document.getElementById('show-results').addEventListener('click', () => {
      const labels = ['Remote', 'Entry-level', 'Past week', 'Easy Apply'];
      bar.innerHTML = labels
        .filter((label) => {
          const input = document.querySelector('input[aria-label="' + label + '"]');
          return input && input.checked;
        })
        .map((label) => '<button role="button">' + label + '</button>')
        .join('');
      panel.hidden = true;
    });
  </script>
`;

const preferences = {
  search: { remoteOnly: true, easyApplyOnly: true, datePosted: '7d', experienceLevels: ['entry'] },
};

test('the filter panel sets every preference and the chips confirm it', async () => {
  const result = await withPage(filtersPage, (page) => applySearchFilters(page, preferences));
  try {
    assert.deepEqual(result.notFound, []);
    assert.deepEqual(result.missingFromBar, []);
    assert.deepEqual(result.applied.map((entry) => entry.filter), [
      'Remote',
      'Entry-level',
      'Past week',
      'Easy Apply',
    ]);
    assert.ok(result.active.includes('Remote'));
    assert.ok(result.active.includes('Entry-level'));
  } finally {
    await closeBrowser();
  }
});

test('opening a job never clicks a card from the results list', async () => {
  const resultsPage = `
    <div id="card" role="button" componentkey="job-4488000001">
      Another Software Engineer
    </div>
    <script>
      window.__cardClicked = false;
      document.getElementById('card').addEventListener('click', () => {
        window.__cardClicked = true;
      });
    </script>
  `;
  const opened = await withRoutes(
    (url) => (url.includes('/jobs/view/') ? '<div>job page</div>' : resultsPage),
    async (page) => {
      await loadHelpers(page);
      return page.evaluate(async () => {
        const api = window.__JAT_API__;
        const record = await api.openApply(window.__JAT_PAGE__, {
          id: '4488999999',
          url: 'https://www.linkedin.com/jobs/view/4488999999/',
        });
        return { record, cardClicked: window.__cardClicked, url: location.href };
      });
    },
  );
  try {
    assert.equal(opened.record.status, 'navigate_required');
    assert.equal(opened.cardClicked, false);
    assert.ok(opened.url.includes('search-results'));
  } finally {
    await closeBrowser();
  }
});
