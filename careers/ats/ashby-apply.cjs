const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CDP = process.env.CDP_ENDPOINT || 'http://127.0.0.1:9222';
const RESUME_PATH = process.env.RESUME_PATH || path.join(__dirname, '..', '..', 'AryanBatraResume.pdf');
const LOG_PATH = path.join(__dirname, 'ashby-applied.json');
const JOB_URL = process.env.JOB_URL || process.argv[2];

function loadLog() { try { return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); } catch { return { applied: [], failed: [] }; } }
function saveLog(log) { fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2)); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function answerForLabel(label) {
  const l = (label || '').toLowerCase();
  if (l.includes('full name') || l.includes('name')) return 'Aryan Batra';
  if (l.includes('email')) return 'batraaryan03@gmail.com';
  if (l.includes('phone')) return '9149469833';
  if (l.includes('linkedin')) return 'https://www.linkedin.com/in/aryanbatra';
  if (l.includes('github')) return 'https://github.com/aryanbatras';
  if (l.includes('portfolio') || l.includes('website') || l.includes('other website')) return 'https://aryanbatra.is-a.dev';
  if (l.includes('current company')) return 'A2B Digital Solutions';
  if (l.includes('pronoun')) return 'He/Him';
  if (l.includes('institution')) return 'Mahant Bachittar Singh College of Engg. & Tech. (Univ. of Jammu)';
  if (l.includes('additional information')) return 'Java Full Stack Engineer (Spring Boot, React, Next.js, AWS). B.Tech CS 2027.';
  if (l.includes('web applications') || l.includes('technologies did you')) return 'Built full-stack apps with Spring Boot, React, Next.js, PostgreSQL, AWS. Projects: e-commerce (12 microservices), mutual fund platform (14k+ funds).';
  if (l.includes('button component')) return 'Reusable button with variants, sizes, accessibility (ARIA), keyboard support, and design tokens for consistency across the app.';
  if (l.includes('how you found') || l.includes('how did you')) return 'Frontend Mentor entry-level jobs board';
  if (l.includes('how you found this')) return 'Frontend Mentor entry-level jobs board';
  // generic textarea
  return 'Java Full Stack Engineer passionate about building scalable systems and contributing to your team.';
}

