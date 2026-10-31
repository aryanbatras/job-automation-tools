const { chromium } = require('playwright');
const fs = require('fs');

const CDP = process.env.CDP_ENDPOINT || 'http://127.0.0.1:9222';
const path = require('path');
const RESUME_PATH = path.join(__dirname, '..', 'AryanBatraResume.pdf');
const LOG_PATH = path.join(__dirname, 'applied.json');
const MAX_APPS = parseInt(process.env.MAX_APPS || '20', 10);

const KEYWORDS = (process.env.KEYWORDS || 'remote java,remote java developer,remote java intern,remote software engineer intern,remote react developer,remote full stack developer,remote spring boot intern,remote backend developer').split(',');


const SKILL_YEARS = {
  java:3, javascript:3, typescript:2, python:2, "c/c++":2, sql:3, bash:2, kotlin:1, dart:1, lua:1, "html/css":3,
  "spring boot":2, "node.js":2, "rest apis":3, "rest":3, microservices:2, hibernate:2, flyway:1, jte:1, thymeleaf:1,
  aws:2, localstack:1, docker:2, nginx:2, "firebase auth":1, supabase:1,
  postgresql:2, turso:1, mysql:2, redis:1, prometheus:1, grafana:1, loki:1, axiom:1,
  "next.js":2, react:2, "tailwind css":2, tailwind:2, "three.js":1, solidjs:1, gsap:1, "react flow":1, "react quill":1, storybook:1, chromatic:1, flutter:1,
  rag:1, llms:1, openrouter:1, groq:1, "mistral ai":1, "meta graph api":1, n8n:1, activepieces:1, zapier:1,
  "jfrog artifactory":1, jenkins:1, "github actions":2, vitest:1, junit5:2, jacoco:2, "openapi swagger":2, ink:1, pastel:1, "at protocol":1,
  "system design":2, "data structures":3, "operating systems":3, "computer networks":3,
  "representational state transfer (rest)":3, "representational state transfer":3
};
function yearsForSkill(skill) {
  const s = (skill||'').toLowerCase().trim();
  if (SKILL_YEARS[s] !== undefined) return SKILL_YEARS[s];
  // partial match
  for (const k in SKILL_YEARS) {
    if (s.includes(k) || k.includes(s)) return SKILL_YEARS[k];
  }
  return 0;
}

function loadLog() {
  try { return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); } catch { return { applied: [], skipped: [], failed: [] }; }
}
function saveLog(log) { fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2)); }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function collectJobUrls(page) {
  await page.waitForTimeout(2500);
  // scroll to load more
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollBy(0, 1200));
    await page.waitForTimeout(800);
  }
  const urls = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('li.jobs-search-results__list-item, .job-card-container, .jobs-search-results-list li'));
    const set = new Set();
    for (const c of cards) {
      const a = c.querySelector('a[href*="/jobs/view/"]');
      if (a) {
        const m = a.href.match(/\/jobs\/view\/\d+/);
        if (m) set.add('https://www.linkedin.com' + m[0] + '/');
      }
    }
    return Array.from(set);
  });
  return urls;
}

