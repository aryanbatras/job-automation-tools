// 02-search.js
// Builds the search from preferences and puts the results page in the state
// the machine expects: the right keywords, the Easy Apply filter, and the
// Remote filter when the page exposes it.

// LinkedIn filters "date posted" by seconds since posting. "any" is the feed default.
const DATE_POSTED_FILTERS = {
  '1h': 'r3600',
  '24h': 'r86400',
  '7d': 'r604800',
  '30d': 'r2592000',
};

// LinkedIn experience level codes.
const EXPERIENCE_LEVELS = {
  internship: 1,
  entry: 2,
  associate: 3,
  mid: 4,
  senior: 5,
  executive: 6,
};

const buildSearchUrl = (preferences, pageIndex) => {
  const search = (preferences && preferences.search) || {};
  const parts = [];
  const add = (key, value) => {
    if (value === undefined || value === null || value === '') return;
    parts.push(`${key}=${encodeURIComponent(String(value))}`);
  };
  add('keywords', search.keywords);
  add('location', search.location);
  add('geoId', search.geoId);
  if (search.easyApplyOnly) add('f_AL', 'true');
  if (search.remoteOnly) add('f_WT', '2');
  const datePosted = String(search.datePosted || 'any').toLowerCase();
  if (DATE_POSTED_FILTERS[datePosted]) add('f_TPR', DATE_POSTED_FILTERS[datePosted]);
  const levels = (search.experienceLevels || [])
    .map((level) => EXPERIENCE_LEVELS[String(level).toLowerCase()])
    .filter(Boolean);
  if (levels.length > 0) add('f_E', levels.join(','));
  if (pageIndex > 0) add('start', String(pageIndex * 25));
  return `https://www.linkedin.com/jobs/search-results/?${parts.join('&')}`;
};

// The labels the jobs filter panel exposes for each preference value.
const EXPERIENCE_LABELS = {
  internship: 'Internship',
  entry: 'Entry-level',
  associate: 'Associate',
  mid: 'Mid-Senior level',
  senior: 'Senior',
  director: 'Director',
  executive: 'Executive',
};

// The panel has no "past hour" choice; the narrowest real window is used.
const DATE_LABELS = {
  '1h': 'Past 24 hours',
  '24h': 'Past 24 hours',
  '7d': 'Past week',
  '30d': 'Past month',
};

// The URL cannot carry the filters: LinkedIn drops f_WT and f_E when it
// redirects, so every run sets them in the jobs filter panel instead.
const filterPlan = (preferences) => {
  const search = (preferences && preferences.search) || {};
  const plan = [];
  if (search.remoteOnly) plan.push({ label: 'Remote', want: true });
  for (const level of search.experienceLevels || []) {
    const label = EXPERIENCE_LABELS[String(level).toLowerCase()];
    if (label) plan.push({ label, want: true });
  }
  const date = DATE_LABELS[String(search.datePosted || 'any').toLowerCase()];
  if (date) plan.push({ label: date, want: true });
  if (search.easyApplyOnly) plan.push({ label: 'Easy Apply', want: true });
  return plan;
};

// innerText also reads a hidden panel (it falls back to textContent), so the
// panel is only real when it has a rendered box.
const panelFinder = `(function () {
  return Array.from(document.querySelectorAll('div'))
    .find((node) => node.getBoundingClientRect().height > 0
      && (node.innerText || '').trim().startsWith('Jobs filters')) || null;
})()`;

