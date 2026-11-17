// Regression tests for every page-side failure recorded so far.
//
// One fixture per failure. The fixture is the DOM the engine met when it
// broke, so a regression cannot pass by accident.

const assert = require('node:assert/strict');
const test = require('node:test');

const { withPage, loadHelpers, closeBrowser } = require('./harness.cjs');

test.after(async () => {
  await closeBrowser();
});

const answers = [
  { label: 'email address', value: 'person@example.test', keywords: ['email'] },
  { label: 'phone number', value: '+91 9000000000', keywords: ['phone'] },
  { label: 'first name', value: 'Aryan', keywords: ['first name'] },
  { label: 'last name', value: 'Batra', keywords: ['last name'] },
  {
    label: "What's your current / last drawn salary package in LPA?",
    value: '25K per month; 4 LPA if annual expectation is asked',
    keywords: ['current salary package'],
  },
];

const installAnswers = (page) =>
  page.evaluate((value) => {
    window.__JAT__ = value;
  }, { answers, preferences: {} });

test('a hidden dialog is not the apply surface', async () => {
  const html = `
    <div role="dialog" style="display:none">
      <h2>Apply to Acme</h2>
      <button>Next</button>
    </div>
    <button id="easy" aria-label="Easy Apply to this job">Easy Apply</button>`;
  await withPage(html, async (page) => {
    await loadHelpers(page);
    const scope = await page.evaluate(() => {
      const found = window.__JAT_HELPERS__.applyScope();
      return found ? found.tagName + ':' + found.innerText.slice(0, 20) : null;
    });
    assert.equal(scope, null);
  });
});

test('the painted span resolves to the button that owns the click handler', async () => {
  const html = `
    <div role="dialog" aria-label="Apply to Acme">
      <h2>Apply to Acme</h2>
      <footer><button id="next"><span>Next</span></button></footer>
    </div>`;
  await withPage(html, async (page) => {
    await loadHelpers(page);
    const found = await page.evaluate(() => {
      const helpers = window.__JAT_HELPERS__;
      const scope = helpers.applyScope();
      const controls = helpers.textControls(/^next$/i, scope);
      return controls.map((node) => node.id || node.tagName);
    });
    assert.deepEqual(found, ['next']);
  });
});

test('a control outside the apply surface is never a form control', async () => {
  const html = `
    <nav><button id="list-next">Next</button></nav>
    <div role="dialog" aria-label="Apply to Acme">
      <h2>Apply to Acme</h2>
      <p>No footer yet</p>
    </div>`;
  await withPage(html, async (page) => {
    await loadHelpers(page);
    const found = await page.evaluate(() => {
      const helpers = window.__JAT_HELPERS__;
      const scope = helpers.applyScope();
      return helpers.textControls(/^next$/i, scope).length;
    });
    assert.equal(found, 0);
  });
});

test('card-shaped rows inside the dialog do not hide the form controls', async () => {
  const html = `
    <div role="button" componentkey="job-card-component-ref-123"><span>Card</span></div>
    <div role="dialog" aria-label="Apply to Acme">
      <h2>Apply to Acme</h2>
      <div role="button" componentkey="resume-row"><span>resume.pdf</span></div>
      <footer><button id="next">Next</button></footer>
    </div>`;
  await withPage(html, async (page) => {
    await loadHelpers(page);
    const found = await page.evaluate(() => {
      const helpers = window.__JAT_HELPERS__;
      const scope = helpers.applyScope();
      return helpers.textControls(/^next$/i, scope).map((node) => node.id);
    });
    assert.deepEqual(found, ['next']);
  });
});

test('the character counter is not an error, "Invalid input" is', async () => {
  const html = `
    <div role="dialog" aria-label="Apply to Acme">
      <h2>Apply to Acme</h2>
      <label for="salary">Salary in LPA</label>
      <input id="salary" aria-describedby="salary-info salary-error">
      <p id="salary-info">4/20</p>
      <p id="salary-error"></p>
    </div>`;
  await withPage(html, async (page) => {
    await loadHelpers(page);
    const clean = await page.evaluate(() => {
      const helpers = window.__JAT_HELPERS__;
      const input = document.getElementById('salary');
      input.value = '4';
      return helpers.controlError(input);
    });
    assert.equal(clean.message, '');
    assert.equal(clean.over, false);

    const rejected = await page.evaluate(() => {
      const helpers = window.__JAT_HELPERS__;
      const input = document.getElementById('salary');
      input.value = '25K per month';
      document.getElementById('salary-info').textContent = '51/20';
      document.getElementById('salary-error').textContent = 'Invalid input';
      return helpers.controlError(input);
    });
    assert.equal(rejected.over, true);
    assert.equal(rejected.max, 20);
    assert.match(rejected.message, /invalid input/i);
  });
});

