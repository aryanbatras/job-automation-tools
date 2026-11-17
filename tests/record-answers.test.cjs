// The learned answer bank: every question a run met is stored as a pair, and
// a question without an answer is kept as pending instead of guessed.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  norm,
  questionEntries,
  mergeQuestions,
  learnedEntries,
  composeAnswers,
  record,
} = require('../linkedin/automation/scripts/record-answers.js');

const confirmed = [
  { label: 'first name', value: 'Aryan' },
  { label: "What's your current / last drawn salary package in LPA?", value: '25K per month; 4 LPA if annual expectation is asked' },
];

const emptyBank = () => ({ version: 1, answers: {}, pending: {} });

test('a label normalizes the way the page matches controls', () => {
  assert.equal(norm("What's your current / last drawn salary package in LPA?"), 'what s your current last drawn salary package in lpa');
  assert.equal(norm(null), '');
});

test('an answered question is stored as a pair and leaves pending', () => {
  const bank = emptyBank();
  bank.pending[norm('How soon can you join (in days) after accepting the offer?')] = {
    label: 'How soon can you join (in days) after accepting the offer?',
    timesSeen: 1,
  };
  const outcome = mergeQuestions(
    bank,
    confirmed,
    [
      { label: 'How soon can you join (in days) after accepting the offer?', value: '30', source: 'confirmed', type: 'text', jobId: '4490000001' },
      { label: 'How many years of work experience do you have with Hadoop?', value: '0', source: 'derived', type: 'text', jobId: '4490000001' },
    ],
    '2026-11-17T00:00:00.000Z',
  );

  assert.deepEqual(outcome.added, [
    'How soon can you join (in days) after accepting the offer?',
    'How many years of work experience do you have with Hadoop?',
  ]);
  assert.equal(Object.keys(bank.pending).length, 0);
  assert.equal(bank.answers[norm('How many years of work experience do you have with Hadoop?')].source, 'derived');
  assert.deepEqual(bank.answers[norm('How many years of work experience do you have with Hadoop?')].jobIds, ['4490000001']);
});

test('an unanswered question is stored as pending with its reason', () => {
  const bank = emptyBank();
  const outcome = mergeQuestions(
    bank,
    confirmed,
    [{ label: 'Do you require visa sponsorship?', value: null, reason: 'no_answer', type: 'select', options: ['Yes', 'No'], jobId: '4490000002' }],
    '2026-11-17T00:00:00.000Z',
  );
  const entry = bank.pending[norm('Do you require visa sponsorship?')];
  assert.equal(outcome.pending.length, 1);
  assert.equal(entry.reason, 'no_answer');
  assert.deepEqual(entry.options, ['Yes', 'No']);
  assert.equal(Object.keys(bank.answers).length, 0);
});

test('a confirmed label is never overwritten by a learned value', () => {
  const bank = emptyBank();
  mergeQuestions(
    bank,
    confirmed,
    [{ label: "What's your current / last drawn salary package in LPA?", value: '999999', source: 'derived' }],
    '2026-11-17T00:00:00.000Z',
  );
  assert.equal(Object.keys(bank.answers).length, 0);
});

test('the same question seen twice is updated, not duplicated', () => {
  const bank = emptyBank();
  const question = { label: 'How many years of work experience do you have with Java?', value: '1', source: 'confirmed' };
  mergeQuestions(bank, confirmed, [question], '2026-11-17T00:00:00.000Z');
  mergeQuestions(bank, confirmed, [{ ...question, jobId: '4490000003' }], '2026-11-18T00:00:00.000Z');
  const entry = bank.answers[norm(question.label)];
  assert.equal(Object.keys(bank.answers).length, 1);
  assert.equal(entry.timesSeen, 2);
  assert.equal(entry.lastSeen, '2026-11-18T00:00:00.000Z');
});

test('two runs that disagree mark the pair conflicted and stop reusing it', () => {
  const bank = emptyBank();
  const label = 'What is your notice period in days?';
  mergeQuestions(bank, confirmed, [{ label, value: '30', source: 'derived' }], '2026-11-17T00:00:00.000Z');
  const outcome = mergeQuestions(bank, confirmed, [{ label, value: '60', source: 'derived' }], '2026-11-18T00:00:00.000Z');

  const entry = bank.answers[norm(label)];
  assert.equal(outcome.conflicts.length, 1);
  assert.equal(entry.value, '30');
  assert.equal(entry.conflict, true);
  assert.deepEqual(learnedEntries(bank), []);
});

test('the learned pairs come after the confirmed ones, so confirmed wins', () => {
  const bank = emptyBank();
  mergeQuestions(bank, confirmed, [{ label: 'Current company', value: 'Acme', source: 'confirmed' }], '2026-11-17T00:00:00.000Z');
  const entries = composeAnswers(confirmed, bank);
  assert.equal(entries[0].label, 'first name');
  assert.equal(entries.at(-1).label, 'Current company');
  assert.equal(entries.length, confirmed.length + 1);
});

test('a result object is read as a list of questions with their job', () => {
  const questions = questionEntries({
    results: [
      { id: '4490000004', questions: [{ label: 'A', value: null }] },
      { id: '4490000005', questions: [{ label: 'B', value: '2' }] },
    ],
  });
  assert.deepEqual(
    questions.map((question) => [question.label, question.jobId]),
    [
      ['A', '4490000004'],
      ['B', '4490000005'],
    ],
  );
});

test('recording twice is idempotent and writes the bank atomically', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jat-bank-'));
  const bankFile = path.join(directory, 'learned-answers.json');
  const confirmedFile = path.join(directory, 'confirmed.json');
  fs.writeFileSync(confirmedFile, JSON.stringify({ entries: confirmed }));
  const payload = {
    results: [
      {
        id: '4490000006',
        questions: [
          { label: 'How many years of work experience do you have with Java?', value: '1', source: 'confirmed' },
          { label: 'What is your expected CTC?', value: null, reason: 'no_answer' },
        ],
      },
    ],
  };

  record({ payload, bankFile, confirmedFile, now: '2026-11-17T00:00:00.000Z' });
  const first = JSON.parse(fs.readFileSync(bankFile, 'utf8'));
  record({ payload, bankFile, confirmedFile, now: '2026-11-18T00:00:00.000Z' });
  const second = JSON.parse(fs.readFileSync(bankFile, 'utf8'));

  assert.equal(Object.keys(second.answers).length, Object.keys(first.answers).length);
  assert.equal(Object.keys(second.pending).length, 1);
  assert.equal(second.pending[norm('What is your expected CTC?')].timesSeen, 2);
  assert.equal(second.updatedAt, '2026-11-18T00:00:00.000Z');
  assert.equal(fs.existsSync(`${bankFile}.tmp`), false);
});