async function fillStep(page) {
  // uncheck alert + follow; check declaration/agree/confirm checkboxes
  try {
    const cbs = await page.locator('input[type="checkbox"]').all();
    for (const cb of cbs) {
      const lbl = await cb.evaluate(e => (e.labels?.[0]?.innerText || e.getAttribute('aria-label') || '').toLowerCase());
      if (lbl.includes('alert') || lbl.includes('follow')) {
        if (await cb.isChecked().catch(()=>false)) await cb.uncheck().catch(()=>{});
      } else if (lbl.includes('declaration') || lbl.includes('confirm') || lbl.includes('agree') || lbl.includes('understand')) {
        if (!(await cb.isChecked().catch(()=>false))) await cb.check().catch(() => cb.click({force:true}).catch(()=>{}));
      }
    }
  } catch {}

  // file inputs
  try {
    const fc = await page.locator('input[type="file"]').count();
    for (let i = 0; i < fc; i++) {
      await page.locator('input[type="file"]').nth(i).setInputFiles(RESUME_PATH).catch(()=>{});
      await sleep(800);
    }
  } catch {}

  // resume radios
  try {
    const radios = await page.locator('input[type="radio"]').all();
    for (const r of radios) {
      const lbl = await r.evaluate(e => (e.labels?.[0]?.innerText || '').trim());
      if (/AryanBatraResume\.pdf/i.test(lbl)) {
        await r.check().catch(() => r.click().catch(()=>{}));
      }
    }
  } catch {}

  // text inputs
  try {
    const textInputs = await page.locator('input[type="text"], input[type="tel"], input[type="number"], input[type="email"], textarea').all();
    for (const inp of textInputs) {
      let current = '';
      try { current = await inp.inputValue(); } catch {}
      if (current && current.trim()) continue;
      const label = await inp.evaluate(e => (e.labels?.[0]?.innerText || e.getAttribute('aria-label') || '').trim()).catch(()=>'');
      const l = label.toLowerCase();
      let val = null;
      if (l.includes('first name')) val = 'Aryan';
      else if (l.includes('last name')) val = 'Batra';
      else if (l.includes('phone') || l.includes('mobile')) val = '9149469833';
      else if (l.includes('city') || l.includes('location')) val = 'Jammu';
      else if (l.includes('year') || l.includes('experience')) {
        // extract skill name after 'with'
        let skill = l;
        const m = l.match(/with\s+(.+?)(\?|$)/);
        if (m) skill = m[1];
        // strip trailing question marks / punctuation
        skill = skill.replace(/[?.,!]/g,'').trim();
        val = String(yearsForSkill(skill));
      }
      else if (l.includes('salary') || l.includes('compensation') || l.includes('ctc')) val = 'Negotiable';
      else if (l.includes('linkedin')) val = 'https://www.linkedin.com/in/aryanbatra';
      else if (l.includes('website') || l.includes('portfolio')) val = 'https://aryanbatra.is-a.dev';
      else if (l.includes('github')) val = 'https://github.com/aryanbatras';
      else if (l.includes('github profile') || l.includes('portfolio link')) val = 'https://github.com/aryanbatras';
      else if (l.includes('batch')) val = '2027';
      else if (l.includes('notice period')) val = '0';
      else if (l.includes('start immediately') || l.includes('can you start')) val = 'Yes';
      else if (l.includes('hours') && l.includes('available')) val = '40';
      else if (l.includes('hours') && l.includes('week')) val = '40';
      else if (l.includes('nationality')) val = 'Indian';
      else if (l.includes('current location')) val = 'Jammu, India';
      else if (l.includes('current salary')) val = '0';
      else if (l.includes('expected salary') || l.includes('expected stipend') || l.includes('expected monthly')) val = 'Negotiable';
      else if (l.includes('tell us about a project') || l.includes('project you built')) val = 'Built an e-commerce platform (12 microservices) with Spring Boot, AWS SQS/SNS, and a mutual fund platform (14k+ funds) with Next.js. Learned scalable architecture, RBAC, and async queues.';
      else if (l.includes('cover') || l.includes('message') || l.includes('about') || l.includes('summary')) val = 'Java Full Stack Engineer (Spring Boot, React, Next.js, AWS) seeking remote opportunities.';
      if (val !== null) {
        await inp.fill(val).catch(()=>{});
        await sleep(50);
      }
    }
  } catch {}

  // selects
  try {
    const selects = await page.locator('select').all();
    for (const sel of selects) {
      const label = await sel.evaluate(e => (e.labels?.[0]?.innerText || e.getAttribute('aria-label') || '').trim()).catch(()=>'');
      const l = label.toLowerCase();
      let desired = null;
      if (l.includes('sponsor')) desired = 'No';
      else if (l.includes('authoriz') || l.includes('eligible') || l.includes('legally') || l.includes('work in')) desired = 'Yes';
      else if (l.includes('relocat')) desired = 'Yes';
      else if (l.includes('proficiency') || l.includes('english') || l.includes('german') || l.includes('japanese')) desired = null;
      else if (l.includes('master') || l.includes("master's")) desired = 'No';
      else if (l.includes('financial instruments') || l.includes('pl/sql') || l.includes('oracle')) desired = 'No';
      else if (l.includes('batch') || l.includes('graduating')) {
        // pick the option containing 2027
        try {
          const opts = await sel.locator('option').all();
          let target = null;
          for (const o of opts) {
            const t = (await o.innerText().catch(()=>''));
            if (/2027/.test(t)) { target = await o.getAttribute('value'); break; }
          }
          if (target === null) {
            // fallback: last non-empty option
            for (const o of opts) { const v = await o.getAttribute('value').catch(()=>null); if (v) target = v; }
          }
          if (target !== null) await sel.selectOption(target).catch(()=>{});
        } catch {}
        continue;
      }
      else if (l.includes('year') || l.includes('experience') || l.includes('months')) {
        let skill = l;
        const m = l.match(/with\s+(.+?)(\?|$)/);
        if (m) skill = m[1];
        skill = skill.replace(/[?.,!]/g,'').trim();
        desired = String(yearsForSkill(skill));
      }
      if (l.includes('proficiency') || l.includes('english') || l.includes('german') || l.includes('japanese')) {
        // pick highest proficiency option
        try {
          const opts = await sel.locator('option').all();
          let last = null;
          for (const o of opts) { const t = (await o.innerText().catch(()=>'')).trim(); if (t && !/select|choose/i.test(t)) last = await o.getAttribute('value'); }
          if (last !== null) await sel.selectOption(last).catch(()=>{});
        } catch {}
        continue;
      }
      if (desired) {
        try { await sel.selectOption({ label: new RegExp(desired, 'i') }); }
        catch {
          const opts = await sel.locator('option').all();
          for (const o of opts) {
            const t = (await o.innerText().catch(()=>''));
            if (new RegExp(desired, 'i').test(t)) {
              const v = await o.getAttribute('value').catch(()=>null);
              if (v !== null) await sel.selectOption(v).catch(()=>{});
              break;
            }
          }
        }
      }
    }
  } catch {}

  // yes/no radio groups
  try {
    const radios = await page.locator('input[type="radio"]').all();
    const groups = {};
    for (const r of radios) {
      const name = (await r.getAttribute('name').catch(()=>'')) || '';
      if (!groups[name]) groups[name] = [];
      groups[name].push(r);
    }
    for (const name in groups) {
      const grp = groups[name];
      const labels = [];
      for (const r of grp) labels.push((await r.evaluate(e => {
        // LinkedIn puts Yes/No in a sibling/parent div, not in a <label>
        let node = e.parentElement;
        for (let i=0;i<6 && node;i++){
          const t = (node.innerText||'').trim();
          if (/^(Yes|No)$/i.test(t)) return t;
          node = node.parentElement;
        }
        return (e.labels?.[0]?.innerText || e.getAttribute('aria-label') || '').trim();
      }).catch(()=>'')));
      if (labels.some(l => /\.pdf/i.test(l))) continue; // resume group
      const hasYes = labels.some(l => /^yes$/i.test(l.trim()));
      const hasNo = labels.some(l => /^no$/i.test(l.trim()));
      if (!hasYes || !hasNo) continue;
      const qText = await grp[0].evaluate(el => el.getAttribute('aria-label') || '').catch(()=>'');
      const ql = (qText || '').toLowerCase();
      let pick = 'No';
      if (ql.includes('start immediately') || ql.includes('can you start')) pick = 'Yes';
      else if (ql.includes('available') && ql.includes('internship')) pick = 'Yes';
      else if (ql.includes('sponsor')) pick = 'No';
      else if (ql.includes('authoriz') || ql.includes('eligible') || ql.includes('legally')) pick = 'Yes';
      else if (ql.includes('relocat')) pick = 'Yes';
      else if (ql.includes('stable internet') || ql.includes('headset') || ql.includes('android') || ql.includes('iphone')) pick = 'Yes';
      for (let i = 0; i < grp.length; i++) {
        if (labels[i].trim().toLowerCase() === pick.toLowerCase()) {
          // click the parent div (LinkedIn's clickable area) and the radio
          await grp[i].evaluate(e => {
            let node = e.parentElement;
            for (let j=0;j<5 && node;j++){
              if (node.getAttribute && node.getAttribute('role') === 'radio') { node.click(); break; }
              node = node.parentElement;
            }
            e.click();
          }).catch(()=>{});
          await grp[i].click({force: true}).catch(()=>{});
        }
      }
    }
  } catch {}
}