test('a rejected answer is bridged with a value derived from the confirmed answer', async () => {
  const html = `
    <div role="dialog" aria-label="Apply to Acme">
      <h2>Apply to Acme</h2>
      <label for="salary">What's your current / last drawn salary package in LPA?</label>
      <input id="salary" pattern="[0-9.]+" aria-describedby="salary-error">
      <p id="salary-error"></p>
      <script>
        const input = document.getElementById('salary');
        const error = document.getElementById('salary-error');
        input.addEventListener('input', () => {
          error.textContent = input.checkValidity() ? '' : 'Invalid input';
        });
      </script>
    </div>`;
  await withPage(html, async (page) => {
    await loadHelpers(page);
    await installAnswers(page);
    const repaired = await page.evaluate(async () => {
      const helpers = window.__JAT_HELPERS__;
      const input = document.getElementById('salary');
      const label = helpers.labelText(input);
      const wanted = helpers.answerFor([label], helpers.aliasesFor(label));
      helpers.setValue(input, String(wanted));
      const before = helpers.controlError(input).message;
      const fixed = await helpers.repairValue(input, String(wanted));
      return { wanted, before, fixed, value: input.value, after: helpers.controlError(input).message };
    });
    assert.match(repaired.before, /invalid input/i);
    assert.equal(repaired.fixed, '3');
    assert.equal(repaired.value, '3');
    assert.equal(repaired.after, '');
  });
});

test('a long answer is trimmed to the length the field accepts', async () => {
  const html = `
    <div role="dialog" aria-label="Apply to Acme">
      <h2>Apply to Acme</h2>
      <label for="name">Full name</label>
      <input id="name" maxlength="10" aria-describedby="name-info">
      <p id="name-info">0/10</p>
    </div>`;
  await withPage(html, async (page) => {
    await loadHelpers(page);
    const repaired = await page.evaluate(async () => {
      const helpers = window.__JAT_HELPERS__;
      const input = document.getElementById('name');
      const value = helpers.valueCandidates('Aryan Batra Jammu', input);
      const fixed = await helpers.repairValue(input, 'Aryan Batra Jammu');
      return { value, fixed, held: input.value };
    });
    assert.ok(repaired.value.length > 0);
    assert.ok(repaired.fixed.length <= 10);
    assert.ok(repaired.held.length <= 10);
  });
});

test('a re-render after a write cannot swallow the rest of the step', async () => {
  const html = `
    <div role="dialog" aria-label="Apply to Acme">
      <h2>Apply to Acme</h2>
      <label for="first">First name</label>
      <input id="first" aria-label="First name">
      <label for="last">Last name</label>
      <input id="last" aria-label="Last name">
      <script>
        document.getElementById('first').addEventListener('input', () => {
          const last = document.getElementById('last');
          last.replaceWith(last.cloneNode(true));
        }, { once: true });
      </script>
    </div>`;
  await withPage(html, async (page) => {
    await loadHelpers(page);
    await installAnswers(page);
    const result = await page.evaluate(async () => {
      const helpers = window.__JAT_HELPERS__;
      const scope = helpers.applyScope();
      const filled = await helpers.fillForm(scope);
      return {
        filled: filled.filled,
        first: document.getElementById('first').value,
        last: document.getElementById('last').value,
      };
    });
    assert.equal(result.first, 'Aryan');
    assert.equal(result.last, 'Batra');
  });
});

test('a control the page rejects still counts as unanswered', async () => {
  const html = `
    <div role="dialog" aria-label="Apply to Acme">
      <h2>Apply to Acme</h2>
      <label for="salary">Salary in LPA</label>
      <input id="salary" required aria-invalid="true" value="25K per month">
      <label for="note">Note</label>
      <input id="note" required value="this answer is far too long for the field" aria-describedby="note-info">
      <p id="note-info">41/20</p>
    </div>`;
  await withPage(html, async (page) => {
    await loadHelpers(page);
    const unanswered = await page.evaluate(() => {
      const helpers = window.__JAT_HELPERS__;
      return helpers.unansweredControls(helpers.applyScope()).map((control) => ({
        id: control.id,
        reason: control.reason || 'empty',
      }));
    });
    assert.deepEqual(unanswered, [
      { id: 'salary', reason: 'invalid_input' },
      { id: 'note', reason: 'answer_too_long' },
    ]);
  });
});

