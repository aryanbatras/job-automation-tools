const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CDP = process.env.CDP_ENDPOINT || 'http://127.0.0.1:9222';
const channelName = process.argv[2] || 'NexusHub valut';

(async () => {
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find(p => p.url().includes('web.whatsapp.com'));
  if (!page) page = await ctx.newPage();
  await page.goto('https://web.whatsapp.com/', {waitUntil:'domcontentloaded', timeout:30000});
  await page.waitForTimeout(4000);
  // click Channels
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button, span, div[role="button"]')).find(x => (x.getAttribute('aria-label')||x.innerText||'').trim() === 'Channels');
    if (b) b.click();
  });
  await page.waitForTimeout(3000);
  // click the channel
  await page.evaluate((name) => {
    const els = Array.from(document.querySelectorAll('span'));
    const el = els.find(e => e.innerText?.trim() === name);
    if (el) el.click();
  }, channelName);
  await page.waitForTimeout(5000);

  // scroll up to load older messages
  for (let i=0;i<15;i++){
    await page.evaluate(() => {
      const scrollers = Array.from(document.querySelectorAll('div')).filter(d => d.scrollHeight > d.clientHeight + 100);
      // find the messages scroller (tallest)
      let target = scrollers.sort((a,b)=>b.scrollHeight-a.scrollHeight)[0];
      if (target) target.scrollBy(0, -3000);
    });
    await page.waitForTimeout(1200);
  }
  await page.waitForTimeout(2000);

  const msgs = await page.evaluate(() => {
    // WhatsApp messages: text in spans with class containing selectable-text, or message-in containers
    const els = Array.from(document.querySelectorAll('span.selectable-text, div[class*="message-in"] span, div.copyable-text'));
    const texts = els.map(e => e.innerText?.trim()).filter(Boolean);
    // dedupe consecutive
    const out = [];
    for (const t of texts) { if (out.length === 0 || out[out.length-1] !== t) out.push(t); }
    return out;
  });
  const outPath = path.join(__dirname, `${channelName.replace(/\s+/g,'_')}.txt`);
  fs.writeFileSync(outPath, msgs.join('\n\n---MSG---\n\n'));
  // extract links
  const links = [...new Set(msgs.join(' ').match(/https?:\/\/[^\s]+/g) || [])];
  fs.writeFileSync(path.join(__dirname, `${channelName.replace(/\s+/g,'_')}_links.txt`), links.join('\n'));
  console.log('channel:', channelName);
  console.log('msgs:', msgs.length);
  console.log('links:', links.length);
  for (const l of links) console.log('  ', l);
  await browser.close();
})();
