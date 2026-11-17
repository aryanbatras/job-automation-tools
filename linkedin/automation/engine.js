// engine.js
// The orchestrator. Runs the numbered modules in order for every matching job
// and returns one record per job. It never writes anything itself: the caller
// records the results.

const applyOne = async (page, job, config) => {
  const record = {
    job: job.title,
    company: job.company,
    location: job.location,
    url: job.url,
    id: job.id,
    result: 'unknown',
    reason: '',
    gaps: [],
    questions: [],
    trace: [],
  };

  const policy = (config.preferences && config.preferences.policy) || {};
  const budgetMs = Math.max(5, Number(policy.fieldTimeoutSeconds) || 30) * 1000;
  const startedAt = Date.now();

  try {
    await installHelpers(page);
    const opened = await openApply(page, job, {
      profile: config.profile,
      preferences: config.preferences,
    });
    if (opened.status !== 'open') {
      record.result = opened.status;
      record.reason = opened.reason || '';
      return record;
    }
    await installConfig(page, config);

    for (let step = 0; step < 6; step += 1) {
      if (policy.stopOnChallenge !== false && (await challengePresent(page))) {
        record.result = 'human_intervention_required';
        record.reason = 'captcha_detected';
        return record;
      }

      if (Date.now() - startedAt > budgetMs) {
        record.result = 'field_timeout';
        record.reason = 'field_budget_exceeded';
        return record;
      }

      const fill = await fillFields(page, config.answers);
      for (const gap of fill.gaps) {
        record.gaps.push(`${gap.label} (${gap.reason})`);
        record.questions.push({ label: gap.label, value: null, reason: gap.reason });
      }
      for (const pair of fill.pairs || []) {
        if (record.questions.some((question) => question.label === pair.label)) continue;
        record.questions.push(pair);
      }
      record.trace.push({
        filled: fill.filled.length,
        gaps: fill.gaps.length,
        pairs: (fill.pairs || []).length,
        scopeFound: Boolean(fill.scopeFound),
      });

      // Guardrail: nothing is submitted while a required control is unanswered.
      const inspected = await inspectFields(page);
      const missing = inspected.fields
        .filter((field) => field.required && !field.filled)
        .map((field) => field.label || field.type);
      if (missing.length > 0) {
        record.result = 'needs_answers';
        record.reason = missing.join(', ');
        for (const label of missing) {
          record.gaps.push(`${label} (no_answer)`);
          record.questions.push({ label, value: null, reason: 'no_answer' });
        }
        return record;
      }

      // A red inline message already on the step means the page rejected a
      // value. Purely stale messages (the control is valid now) are left to
      // the next click, which is where LinkedIn re-validates. A control that
      // is invalid right now stops the whole run: the person fixes this job by
      // hand and the question goes into the answer bank.
      const liveErrors = (inspected.broken || []).filter(
        (broken) => broken.ariaInvalid || broken.over || broken.valid === false,
      );
      if (liveErrors.length > 0) {
        record.result = 'field_validation_error';
        record.reason = liveErrors.map((broken) => broken.label || broken.id || 'unknown').join(' | ');
        record.formErrors = { errors: inspected.errors || [], broken: inspected.broken || [] };
        for (const broken of liveErrors) {
          record.questions.push({
            label: broken.label || broken.id || 'unknown',
            value: broken.value || null,
            reason: 'invalid_answer',
          });
        }
        return record;
      }

      const advanced = await advanceStep(page);
      if (advanced.status === 'submit_ready') {
        const clicked = await submitApplication(page);
        record.result = clicked.clicked ? 'submitted_clicked' : clicked.status;
        record.reason = clicked.reason || '';
        break;
      }
      record.detail = advanced.detail || null;
      if (advanced.status === 'needs_answers') {
        record.result = 'needs_answers';
        const named = advanced.missing || [];
        record.reason = named.join(', ');
        for (const label of named) {
          if (!record.gaps.some((gap) => gap.startsWith(`${label} (`))) {
            record.gaps.push(`${label} (no_answer)`);
          }
          if (!record.questions.some((question) => question.label === label)) {
            record.questions.push({ label, value: null, reason: 'no_answer' });
          }
        }
        return record;
      }
      if (advanced.status === 'validation_error') {
        // Never repair a rejected answer in place, and never advance again.
        // The form is in an unknown state: the run stops here.
        const named = (advanced.missing || []).length > 0 ? advanced.missing : [];
        record.result = 'field_validation_error';
        record.reason = [...(advanced.errors || []), ...named].join(' | ');
        record.formErrors = { errors: advanced.errors || [], missing: named };
        for (const label of named) record.questions.push({ label, value: null, reason: 'invalid_answer' });
        return record;
      }
      if (advanced.status !== 'advanced') {
        record.result = 'manual_step';
        record.reason = advanced.status;
        return record;
      }
      if (advanced.moved === false) {
        record.result = 'manual_step';
        record.reason = 'step_did_not_move';
        return record;
      }
    }

    if (record.result === 'submitted_clicked') {
      const verification = await verifySubmission(page, job);
      record.result = verification.verified ? 'submitted' : 'submission_unverified';
      record.signals = verification.signals;
    } else if (record.result === 'unknown') {
      record.result = 'manual_step';
      record.reason = 'no_submit_reached';
    }
    return record;
  } catch (error) {
    record.result = 'error';
    record.reason = String(error).slice(0, 180);
    return record;
  } finally {
    await closeApply(page).catch(() => {});
  }
};