async function applyJob(page, jobUrl, log) {
  const id = jobUrl.match(/\/jobs\/view\/(\d+)/)?.[1];
  if (log.applied.includes(id) || log.skipped.includes(id) || log.failed.includes(id)) {
    return { status: 'already-processed' };
  }
  try {
    await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await sleep(2000);
  } catch (e) {
    log.failed.push(id); saveLog(log);
    return { status: 'nav-fail' };
  }

  // find Easy Apply button
  const hasEA = await page.evaluate(() => !!Array.from(document.querySelectorAll('button')).find(b => /^Easy Apply$/i.test(b.innerText.trim())));
  if (!hasEA) {
    log.skipped.push(id); saveLog(log);
    return { status: 'no-easy-apply' };
  }

  // click Easy Apply
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(x => /^Easy Apply$/i.test(x.innerText.trim()));
    if (b) b.click();
  });
  await sleep(1500);

  let submitted = false;
  for (let step = 0; step < 8; step++) {
    // wait for page to settle after navigation
    await sleep(1000);
    try { await fillStep(page); } catch (e) { /* context may be destroyed */ }
    await sleep(500);
    try {
      const qs = await page.evaluate(() => Array.from(document.querySelectorAll('input:not([type=hidden]), select, textarea')).map(e => (e.labels?.[0]?.innerText || e.getAttribute('aria-label') || '').trim()).filter(Boolean));
      const fs = require('fs');
      fs.appendFileSync(require('path').join(__dirname, 'questions.log'), JSON.stringify({job:id, step:step+1, qs}) + '\n');
    } catch {}

    const btns = await page.evaluate(() => Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim()));
    const hasSubmit = btns.some(t => /submit application/i.test(t));
    const hasReview = btns.some(t => /^review$/i.test(t));
    const hasNext = btns.some(t => /^next$/i.test(t));

    if (hasSubmit) {
      await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('button')).find(x => /submit application/i.test(x.innerText.trim()));
        if (b) b.click();
      });
      await sleep(6000);
      const body = await page.evaluate(() => document.body.innerText);
      const hasNext = await page.evaluate(() => Array.from(document.querySelectorAll('button')).some(b => /^Next$/i.test(b.innerText.trim())));
      const hasSubmit2 = await page.evaluate(() => Array.from(document.querySelectorAll('button')).some(b => /submit application/i.test(b.innerText.trim())));
      const hasEasyApply = await page.evaluate(() => Array.from(document.querySelectorAll('button')).some(b => /^Easy Apply$/i.test(b.innerText.trim())));
      const success = /application submitted|submitted successfully|your application was sent|applied now|applied successfully/i.test(body);
      const verified = success || (!hasNext && !hasSubmit2 && !hasEasyApply);
      if (verified) {
        log.applied.push(id); saveLog(log);
        return { status: success ? 'submitted' : 'submitted-unknown' };
      } else {
        log.failed.push(id); saveLog(log);
        return { status: 'submit-unverified' };
      }
    }
    if (hasReview) {
      await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('button')).find(x => /^review$/i.test(x.innerText.trim()));
        if (b) b.click();
      });
      await sleep(2000);
      continue;
    }
    if (hasNext) {
      // record progress before
      const before = await page.evaluate(() => document.body.innerText.match(/\d+\/\d+ pages/)?.[0]);
      await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('button')).find(x => /^next$/i.test(x.innerText.trim()));
        if (b) b.click();
      });
      await sleep(2000);
      const after = await page.evaluate(() => document.body.innerText.match(/\d+\/\d+ pages/)?.[0]);
      if (before === after) {
        // retry: re-fill and try once more
        await fillStep(page);
        await sleep(1000);
        await page.evaluate(() => {
          const b = Array.from(document.querySelectorAll('button')).find(x => /^next$/i.test(x.innerText.trim()));
          if (b) b.click();
        });
        await sleep(2000);
        const after2 = await page.evaluate(() => document.body.innerText.match(/\d+\/\d+ pages/)?.[0]);
        if (before === after2) {
          log.failed.push(id); saveLog(log);
          return { status: 'stuck-on-step' };
        }
      }
      continue;
    }
    // no nav
    log.failed.push(id); saveLog(log);
    return { status: 'no-nav-btn' };
  }
  if (!submitted) {
    log.failed.push(id); saveLog(log);
    return { status: 'max-steps' };
  }
  return { status: 'done' };
}

