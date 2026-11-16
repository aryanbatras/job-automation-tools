async (page) => {
  const currentUrl = new URL(page.url());
  if (!/(^|\.)linkedin\.com$/i.test(currentUrl.hostname)) {
    return { status: 'unsupported_page', jobs: [] };
  }

  const isBadge = (line) => (
    /^(promoted|easy apply|quick apply|viewed|applied|saved|new|featured|urgent)\b/i.test(line)
    || /\b(applicants?|posted)\b/i.test(line)
  );
  const isCompensation = (line) => (
    /[$€£₹]/.test(line)
    || /\b(inr|usd|eur|gbp|cad|aud|lpa|lakh|crore)\b/i.test(line)
    || (/\d/.test(line) && /(yr|year|month|hour|per\s|\/)/i.test(line))
  );

  const legacyCards = await page.locator('a[href*="/jobs/view/"]').evaluateAll((links) =>
    links.map((link) => {
      const card = link.closest(
        'li.jobs-search-results__list-item, .job-card-container, .job-card-list__entity-lockup, article',
      ) || link.parentElement;
      const rect = link.getBoundingClientRect();
      return {
        href: link.href,
        linkText: link.innerText || link.getAttribute('aria-label') || '',
        cardText: card?.innerText || '',
        visible: rect.width > 0 && rect.height > 0,
      };
    }),
  );

  const buttonCards = await page.locator('[role="button"]').evaluateAll((nodes) =>
    nodes
      .map((node) => {
        const dismiss = node.querySelector('button[aria-label^="Dismiss "]');
        if (!dismiss) return null;
        const componentKey = node.getAttribute('componentkey') || '';
        const rect = node.getBoundingClientRect();
        return {
          jobId: componentKey.match(/(\d{4,})/)?.[1] || '',
          dismissLabel: dismiss.getAttribute('aria-label') || '',
          cardText: node.innerText || '',
          visible: rect.width > 0 && rect.height > 0,
        };
      })
      .filter(Boolean),
  );

  const jobs = [];
  const seen = new Set();

  for (const card of legacyCards) {
    if (!card.visible) continue;
    let url;
    try {
      url = new URL(card.href);
    } catch {
      continue;
    }
    const id = url.pathname.match(/^\/jobs\/view\/(\d+)/)?.[1];
    if (!id || !/(^|\.)linkedin\.com$/i.test(url.hostname) || seen.has(id)) continue;

    seen.add(id);
    url.pathname = `/jobs/view/${id}/`;
    url.search = '';
    url.hash = '';
    const lines = card.cardText.split('\n').map((line) => line.trim()).filter(Boolean);
    const title = card.linkText.trim() || lines[0] || '';
    const cardLines = lines.filter((line) => line !== title && !/^(promoted|easy apply)$/i.test(line));
    jobs.push({
      title,
      company: cardLines[0] || '',
      location: cardLines[1] || '',
      url: url.href,
      selected: false,
    });
    if (jobs.length === 40) break;
  }

  for (const card of buttonCards) {
    if (!card.visible || !card.jobId || seen.has(card.jobId)) continue;
    seen.add(card.jobId);

    const title = card.dismissLabel.replace(/^Dismiss\s+/i, '').replace(/\s+job$/i, '').trim();
    const lines = card.cardText.split('\n').map((line) => line.trim()).filter(Boolean);
    const facts = lines.filter((line) => {
      const normalized = line.replace(/\s*\((?:verified job|promoted|new|easy apply)\)\s*$/i, '').trim();
      if (/^(selected|new|viewed|applied|saved)\b/i.test(normalized)) return false;
      if (title && normalized.toLowerCase() === title.toLowerCase()) return false;
      return !isBadge(line) && !isCompensation(line);
    });

    jobs.push({
      title,
      company: facts[0] || '',
      location: facts[1] || '',
      url: `https://www.linkedin.com/jobs/view/${card.jobId}/`,
      selected: /^selected\b/i.test(lines[0] || ''),
    });
    if (jobs.length === 40) break;
  }

  return { status: 'ok', count: jobs.length, jobs };
};
