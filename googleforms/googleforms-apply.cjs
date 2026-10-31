const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CDP = process.env.CDP_ENDPOINT || 'http://127.0.0.1:9222';
const FORM_URL = process.env.FORM_URL || process.argv[2];

(async () => {
  if (!FORM_URL) { console.error('Provide FORM_URL env or arg'); process.exit(1); }
  const browser = await chromium.connectOverCDP(CDP);
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find(p => p.url().includes('docs.google.com/forms')) || await ctx.newPage();
  await page.goto(FORM_URL, {waitUntil:'domcontentloaded', timeout:30000});
  await page.waitForTimeout(6000);

  // Fill text inputs in order
  const textValues = [
    'Aryan Batra',                                    // full name
    'batraaryan03@gmail.com',                         // email
    '+91 9149469833',                                // whatsapp number
    'Jammu, India',                                  // where based
    'https://www.linkedin.com/in/aryanbatra',         // LinkedIn/Instagram profile link
  ];
  const textInputs = await page.locator('input[type="text"]').all();
  for (let i = 0; i < textInputs.length && i < textValues.length; i++) {
    await textInputs[i].fill(textValues[i]).catch(() => {});
    await page.waitForTimeout(200);
  }

  // Click radios by aria-label
  const radioPicks = [
    'Currently in college',   // education status
    'LinkedIn Content & Growth', // role
    '15 to 20 hours',         // hours per week
    'Immediately',            // when can you start
  ];
  for (const pick of radioPicks) {
    await page.evaluate((p) => {
      const el = Array.from(document.querySelectorAll('div[role="radio"]')).find(e => e.getAttribute('aria-label') === p);
      if (el) el.click();
    }, pick);
    await page.waitForTimeout(300);
  }

  // Fill textareas in order
  const textareaValues = [
    'I want to join because I am passionate about building products and growing communities. I have experience building full-stack apps and would love to contribute to your startup.',
    'Built an e-commerce platform (12 microservices), a mutual fund platform (14k+ funds), and a decentralized social client. GitHub: github.com/aryanbatras',
    'I would start by identifying the target audience, creating high-value content consistently, engaging with relevant communities, and leveraging cross-platform promotion.',
  ];
  const tas = await page.locator('textarea').all();
  for (let i = 0; i < tas.length && i < textareaValues.length; i++) {
    await tas[i].fill(textareaValues[i]).catch(() => {});
    await page.waitForTimeout(200);
  }

  await page.waitForTimeout(1000);
  // submit
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button, div[role="button"]')).find(x => /submit/i.test(x.innerText?.trim()));
    if (b) b.click();
  });
  await page.waitForTimeout(5000);
  const body = await page.evaluate(() => document.body.innerText);
  const success = /response.*recorded|thank you|submitted/i.test(body);
  console.log('Result:', success ? 'submitted' : 'unknown');
  console.log('Page:', body.slice(0,200).replace(/\s+/g,' '));
  await browser.close();
})();