(async () => {
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  // reuse or create a page
  let page = ctx.pages().find(p => p.url().includes('linkedin.com'));
  if (!page) page = await ctx.newPage();

  const log = loadLog();
  let totalApplied = log.applied.length;
  console.log('Starting. Already applied:', totalApplied, 'MAX_APPS:', MAX_APPS);

  // If JOB_URL provided, process only that job
  if (process.env.JOB_URL) {
    const ju = process.env.JOB_URL;
    const id = ju.match(/\/jobs\/view\/(\d+)/)?.[1];
    if (id) {
      console.log('-> applying', id);
      const res = await applyJob(page, ju, log);
      console.log('   result:', res.status);
      if (res.status === 'submitted' || res.status === 'submitted-unknown') totalApplied++;
    }
    console.log('\nDONE. Total applied:', totalApplied);
    await browser.close();
    process.exit(0);
  }
  outer: for (const kw of KEYWORDS) {
    if (totalApplied >= MAX_APPS) break;
    const loc = process.env.LOCATION || 'India';
    const url = 'https://www.linkedin.com/jobs/search/?keywords=' + encodeURIComponent(kw.trim()) + '&location=' + encodeURIComponent(loc) + '&f_WT=2&f_AL=true';
    console.log('\n=== KEYWORD:', kw.trim(), '===');
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) { console.log('search nav fail', e.message); continue; }
    await sleep(2000);

    const jobUrls = await collectJobUrls(page);
    console.log('found', jobUrls.length, 'jobs');

    for (const ju of jobUrls) {
      if (totalApplied >= MAX_APPS) break outer;
      const id = ju.match(/\/jobs\/view\/(\d+)/)?.[1];
      if (log.applied.includes(id) || log.skipped.includes(id) || log.failed.includes(id)) {
        continue;
      }
      console.log('-> applying', id, ju.slice(0,60));
      const res = await applyJob(page, ju, log);
      console.log('   result:', res.status);
      if (res.status === 'submitted' || res.status === 'submitted-unknown') totalApplied++;
      await sleep(1500);
    }
  }

  console.log('\nDONE. Total applied:', totalApplied);
  console.log('Log:', LOG_PATH);
  await browser.close();
})();
