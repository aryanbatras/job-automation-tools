// 04-select.js
// Applies the user's target rules to the collected cards. Pure logic, no
// browser access, so it is easy to reason about and to test.

const selectJobs = (jobs, preferences) => {
  const search = (preferences && preferences.search) || {};
  const targets = (preferences && preferences.targets) || {};
  const includeTitles = (targets.includeTitles || []).map((value) => value.toLowerCase());
  const excludeTitles = (targets.excludeTitles || []).map((value) => value.toLowerCase());
  const excludeCompanies = (targets.excludeCompanies || []).map((value) => value.toLowerCase());
  const excludeWords = (targets.excludeWords || []).map((value) => value.toLowerCase());

  const onlyJobIds = (targets.onlyJobIds || []).map((value) => String(value));

  const selected = [];
  for (const job of jobs) {
    if (job.applied) continue;
    if (onlyJobIds.length > 0 && !onlyJobIds.includes(String(job.id))) continue;
    const title = (job.title || '').toLowerCase();
    const company = (job.company || '').toLowerCase();
    const location = job.location || '';

    if (search.remoteOnly && !/remote/i.test(location)) continue;
    if (excludeTitles.some((value) => title.includes(value))) continue;
    if (excludeCompanies.some((value) => company.includes(value))) continue;
    if (excludeWords.some((value) => title.includes(value))) continue;
    if (includeTitles.length > 0 && !includeTitles.some((value) => title.includes(value))) continue;

    selected.push(job);
  }
  return selected;
};

// The second filter: the job itself. A job is only applied to when the
// description asks for no more experience than the profile has, names at
// least one of the profile's skills, and sits inside the target roles.

const monthIndex = (value) => {
  const match = String(value || '').match(/(\d{4})(?:-(\d{1,2}))?/);
  if (!match) return null;
  return Number(match[1]) * 12 + (Number(match[2] || 1) - 1);
};

const candidateYears = (profile, now) => {
  const items = (profile && profile.employment && profile.employment.items) || [];
  const current = now instanceof Date ? now : new Date();
  let months = 0;
  for (const item of items) {
    const start = monthIndex(item.start);
    const open = !item.end || /present|current/i.test(String(item.end));
    const end = open ? monthIndex(current.toISOString().slice(0, 7)) : monthIndex(item.end);
    if (start === null || end === null || end < start) continue;
    months += end - start + 1;
  }
  return Math.round((months / 12) * 10) / 10;
};

// "5+ years of experience", "minimum 3 years", "at least 2 years".
const requiredYears = (text) => {
  const source = String(text || '');
  const found = [];
  const quantified = /(\d+(?:\.\d+)?)\s*\+?\s*(?:-|to)?\s*(?:\d+(?:\.\d+)?\s*\+?\s*)?years?\s+(?:of\s+)?(?:relevant\s+|professional\s+|work\s+)?experience/gi;
  let match = quantified.exec(source);
  while (match) {
    found.push(Number(match[1]));
    match = quantified.exec(source);
  }
  const minimum = /(?:minimum|min\.?|at least|more than|over)\s+(\d+(?:\.\d+)?)\s*\+?\s*years?/gi;
  match = minimum.exec(source);
  while (match) {
    found.push(Number(match[1]));
    match = minimum.exec(source);
  }
  return found.length > 0 ? Math.max(...found) : 0;
};

const targetRoles = (profile, preferences) => {
  const targets = (preferences && preferences.targets) || {};
  if (Array.isArray(targets.includeTitles) && targets.includeTitles.length > 0) {
    return targets.includeTitles;
  }
  return (profile && profile.preferences && profile.preferences.targetRoles) || [];
};

const matchJob = (job, context) => {
  const profile = (context && context.profile) || {};
  const preferences = (context && context.preferences) || {};
  const targets = preferences.targets || {};
  const reasons = [];

  const title = String(job.title || '').toLowerCase();
  const description = String(job.description || '');
  const text = description.toLowerCase();

  if (targets.excludeWords && targets.excludeWords.length > 0) {
    const hit = targets.excludeWords.find((word) => text.includes(String(word).toLowerCase()));
    if (hit) reasons.push(`description_excluded:${hit}`);
  }

  const roles = targetRoles(profile, preferences).map((role) => String(role).toLowerCase());
  const titlePatterns = (targets.titlePatterns || []).map((pattern) => new RegExp(pattern, 'i'));
  if (titlePatterns.length > 0) {
    if (title && !titlePatterns.some((pattern) => pattern.test(title))) {
      reasons.push('title_outside_target_roles');
    }
  } else if (roles.length > 0 && title && !roles.some((role) => title.includes(role))) {
    reasons.push('title_outside_target_roles');
  }

  if (description) {
    const needed = requiredYears(description);
    const years = candidateYears(profile);
    if (needed > 0 && years > 0 && needed > years) reasons.push(`needs_${needed}_years`);
    const skills = ((profile.skills && profile.skills.items) || [])
      .map((skill) => String(skill).toLowerCase())
      .filter(Boolean);
    if (skills.length > 0 && !skills.some((skill) => text.includes(skill))) {
      reasons.push('no_matching_skill');
    }
  }

  return { ok: reasons.length === 0, reasons };
};

if (typeof module === 'object' && module.exports) {
  module.exports = { selectJobs, matchJob, candidateYears, requiredYears };
}