const openFilterPanel = (page) =>
  page.evaluate(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const findPanel = () => ${panelFinder};
    if (findPanel()) return { status: 'open' };
    const visible = (node) => node.getBoundingClientRect().height > 0;
    const opener = Array.from(document.querySelectorAll('[role="button"], button, a, span'))
      .find((node) => visible(node) && /^all filters$/i.test((node.innerText || '').trim()));
    if (!opener) return { status: 'missing' };
    opener.click();
    for (let tick = 0; tick < 20; tick += 1) {
      await wait(250);
      if (findPanel()) return { status: 'open' };
    }
    return { status: 'not_opened' };
  })()`);

// LinkedIn opens a "Preferences match" popover over the panel on some accounts.
const dismissPreferencesPopover = (page) =>
  page.evaluate(`(() => {
    const popover = Array.from(document.querySelectorAll('div'))
      .find((node) => (node.innerText || '').trim().startsWith('Preferences match'));
    if (!popover) return false;
    const buttons = Array.from(popover.querySelectorAll('button'));
    const close = buttons.find((button) => /close|dismiss/i.test(button.getAttribute('aria-label') || ''))
      || buttons[buttons.length - 1];
    if (!close) return false;
    close.click();
    return true;
  })()`);

const setFilterControl = (page, { label, want }) =>
  page.evaluate(`(({ label, want }) => {
    const panel = ${panelFinder};
    if (!panel) return 'no_panel';
    const target = String(label).toLowerCase();
    const control = Array.from(panel.querySelectorAll('input')).find(
      (input) => String(input.getAttribute('aria-label') || '').toLowerCase() === target,
    );
    if (!control) return 'missing';
    if (control.checked !== want) control.click();
    return control.checked === want ? 'set' : 'not_set';
  })(${JSON.stringify({ label, want })})`);

const submitFilterPanel = (page) =>
  page.evaluate(`(async () => {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const panel = ${panelFinder};
    if (!panel) return { status: 'no_panel' };
    const visible = (node) => node.getBoundingClientRect().height > 0;
    const isShow = (node) => (node.innerText || '').trim().toLowerCase() === 'show results';
    const show = Array.from(panel.querySelectorAll('span, button, a')).filter(
      (node) => visible(node) && isShow(node),
    ).sort((left, right) => (left.innerText || '').length - (right.innerText || '').length)[0];
    if (!show) return { status: 'no_show_results' };
    show.click();
    for (let tick = 0; tick < 16; tick += 1) {
      await wait(250);
      if (!document.body.innerText.includes('Jobs filters')) break;
    }
    return { status: 'ok' };
  })()`);

// The chips under the search box are the panel's own record of what is on.
const activeFilterLabels = (page) =>
  page.evaluate(`(() => {
    const labels = [];
    const nodes = Array.from(document.querySelectorAll('[role="button"], button, a'));
    for (const node of nodes) {
      const text = (node.innerText || '').trim();
      if (!text || text.length > 24) continue;
      if (node.getBoundingClientRect().height === 0) continue;
      if (!labels.some((label) => label.toLowerCase() === text.toLowerCase())) labels.push(text);
    }
    return labels;
  })()`);

const applySearchFilters = async (page, preferences) => {
  const plan = filterPlan(preferences);
  const applied = [];
  const notFound = [];
  if (plan.length === 0) return { applied, notFound, active: [], missingFromBar: [] };

  const opened = await openFilterPanel(page);
  if (opened.status !== 'open') {
    return { applied, notFound: plan.map((item) => item.label), error: opened.status, missingFromBar: [] };
  }
  await dismissPreferencesPopover(page);

  for (const item of plan) {
    const state = await setFilterControl(page, item);
    if (state === 'set') applied.push({ filter: item.label, state: 'checked' });
    else notFound.push(item.label);
  }

  const submitted = await submitFilterPanel(page);
  if (submitted.status !== 'ok') notFound.push('Show results');

  // The chips render with the result list, a moment after the panel closes.
  let active = await activeFilterLabels(page);
  for (let tick = 0; tick < 8; tick += 1) {
    const pending = applied
      .map((entry) => entry.filter)
      .filter((label) => !active.some((text) => text.toLowerCase() === label.toLowerCase()));
    if (pending.length === 0) break;
    await page.waitForTimeout(500);
    active = await activeFilterLabels(page);
  }
  const missingFromBar = applied
    .map((entry) => entry.filter)
    .filter((label) => !active.some((text) => text.toLowerCase() === label.toLowerCase()));
  return { applied, notFound, active, missingFromBar };
};

const openSearch = async (page, preferences, pageIndex) => {
  const url = buildSearchUrl(preferences, pageIndex);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await installHelpers(page);
  const filters = await applySearchFilters(page, preferences);
  // Setting the panel reloads the list; the cards arrive a moment later.
  await page
    .locator('[role="button"][componentkey], li[data-occludable-job-id]')
    .first()
    .waitFor({ timeout: 8000 })
    .catch(() => {});
  return { url: page.url(), filters };
};

if (typeof module === 'object' && module.exports) {
  module.exports = {
    buildSearchUrl,
    filterPlan,
    openFilterPanel,
    setFilterControl,
    submitFilterPanel,
    activeFilterLabels,
    applySearchFilters,
    openSearch,
    DATE_POSTED_FILTERS,
    DATE_LABELS,
    EXPERIENCE_LABELS,
    EXPERIENCE_LEVELS,
  };
}