async function fillForm(page) {
  // ensure all fields rendered
  try { for (let i=0;i<8;i++){ await page.evaluate(()=>window.scrollBy(0,400)); await page.waitForTimeout(150); } await page.evaluate(()=>window.scrollTo(0,0)); await page.waitForTimeout(500); } catch {}
  // file uploads (resume)
  try {
    await page.locator('#_systemfield_resume').setInputFiles(RESUME_PATH).catch(() => {});
    await sleep(1000);
  } catch {}

  // Current Location combobox
  try {
    const locInput = await page.evaluateHandle(() => {
      const labels = Array.from(document.querySelectorAll('label')).filter(l => l.innerText.trim() === 'Current Location');
      const l = labels[0];
      const container = l ? l.closest('div') : null;
      return container ? container.querySelector('input') : null;
    });
    const el = locInput.asElement();
    if (el) {
      await el.click();
      await el.type('Jammu', {delay: 100});
      await page.waitForTimeout(2000);
      await page.evaluate(() => {
        const opts = Array.from(document.querySelectorAll('[role="option"], li'));
        const target = opts.find(o => /jammu, jammu and kashmir, india/i.test(o.innerText));
        if (target) target.click();
      });
      await page.waitForTimeout(1000);
    }
  } catch {}

  // "What brought you to this job posting" combobox
  try {
    const wbInput = await page.evaluateHandle(() => {
      const labels = Array.from(document.querySelectorAll('label')).filter(l => /what brought you to this job/i.test(l.innerText));
      const l = labels[0];
      const container = l ? l.closest('div') : null;
      return container ? container.querySelector('input') : null;
    });
    const wbel = wbInput.asElement();
    if (wbel) {
      await wbel.click();
      await wbel.type('LinkedIn', {delay: 100});
      await page.waitForTimeout(2000);
      await page.evaluate(() => {
        const opts = Array.from(document.querySelectorAll('[role="option"], li'));
        const target = opts.find(o => /linkedin jobs/i.test(o.innerText));
        if (target) target.click();
      });
      await page.waitForTimeout(1000);
    }
  } catch {}

  // text inputs
  try {
    const inputs = await page.locator('input[type="text"], input[type="email"], input[type="tel"], input[placeholder*="Pick date"]').all();
    for (const inp of inputs) {
      const current = await inp.inputValue().catch(() => '');
      if (current && current.trim()) continue;
      const placeholder = await inp.getAttribute('placeholder').catch(() => '') || '';
      const label = await inp.evaluate(e => (e.labels?.[0]?.innerText || e.getAttribute('aria-label') || e.getAttribute('placeholder') || '').trim()).catch(() => '');
      let val = answerForLabel(label);
      if (/anticipated graduation|graduation date/i.test(label) || /pick date/i.test(placeholder)) val = '2027-06-01';
      if (val) await inp.fill(val).catch(() => {});
      await sleep(50);
    }
  } catch {}

  // textareas
  try {
    const tas = await page.locator('textarea').all();
    for (const ta of tas) {
      const current = await ta.inputValue().catch(() => '');
      if (current && current.trim()) continue;
      // skip recaptcha textarea
      const id = await ta.getAttribute('id').catch(() => '');
      if (id && id.includes('recaptcha')) continue;
      const label = await ta.evaluate(e => (e.labels?.[0]?.innerText || e.getAttribute('aria-label') || e.getAttribute('placeholder') || '').trim()).catch(() => '');
      const val = answerForLabel(label);
      if (val) await ta.fill(val).catch(() => {});
      await sleep(50);
    }
  } catch {}

  // radios: group by name
  try {
    const radios = await page.locator('input[type="radio"]').all();
    const groups = {};
    for (const r of radios) {
      const name = (await r.getAttribute('name').catch(() => '')) || '';
      if (!groups[name]) groups[name] = [];
      groups[name].push(r);
    }
    for (const name in groups) {
      const grp = groups[name];
      const labels = [];
      for (const r of grp) labels.push((await r.evaluate(e => (e.labels?.[0]?.innerText || '').trim()).catch(() => '')));
      // question text from fieldset legend or nearest preceding heading
      const qText = await grp[0].evaluate(el => {
        let node = el;
        while (node && node !== document.body) {
          if (node.tagName === 'FIELDSET') {
            return (node.innerText || '').trim();
          }
          node = node.parentElement;
        }
        return '';
      }).catch(() => '');
      // graduation status: pick "Graduation date set for/or before January 2027"
      if (labels.some(l => /graduation date/i.test(l))) {
        for (let i = 0; i < grp.length; i++) {
          if (/graduation date/i.test(labels[i])) await grp[i].check().catch(() => grp[i].click().catch(() => {}));
        }
        continue;
      }
      // enrolled at educational institution -> Yes
      if (/currently enrolled/i.test(qText)) {
        for (let i = 0; i < grp.length; i++) {
          if (/^yes$/i.test(labels[i].trim())) await grp[i].check().catch(() => grp[i].click().catch(() => {}));
        }
        continue;
      }
      // former employee -> No
      if (/former .* employee/i.test(qText)) {
        for (let i = 0; i < grp.length; i++) {
          if (/^no$/i.test(labels[i].trim())) await grp[i].check().catch(() => grp[i].click().catch(() => {}));
        }
        continue;
      }
      // military -> No (prefer not to say if available handled above)
      if (/military|armed forces/i.test(qText)) {
        for (let i = 0; i < grp.length; i++) {
          if (/^no$/i.test(labels[i].trim())) await grp[i].check().catch(() => grp[i].click().catch(() => {}));
        }
        continue;
      }
      // authorization to work -> No (user is India-based)
      if (/authoriz|legally authorized|work in the countries/i.test(qText)) {
        for (let i = 0; i < grp.length; i++) {
          if (/^no$/i.test(labels[i].trim())) await grp[i].check().catch(() => grp[i].click().catch(() => {}));
        }
        continue;
      }
      // EEO / disability / veteran / gender / ethnicity: prefer "Prefer not to say" if available
      if (labels.some(l => /prefer not to say/i.test(l))) {
        for (let i = 0; i < grp.length; i++) {
          if (/prefer not to say/i.test(labels[i])) await grp[i].check().catch(() => grp[i].click().catch(() => {}));
        }
        continue;
      }
      // yes/no: pick "No" for disability/veteran authorization unless "Yes" needed; default No
      if (labels.some(l => /^no$/i.test(l.trim())) && labels.some(l => /^yes$/i.test(l.trim()))) {
        // for "authorized to work" style, pick Yes; else No. We'll default Yes for authorization, No otherwise.
        const joined = labels.join(' ').toLowerCase();
        const pick = /authoriz|eligible|legally|work in/i.test(joined) ? 'No' : 'No';
        for (let i = 0; i < grp.length; i++) {
          if (labels[i].trim().toLowerCase() === pick.toLowerCase()) await grp[i].check().catch(() => grp[i].click().catch(() => {}));
        }
        continue;
      }
      // default: check first
      if (grp.length && !(await grp[0].isChecked().catch(() => false))) {
        await grp[0].check().catch(() => grp[0].click().catch(() => {}));
      }
    }
  } catch {}

  // button-based option groups (Ashby uses buttons for Yes/No and some multi-choice)
  try {
    const entries = await page.locator('div[class*="fieldEntry"], div[class*="field-entry"]').all();
    for (const entry of entries) {
      const qText = await entry.evaluate(e => (e.innerText || '').split('\n')[0].trim()).catch(() => '');
      const btns = await entry.locator('button').all();
      if (btns.length < 2) continue;
      const btnLabels = [];
      for (const b of btns) btnLabels.push((await b.innerText().catch(() => '')).trim());
      // decide which to click
      let target = null;
      if (btnLabels.some(l => /^yes$/i.test(l)) && btnLabels.some(l => /^no$/i.test(l))) {
        let pick = 'No';
        if (/currently enrolled/i.test(qText)) pick = 'Yes';
        if (/cybersecurity/i.test(qText)) pick = 'No';
        if (/authorized|legally/i.test(qText)) pick = 'No';
        if (/former .* employee/i.test(qText)) pick = 'No';
        target = btnLabels.findIndex(l => l.toLowerCase() === pick.toLowerCase());
      } else if (btnLabels.some(l => /prefer not to say/i.test(l))) {
        target = btnLabels.findIndex(l => /prefer not to say/i.test(l));
      }
      if (target !== null && target >= 0) {
        await btns[target].click().catch(() => {});
        await sleep(200);
      }
    }
  } catch {}

  // checkboxes: check "I agree"/"I understand"/consent; leave diversity checkboxes unchecked
  try {
    const cbs = await page.locator('input[type="checkbox"]').all();
    for (const cb of cbs) {
      const label = await cb.evaluate(e => {
        // try labels first, then previous sibling, then parent text
        if (e.labels && e.labels[0]) return e.labels[0].innerText.trim().toLowerCase();
        const prev = e.previousElementSibling;
        if (prev && prev.innerText) return prev.innerText.trim().toLowerCase();
        const parent = e.parentElement;
        if (parent) return (parent.innerText || '').trim().toLowerCase();
        return '';
      }).catch(() => '');
      if (/agree|understand|consent|acknowledge/i.test(label)) {
        if (!(await cb.isChecked().catch(() => false))) await cb.check().catch(() => cb.click().catch(() => {}));
      }
    }
  } catch {}
}

