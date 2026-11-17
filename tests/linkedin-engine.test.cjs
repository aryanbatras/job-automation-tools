const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { preflight } = require('../linkedin/automation/01-preflight.js');
const { selectJobs, matchJob } = require('../linkedin/automation/04-select.js');
const { buildSearchUrl, filterPlan } = require('../linkedin/automation/02-search.js');

const readyPreferences = {
  version: 1,
  search: { keywords: 'remote java engineer', location: 'India', remoteOnly: true, easyApplyOnly: true, datePosted: '24h', maxPages: 2, maxApplications: 5 },
  targets: { includeTitles: [], excludeTitles: [], excludeCompanies: [], excludeWords: [] },
  answers: { resumeFile: 'resume.pdf', autoFillUnknown: false },
  policy: { requireVerifiedSubmission: true, stopOnChallenge: true, fieldTimeoutSeconds: 30 },
  logging: { markdownFile: 'linkedin/content/local/applications.md' },
};

test('preflight blocks when the profile store is not ready', async () => {
  const result = await preflight({}, { preflight: { status: 'blocked' }, preferences: readyPreferences, answers: [{ label: 'email' }] });
  assert.equal(result.ok, false);
  assert.ok(result.errors.includes('profile_preflight_not_ready'));
});

test('preflight blocks when preferences or answers are missing', async () => {
  const noPreferences = await preflight({}, { preflight: { status: 'ready' }, answers: [] });
  assert.ok(noPreferences.errors.includes('preferences_missing'));
  assert.ok(noPreferences.errors.includes('answers_missing'));

  const noKeywords = await preflight({}, {
    preflight: { status: 'ready' },
    preferences: { ...readyPreferences, search: { ...readyPreferences.search, keywords: '' } },
    answers: [{ label: 'email' }],
  });
  assert.ok(noKeywords.errors.includes('preferences.search.keywords'));
});

test('preflight passes with a ready profile, preferences and answers', async () => {
  const result = await preflight({}, {
    preflight: { status: 'ready' },
    preferences: readyPreferences,
    answers: [{ label: 'email' }, { label: 'resume' }],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});

test('selection keeps remote jobs and drops excluded titles and companies', () => {
  const jobs = [
    { title: 'Java Engineer', company: 'Acme', location: 'India (Remote)' },
    { title: 'Senior Java Engineer', company: 'Acme', location: 'India (Remote)' },
    { title: 'Java Engineer', company: 'Globex', location: 'India (Remote)' },
    { title: 'Java Engineer', company: 'Acme', location: 'Bengaluru (On-site)' },
  ];
  const selected = selectJobs(jobs, {
    search: { remoteOnly: true },
    targets: { excludeWords: ['senior'], excludeCompanies: ['globex'] },
  });
  assert.deepEqual(selected.map((job) => job.company), ['Acme']);
});

test('search url carries the preferences', () => {
  const url = buildSearchUrl(readyPreferences, 1);
  assert.ok(url.includes('keywords=remote%20java%20engineer'));
  assert.ok(url.includes('f_AL=true'));
  assert.ok(url.includes('start=25'));
});

test('search url carries the date posted filter', () => {
  const url = buildSearchUrl(readyPreferences, 0);
  assert.ok(url.includes('f_TPR=r86400'));

  const anyTime = buildSearchUrl(
    { ...readyPreferences, search: { ...readyPreferences.search, datePosted: 'any' } },
    0,
  );
  assert.ok(!anyTime.includes('f_TPR'));

  const week = buildSearchUrl(
    { ...readyPreferences, search: { ...readyPreferences.search, datePosted: '7d' } },
    0,
  );
  assert.ok(week.includes('f_TPR=r604800'));
});

test('the search url is a linkedin jobs search', () => {
  const url = buildSearchUrl(readyPreferences, 0);
  assert.ok(url.startsWith('https://www.linkedin.com/jobs/search-results/'));
});

const matchProfile = {
  skills: { items: ['Java', 'Spring Boot'] },
  employment: { items: [{ start: '2025-01', end: '2026-01' }] },
  preferences: { targetRoles: ['Software Engineer', 'Full Stack Developer'] },
};

test('the second filter accepts a job the profile meets', () => {
  const verdict = matchJob(
    {
      title: 'Software Engineer (Java)',
      description: 'Java and Spring Boot. 1+ years of experience building services.',
    },
    { profile: matchProfile, preferences: { targets: {} } },
  );
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.reasons, []);
});

test('the second filter rejects experience above the profile', () => {
  const verdict = matchJob(
    { title: 'Software Engineer', description: 'Java. 5+ years of experience required.' },
    { profile: matchProfile, preferences: { targets: {} } },
  );
  assert.equal(verdict.ok, false);
  assert.ok(verdict.reasons.includes('needs_5_years'));
});

test('the second filter rejects roles outside the target roles', () => {
  const verdict = matchJob(
    { title: 'Gameplay Programmer', description: 'Java and Spring Boot.' },
    { profile: matchProfile, preferences: { targets: {} } },
  );
  assert.ok(verdict.reasons.includes('title_outside_target_roles'));
});

test('the second filter rejects a description with none of the profile skills', () => {
  const verdict = matchJob(
    { title: 'Software Engineer', description: 'Unreal Engine and C++ only.' },
    { profile: matchProfile, preferences: { targets: { excludeWords: [] } } },
  );
  assert.ok(verdict.reasons.includes('no_matching_skill'));
});

test('the second filter rejects an excluded word in the description', () => {
  const verdict = matchJob(
    { title: 'Software Engineer', description: 'Java. You will lead a small team.' },
    { profile: matchProfile, preferences: { targets: { excludeWords: ['lead'] } } },
  );
  assert.ok(verdict.reasons.includes('description_excluded:lead'));
});

test('title patterns accept a general software engineering title', () => {
  const verdict = matchJob(
    { title: 'AI App Developer', description: 'Java and Spring Boot.' },
    {
      profile: matchProfile,
      preferences: { targets: { titlePatterns: ['software engineer', 'ai app', 'android developer'] } },
    },
  );
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.reasons, []);
});

test('title patterns still reject a title outside software engineering', () => {
  const verdict = matchJob(
    { title: 'Gameplay Programmer', description: 'Java and Spring Boot.' },
    {
      profile: matchProfile,
      preferences: { targets: { titlePatterns: ['software engineer', 'ai app'] } },
    },
  );
  assert.ok(verdict.reasons.includes('title_outside_target_roles'));
});

test('the filter plan mirrors the preferences', () => {
  const plan = filterPlan({
    search: { remoteOnly: true, easyApplyOnly: true, datePosted: '7d', experienceLevels: ['entry'] },
  });
  assert.deepEqual(plan.map((item) => item.label), ['Remote', 'Entry-level', 'Past week', 'Easy Apply']);

  const minimal = filterPlan({ search: { remoteOnly: false, easyApplyOnly: false, datePosted: 'any' } });
  assert.deepEqual(minimal, []);
});