test('an optional question with no answer is not a gap', async () => {
  const html = `
    <div role="dialog" aria-label="Apply to Acme">
      <h2>Apply to Acme</h2>
      <label for="first">First name</label>
      <input id="first">
      <fieldset>
        <legend>Would you like to receive job alerts?</legend>
        <label><input type="radio" name="alerts" value="yes"> Yes</label>
        <label><input type="radio" name="alerts" value="no"> No</label>
      </fieldset>
    </div>`;
  await withPage(html, async (page) => {
    await loadHelpers(page);
    await installAnswers(page);
    const result = await page.evaluate(async () => {
      const helpers = window.__JAT_HELPERS__;
      return helpers.fillForm(helpers.applyScope());
    });
    assert.deepEqual(result.gaps, []);
  });
});

test('a monthly salary answers a current-salary question with its yearly figure', async () => {
  const html = `
    <div role="dialog" aria-label="Apply to Acme">
      <h2>Apply to Acme</h2>
      <label for="current">What's your current / last drawn salary package in LPA?</label>
      <input id="current">
      <label for="ctc">What is your current CTC?</label>
      <input id="ctc">
      <label for="expected">What's your expected salary?</label>
      <input id="expected">
    </div>`;
  await withPage(html, async (page) => {
    await loadHelpers(page);
    await installAnswers(page);
    const found = await page.evaluate(() => {
      const helpers = window.__JAT_HELPERS__;
      const answer = '25K per month; 4 LPA if annual expectation is asked';
      const ctc = document.getElementById('ctc');
      const label = helpers.labelText(ctc);
      return {
        current: helpers.valueCandidates(answer, document.getElementById('current')),
        expected: helpers.valueCandidates(answer, document.getElementById('expected')),
        ctc: helpers.valueCandidates(answer, ctc),
        answerForCtc: helpers.answerFor([label], helpers.aliasesFor(label)),
      };
    });
    assert.equal(found.current[0], '3');
    assert.equal(found.expected[0], '4');
    assert.equal(found.answerForCtc, '25K per month; 4 LPA if annual expectation is asked');
    assert.equal(found.ctc[0], '3');
  });
});

test('an applied card is not applied to a second time', async () => {
  const html = `
    <div role="button" componentkey="job-card-component-ref-111111">
      <button aria-label="Dismiss Java Developer job">Dismiss</button>
      <p>Java Developer</p><p>Acme</p><p>India (Remote)</p><p>Applied</p>
    </div>
    <div role="button" componentkey="job-card-component-ref-222222">
      <button aria-label="Dismiss Backend Engineer job">Dismiss</button>
      <p>Backend Engineer</p><p>Acme</p><p>India (Remote)</p>
    </div>`;
  await withPage(html, async (page) => {
    await loadHelpers(page);
    const selected = await page.evaluate(() => {
      const api = window.__JAT_API__;
      return api
        .collectJobs(window.__JAT_PAGE__)
        .then((jobs) =>
          api
            .selectJobs(jobs, { search: { remoteOnly: true }, targets: {} })
            .map((job) => ({ id: job.id, applied: job.applied })),
        );
    });
    assert.deepEqual(selected, [{ id: '222222', applied: false }]);
  });
});

test('a follow-update checkbox is not a question and is never clicked', async () => {
  const html = `
    <div role="dialog" aria-label="Apply to Acme">
      <h2>Apply to Acme</h2>
      <label for="first">First name</label>
      <input id="first">
      <label><input type="checkbox" id="follow"> Follow Acme to stay up to date with their page</label>
    </div>`;
  await withPage(html, async (page) => {
    await loadHelpers(page);
    await installAnswers(page);
    const result = await page.evaluate(async () => {
      const helpers = window.__JAT_HELPERS__;
      const form = await helpers.fillForm(helpers.applyScope());
      return {
        checked: document.getElementById('follow').checked,
        labels: form.pairs.map((pair) => pair.label),
        gaps: form.gaps.map((gap) => gap.label),
      };
    });
    assert.equal(result.checked, false);
    assert.deepEqual(result.labels, ['First name']);
    assert.deepEqual(result.gaps, []);
  });
});
