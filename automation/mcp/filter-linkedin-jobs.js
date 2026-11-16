async (page) => {
  const url = page.url();
  if (!/(^|\.)linkedin\.com$/i.test(new URL(url).hostname)) {
    return { status: 'unsupported_site', reason: 'not_linkedin' };
  }

  const wanted = ['easy apply', 'remote'];
  const applied = [];
  const notFound = [];

  const clickLabel = async (label) => {
    const candidates = page.locator(
      'button, label, a[href], [role="checkbox"], [role="switch"], [role="button"], input[type="checkbox"]',
    );
    const count = await candidates.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index);
      const info = await candidate
        .evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return {
            text: (element.innerText || element.value || element.getAttribute('aria-label') || '').trim(),
            visible: rect.width > 0 && rect.height > 0,
            checked: element.checked === true || element.getAttribute('aria-checked') === 'true',
          };
        })
        .catch(() => null);
      if (!info || !info.visible) continue;
      if (info.text.toLowerCase() !== label) continue;
      if (info.checked) return 'already_active';
      await candidate
        .click({ timeout: 8000 })
        .catch(async () => {
          await candidate.evaluate((element) => element.click());
        });
      return 'clicked';
    }
    return null;
  };

  for (const label of wanted) {
    if (label === 'easy apply' && /[?&]f_AL=true/i.test(page.url())) {
      applied.push({ filter: label, state: 'already_active' });
      continue;
    }
    let state = await clickLabel(label);
    if (!state && label === 'remote') {
      await clickLabel('workplace type');
      await page.waitForTimeout(1200);
      state = await clickLabel(label);
    }
    if (state) applied.push({ filter: label, state });
    else notFound.push(label);
    await page.waitForTimeout(2500);
  }

  const results = await page.locator('a[href*="/jobs/view/"]').evaluateAll((links) => links.length);

  return {
    status: notFound.length > 0 ? 'partial' : 'ok',
    applied,
    notFound,
    resultLinks: results,
    url: page.url(),
  };
}
