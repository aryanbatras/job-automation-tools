const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CDP = process.env.CDP_ENDPOINT || 'http://127.0.0.1:9222';
const LOG_PATH = path.join(__dirname, 'applied.json');
const MAX_APPS = parseInt(process.env.MAX_APPS || '20', 10);
const SEARCH_URL = process.env.SEARCH_URL || 'https://wellfound.com/jobs?locations[]=India&remote=true';

function loadLog() { try { return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); } catch { return { applied: [], skipped: [], failed: [] }; } }
function saveLog(log) { fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2)); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function collectJobUrls(page) {
  await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(6000);
  let prev = 0;
  for (let i = 0; i < 30; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1200);
    const n = await page.evaluate(() => new Set(Array.from(document.querySelectorAll('a[href*="/jobs/"]')).map(a => a.href.match(/\/jobs\/\d+-[a-z0-9-]+/i)?.[0]).filter(Boolean)).size);
    if (n === prev) {
      await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find(x => /load more|show more/i.test(x.innerText)); if (b) b.click(); });
      await page.waitForTimeout(1200);
    }
    prev = n;
    if (n >= 80) break;
  }
  const urls = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href*="/jobs/"]'));
    const set = new Set();
    for (const a of links) {
      const m = a.href.match(/\/jobs\/\d+-[a-z0-9-]+/i);
      if (m) set.add('https://wellfound.com' + m[0]);
    }
    return Array.from(set);
  });
  return urls;
}

async function applyJob(page, jobUrl, log) {
  const id = jobUrl.match(/\/jobs\/(\d+)/)?.[1];
  if (log.applied.includes(id) || log.skipped.includes(id) || log.failed.includes(id)) {
    return { status: 'already-processed' };
  }
  try {
    await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(5000);
  } catch (e) {
    log.failed.push(id); saveLog(log);
    return { status: 'nav-fail' };
  }

  // click Apply button
  const hasApply = await page.evaluate(() => !!Array.from(document.querySelectorAll('button,a')).find(b => /^Apply$/i.test(b.innerText.trim())));
  if (!hasApply) {
    log.skipped.push(id); saveLog(log);
    return { status: 'no-apply-btn' };
  }
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button,a')).find(x => /^Apply$/i.test(x.innerText.trim()));
    if (b) b.click();
  });
  await page.waitForTimeout(4000);

  // fill textareas
  try {
    const tas = await page.locator('textarea').all();
    for (const ta of tas) {
      const current = await ta.inputValue().catch(() => '');
      if (current && current.trim()) continue;
      await ta.fill('I am excited about the opportunity to contribute to your team with my background in Java, Spring Boot, React, Next.js, and cloud technologies. I enjoy building scalable systems and would love to bring my experience to your company.').catch(() => {});
      await sleep(200);
    }
  } catch {}

  // text inputs
  try {
    const inputs = await page.locator('input[type="text"], input[type="tel"], input[type="email"], input[type="number"]').all();
    for (const inp of inputs) {
      const current = await inp.inputValue().catch(() => '');
      if (current && current.trim()) continue;
      const label = await inp.evaluate(e => (e.labels?.[0]?.innerText || e.getAttribute('aria-label') || '').toLowerCase()).catch(() => '');
      let val = null;
      if (label.includes('first')) val = 'Aryan';
      else if (label.includes('last')) val = 'Batra';
      else if (label.includes('email')) val = 'batraaryan03@gmail.com';
      else if (label.includes('phone') || label.includes('mobile')) val = '9149469833';
      if (val) await inp.fill(val).catch(() => {});
    }
  } catch {}

  // submit
  const hasSend = await page.evaluate(() => !!Array.from(document.querySelectorAll('button')).find(b => /send application/i.test(b.innerText.trim())));
  if (!hasSend) {
    log.failed.push(id); saveLog(log);
    return { status: 'no-send-btn' };
  }
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find(x => /send application/i.test(x.innerText.trim()));
    if (b) b.click();
  });
  await sleep(6000);
  const hasApply = await page.evaluate(() => !!Array.from(document.querySelectorAll('button,a')).find(b => /^Apply$/i.test(b.innerText.trim())));
  const hasTextarea = await page.locator('textarea').count().catch(()=>0);
  const body = await page.evaluate(() => document.body.innerText);
  const successText = /application sent|applied|thank you|submitted/i.test(body);
  const verified = (!hasApply) && (hasTextarea === 0) && successText;
  if (verified) {
    log.applied.push(id); saveLog(log);
    return { status: 'submitted' };
  } else {
    // try close modal
    await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find(x => /^cancel$/i.test(x.innerText.trim()) || /close/i.test(x.innerText.trim())); if (b) b.click(); }).catch(()=>{});
    log.failed.push(id); saveLog(log);
    return { status: 'submit-unverified' };
  }
}

(async () => {
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find(p => p.url().includes('wellfound.com'));
  if (!page) page = await ctx.newPage();

  const log = loadLog();
  let totalApplied = log.applied.length;
  console.log('Starting. Already applied:', totalApplied, 'MAX_APPS:', MAX_APPS);

  const jobUrls = await collectJobUrls(page);
  console.log('found', jobUrls.length, 'jobs');

  for (const ju of jobUrls) {
    if (totalApplied >= MAX_APPS) break;
    const id = ju.match(/\/jobs\/(\d+)/)?.[1];
    if (log.applied.includes(id) || log.skipped.includes(id) || log.failed.includes(id)) continue;
    console.log('-> applying', id);
    const res = await applyJob(page, ju, log);
    console.log('   result:', res.status);
    if (res.status === 'submitted' || res.status === 'submitted-unknown') totalApplied++;
    await sleep(2000);
  }

  console.log('\nDONE. Total applied:', totalApplied);
  await browser.close();
})();