// Applies to the jobs that are already on the page. The driver owns the
// search navigation; the engine only walks the list it finds.
const runJobsOnPage = async (page, config, limit) => {
  const preferences = config.preferences || {};
  const maxApplications = Math.max(1, Number(limit) || preferences.search?.maxApplications || 10);
  const jobs = await collectJobsWhenReady(page);
  const selected = selectJobs(jobs, preferences);
  const results = [];
  const gaps = [];
  let applications = 0;

  for (const job of selected) {
    if (applications >= maxApplications) break;
    const record = await applyOne(page, job, config);
    results.push(record);
    if (record.result === 'submitted') applications += 1;
    for (const gap of record.gaps) {
      gaps.push({ job: record.job, company: record.company, gap });
    }
    if (record.result === 'human_intervention_required') break;
    if (record.result === 'submission_unverified') break;
    // Any form problem stops the run. Skipping to the next job after a red
    // error hides the broken form and can strand a half-finished application.
    if (!['skipped', 'already_applied', 'external_application_system'].includes(record.result)) break;
  }

  return {
    status: 'ok',
    applications,
    results,
    gaps,
    search: { url: page.url(), keywords: preferences.search?.keywords || '' },
  };
};

// The MCP driver can lose the returned value when the page navigates during
// the run. Keep the last result readable from the page as well.
const stashResult = async (page, result) => {
  await page
    .evaluate((payload) => {
      window.__JAT_RESULT__ = payload;
      try {
        sessionStorage.setItem('__JAT_RESULT__', JSON.stringify(payload));
      } catch {
        // Storage can be full or blocked; the in-memory copy is enough.
      }
    }, result)
    .catch(() => {});
};

const runEngine = async (page, providedConfig) => {
  // The embedded config is the bundle that is running right now. A config
  // left in the page by an earlier bundle would be stale, so it is ignored.
  // Tests may pass a config explicitly as the second argument.
  const config = providedConfig || {
    preferences: EMBEDDED_PREFERENCES,
    answers: EMBEDDED_ANSWERS,
    preflight: EMBEDDED_PREFLIGHT,
    profile: EMBEDDED_PROFILE,
  };
  const gate = await preflight(page, config);
  if (!gate.ok) {
    const blocked = {
      status: 'blocked',
      reason: 'preflight_failed',
      errors: gate.errors,
      results: [],
      gaps: [],
    };
    await stashResult(page, blocked);
    return blocked;
  }

  const preferences = config.preferences;
  const search = preferences.search || {};
  const maxPages = Math.max(1, Number(search.maxPages) || 1);
  const maxApplications = Math.max(1, Number(search.maxApplications) || 10);

  const maxAttempts = Math.max(1, Number(search.maxAttempts) || maxApplications * 2);
  const results = [];
  const gaps = [];
  let applications = 0;
  let attempts = 0;
  let stop = false;
  // The panel reloads the list without the `start` offset, so later pages can
  // repeat page one. A job is attempted once per run.
  const attempted = new Set();

  // `keywords` may name one search or several; each one is a separate query.
  const keywordList = (Array.isArray(search.keywords) ? search.keywords : [search.keywords])
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const searches = [];
  for (const keyword of keywordList.length > 0 ? keywordList : ['']) {
    for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) searches.push({ keyword, pageIndex });
  }

  for (const { keyword, pageIndex } of searches) {
    if (stop) break;
    const scoped = { ...preferences, search: { ...search, keywords: keyword } };
    await openSearch(page, scoped, pageIndex);
    await installConfig(page, config);
    const jobs = await collectJobsWhenReady(page);
    const selected = selectJobs(jobs, preferences);

    for (const job of selected) {
      if (attempted.has(job.id)) continue;
      if (applications >= maxApplications || attempts >= maxAttempts) {
        stop = true;
        break;
      }
      attempted.add(job.id);
      attempts += 1;
      const record = await applyOne(page, job, config);
      record.page = pageIndex;
      results.push(record);
      if (record.result === 'submitted') applications += 1;
      for (const gap of record.gaps) {
        gaps.push({ job: record.job, company: record.company, gap });
      }
      if (record.result === 'human_intervention_required') {
        stop = true;
        break;
      }
      // A submission that could not be verified leaves the account in an
      // unknown state. Stop; never retry, never stack another application.
      if (record.result === 'submission_unverified') {
        stop = true;
        break;
      }
      // Any form problem stops the run, not just this job: a red error means
      // the form was rejected and the person must review that application.
      if (!['skipped', 'already_applied', 'external_application_system'].includes(record.result)) {
        stop = true;
        break;
      }
    }
  }

  const final = {
    status: 'ok',
    applications,
    results,
    gaps,
    search: { url: page.url(), keywords: search.keywords || '' },
  };
  await stashResult(page, final);
  return final;
};
