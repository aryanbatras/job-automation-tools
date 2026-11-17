// browser/apply-job.js
// The page side driver: one call, one job.
//
// It owns no logic of its own. The engine in linkedin/automation does the
// work: it opens the job, fills the form, advances, submits and proves the
// submission. This driver only hands the engine the job and the answers.
//
// window.__JAT_JOB__(jobId) applies to one job.
// window.__JAT_BATCH__(limit) applies to the remote jobs on the page.

(() => {
  const runJob = async (jobId, budgetSeconds) => {
    const api = window.__JAT_API__;
    const page = window.__JAT_PAGE__;
    if (!api || !page) {
      return { id: jobId, result: 'no_engine', reason: 'the engine is not installed', gaps: [] };
    }
    const preferences = JSON.parse(JSON.stringify(window.__JAT_PREFS__ || {}));
    preferences.policy = preferences.policy || {};
    if (budgetSeconds) preferences.policy.fieldTimeoutSeconds = budgetSeconds;
    const config = {
      preferences,
      answers: window.__JAT_ANSWERS__ || [],
      preflight: { status: 'ready' },
      profile: window.__JAT_PROFILE__ || {},
    };
    const card = document.querySelector(`[role="button"][componentkey*="${jobId}"]`);
    const lines = card ? (card.innerText || '').split('\n').filter(Boolean) : [];
    const job = {
      id: jobId,
      title: lines[0] || '',
      company: lines[1] || '',
      location: lines.find((line) => /\b(remote|hybrid|on-?site|onsite|anywhere)\b/i.test(line)) || '',
      url: `https://www.linkedin.com/jobs/view/${jobId}/`,
    };
    return api.applyOne(page, job, config);
  };

  window.__JAT_JOB__ = async (jobId, budgetSeconds) => {
    try {
      return await runJob(jobId, budgetSeconds);
    } catch (error) {
      return {
        id: jobId,
        result: 'error',
        reason: String(error).slice(0, 200),
        gaps: [],
      };
    }
  };

  window.__JAT_BATCH__ = async (limit, budgetSeconds) => {
    const max = Math.max(1, Number(limit) || 3);
    const records = [];
    const tried = new Set();
    for (let index = 0; index < max; index += 1) {
      const cards = Array.from(document.querySelectorAll('[role="button"]')).filter((card) =>
        card.querySelector('button[aria-label^="Dismiss "]'),
      );
      const card = cards.find(
        (entry) => {
          const id = (entry.getAttribute('componentkey') || '').match(/(\d{4,})/)?.[1];
          return (
            id &&
            !tried.has(id) &&
            !/\bapplied\b/i.test(entry.innerText || '') &&
            /\bremote\b/i.test(entry.innerText || '')
          );
        },
      );
      const id = card ? (card.getAttribute('componentkey') || '').match(/(\d{4,})/)?.[1] : null;
      if (!id) break;
      tried.add(id);
      const record = await runJob(id, budgetSeconds);
      records.push(record);
      if (record.result === 'submission_unverified') break;
    }
    return records;
  };
})();