async function applyJob(page, jobUrl, log) {
  try {
    await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(8000);
  } catch (e) {
    log.failed.push(jobUrl); saveLog(log);
    return { status: 'nav-fail' };
  }
  // click Apply for this Job
  const hasApply = await page.evaluate(() => !!Array.from(document.querySelectorAll('button,a')).find(b => /apply for this job/i.test(b.innerText.trim())));
  if (!hasApply) {
    log.failed.push(jobUrl); saveLog(log);
    return { status: 'no-apply-btn' };
  }
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button,a')).find(x => /apply for this job/i.test(x.innerText.trim()));
    if (b) b.click();
  });
  await page.waitForTimeout(6000);

  await fillForm(page);
  await sleep(2000);

  // submit
  const hasSubmit = await page.evaluate(() => !!Array.from(document.querySelectorAll('button')).find(b => /submit application/i.test(b.innerText.trim())));
  if (!hasSubmit) {
    log.failed.push(jobUrl); saveLog(log);
    return { status: 'no-submit-btn' };
  }
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(x => /submit application/i.test(x.innerText.trim()));
    if (b) b.click();
  });
  // wait for CAPTCHA if present (user solves manually)
  for (let i=0;i<24;i++){
    const hasCaptcha = await page.evaluate(() => !!document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], [class*="captcha"]'));
    if (!hasCaptcha) break;
    console.log('CAPTCHA detected - waiting for you to solve it in the browser...');
    await sleep(5000);
  }
  await sleep(6000);
  const body = await page.evaluate(() => document.body.innerText);
  const success = /application submitted|thank you|submitted|success/i.test(body);
  const stillHasSubmit = await page.evaluate(() => !!Array.from(document.querySelectorAll('button')).find(b => /submit application/i.test(b.innerText.trim())));
  const verified = success || !stillHasSubmit;
  if (verified) {
    log.applied.push(jobUrl); saveLog(log);
    return { status: success ? 'submitted' : 'submitted-unknown' };
  } else {
    log.failed.push(jobUrl); saveLog(log);
    return { status: 'submit-unverified' };
  }
}

(async () => {
  if (!JOB_URL) { console.error('Provide JOB_URL env or arg'); process.exit(1); }
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find(p => p.url().includes('ashbyhq.com')) || await ctx.newPage();
  const log = loadLog();
  console.log('Applying:', JOB_URL);
  const res = await applyJob(page, JOB_URL, log);
  console.log('Result:', res.status);
  await browser.close();
})();
