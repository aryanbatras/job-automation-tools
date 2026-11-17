// 01-preflight.js
// The gate. Nothing runs unless the confirmed data is complete.

const preflight = async (page, config) => {
  const errors = [];

  if (!config) {
    return { ok: false, errors: ['configuration_missing'] };
  }
  if (!config.preflight || config.preflight.status !== 'ready') {
    errors.push('profile_preflight_not_ready');
  }
  if (!config.preferences || !config.preferences.version) {
    errors.push('preferences_missing');
  } else {
    const search = config.preferences.search || {};
    if (!search.keywords || !String(search.keywords).trim()) {
      errors.push('preferences.search.keywords');
    }
  }
  if (!Array.isArray(config.answers) || config.answers.length === 0) {
    errors.push('answers_missing');
  }

  const resumeFile = (config.preferences && config.preferences.answers && config.preferences.answers.resumeFile) || '';
  if (resumeFile && !config.answers.some((entry) => entry.label === 'resume')) {
    errors.push('resume_answer_missing');
  }

  return { ok: errors.length === 0, errors };
};

if (typeof module === 'object' && module.exports) {
  module.exports = { preflight };
}
