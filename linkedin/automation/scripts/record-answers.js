#!/usr/bin/env node
// record-answers.js
// Merges the questions an application run reported into the learned answer
// bank. A question the run answered becomes a reusable pair; a question it
// could not answer becomes a pending entry for the person to fill in.
//
// Confirmed answers always win: an entry that matches a confirmed label is
// never added, so the learned file cannot override the profile.
//
// Usage: node linkedin/automation/scripts/record-answers.js <result.json> [more.json|-]

const fs = require('node:fs');
const path = require('node:path');

const contentRoot = path.join(__dirname, '..', '..', 'content');
const DEFAULT_BANK = path.join(contentRoot, 'local', 'learned-answers.json');
const DEFAULT_CONFIRMED = path.join(contentRoot, 'local', 'pending-answers.json');

// The same normalization the page runtime uses, so a label matches the bank
// exactly the way it matches a form control.
const norm = (value) =>
  String(value == null ? '' : value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};

const writeJson = (file, value) => {
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
};

const unique = (values) => Array.from(new Set(values.filter(Boolean)));

// A run result, a list of results, or the whole engine result object.
const questionEntries = (payload) => {
  const records = Array.isArray(payload)
    ? payload
    : payload && Array.isArray(payload.results)
      ? payload.results
      : [payload];
  const out = [];
  for (const record of records) {
    if (!record || !Array.isArray(record.questions)) continue;
    for (const question of record.questions) {
      out.push({ ...question, jobId: String(record.id || '') });
    }
  }
  return out;
};

const mergeQuestions = (bank, confirmed, questions, now = new Date().toISOString()) => {
  const answers = bank.answers || (bank.answers = {});
  const pending = bank.pending || (bank.pending = {});
  const confirmedLabels = new Set(
    (confirmed || []).map((entry) => norm(entry && entry.label)).filter(Boolean),
  );
  const outcome = { added: [], updated: [], conflicts: [], pending: [] };

  for (const question of questions) {
    const key = norm(question && question.label);
    if (!key) continue;
    const value = question.value == null ? '' : String(question.value).trim();

    if (!value) {
      const entry = pending[key] || { label: String(question.label).trim(), timesSeen: 0 };
      entry.timesSeen += 1;
      entry.lastSeen = now;
      entry.reason = question.reason || entry.reason || '';
      if (question.type) entry.type = question.type;
      if (Array.isArray(question.options) && question.options.length > 0) {
        entry.options = question.options.slice(0, 20);
      }
      if (question.jobId) entry.jobIds = unique([...(entry.jobIds || []), question.jobId]).slice(-5);
      pending[key] = entry;
      outcome.pending.push(entry.label);
      continue;
    }

    if (confirmedLabels.has(key)) continue;

    const existing = answers[key];
    if (!existing) {
      answers[key] = {
        label: String(question.label).trim(),
        value,
        type: question.type || '',
        source: question.source === 'derived' ? 'derived' : 'confirmed',
        timesSeen: 1,
        lastSeen: now,
        jobIds: question.jobId ? [question.jobId] : [],
      };
      outcome.added.push(answers[key].label);
    } else if (existing.value === value) {
      existing.timesSeen = (existing.timesSeen || 1) + 1;
      existing.lastSeen = now;
      if (question.jobId) {
        existing.jobIds = unique([...(existing.jobIds || []), question.jobId]).slice(-5);
      }
      outcome.updated.push(existing.label);
    } else {
      // Two runs disagreed about the same question, so neither value is safe
      // to reuse until a person picks one.
      existing.conflict = true;
      existing.alsoSeen = unique([...(existing.alsoSeen || []), value]).slice(-5);
      existing.lastSeen = now;
      outcome.conflicts.push(existing.label);
    }
    delete pending[key];
  }

  return outcome;
};

// The learned pairs a build may use, lowest priority: they are appended after
// the confirmed entries, so a confirmed label always wins the lookup.
const learnedEntries = (bank) =>
  Object.values((bank && bank.answers) || {})
    .filter(
      (entry) =>
        entry && !entry.conflict && String(entry.value == null ? '' : entry.value).trim() !== '',
    )
    .map((entry) => ({ label: entry.label, value: entry.value }));

const composeAnswers = (confirmed, bank) => [...(confirmed || []), ...learnedEntries(bank)];

const record = ({ payload, confirmedFile = DEFAULT_CONFIRMED, bankFile = DEFAULT_BANK, now }) => {
  const confirmed = readJson(confirmedFile, { entries: [] }).entries || [];
  const bank = readJson(bankFile, { version: 1, answers: {}, pending: {} });
  const questions = questionEntries(payload);
  const outcome = mergeQuestions(bank, confirmed, questions, now);
  bank.version = bank.version || 1;
  bank.updatedAt = now || new Date().toISOString();
  writeJson(bankFile, bank);
  return { ...outcome, questions: questions.length };
};

const main = () => {
  const files = process.argv.slice(2);
  if (files.length === 0) files.push('-');
  const payloads = files.map((file) => {
    const text = file === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8');
    return JSON.parse(text);
  });
  const totals = { added: [], updated: [], conflicts: [], pending: [], questions: 0 };
  for (const payload of payloads) {
    const outcome = record({ payload });
    totals.questions += outcome.questions;
    for (const field of ['added', 'updated', 'conflicts', 'pending']) {
      totals[field].push(...outcome[field]);
    }
  }
  process.stdout.write(
    `${JSON.stringify({
      status: 'ok',
      questions: totals.questions,
      added: unique(totals.added).length,
      updated: unique(totals.updated).length,
      conflicts: unique(totals.conflicts),
      pending: unique(totals.pending),
      bank: path.relative(process.cwd(), DEFAULT_BANK),
    })}\n`,
  );
};

if (typeof module === 'object' && module.exports) {
  module.exports = {
    norm,
    questionEntries,
    mergeQuestions,
    learnedEntries,
    composeAnswers,
    record,
    DEFAULT_BANK,
    DEFAULT_CONFIRMED,
  };
}

if (require.main === module) main();
