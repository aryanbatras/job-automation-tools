async (page) => {
  const currentUrl = new URL(page.url());
  if (!/(^|\.)linkedin\.com$/i.test(currentUrl.hostname)) {
    return { status: 'unsupported_page', jobs: [] };
  }

  const isBadge = (line) =>
    /^(promoted|easy apply|quick apply|viewed|applied|saved|new|featured|urgent)\b/i.test(line) ||
    /\b(applicants?|posted)\b/i.test(line);
  const isCompensation = (line) =>
    /[$€£₹]/.test(line) ||
    /\b(inr|usd|eur|gbp|cad|aud|lpa|lakh|crore)\b/i.test(line) ||
    (/\d/.test(line) && /(yr|year|month|hour|per\s|\/)/i.test(line));
  const isMeta = (line) =>
    isBadge(line) ||
    isCompensation(line) ||
    /^\s*[·•]\s*/.test(line) ||
    /\b\d+\s*(second|minute|hour|day|week|month)s?\s+ago\b/i.test(line) ||
    /\bpromoted by\b/i.test(line) ||
    /\bresponse insights\b/i.test(line) ||
    /^(hiring|actively hiring|applicants?)\b/i.test(line) ||
    /^\d+\s+notifications?$/i.test(line) ||
    /^(skip to main content|clear selection|home|jobs|messaging|me|for business|advertise)$/i.test(line);
  const looksLikeLocation = (line) =>
    /\b(remote|hybrid|on-?site|onsite|anywhere)\b/i.test(line) ||
    /\b(india|usa|uk|canada|australia|germany|netherlands|ireland|singapore|uae|dubai)\b/i.test(line) ||
    /,/.test(line);

  const linkCards = await page.locator('a[href*="/jobs/view/"]').evaluateAll((links) => {
    const jobLinkSelector = 'a[href*="/jobs/view/"]';
    const roots = [];
    for (const link of links) {
      let node = link;
      while (node.parentElement && node.parentElement.querySelectorAll(jobLinkSelector).length <= 1) {
        node = node.parentElement;
      }
      if (!roots.includes(node)) roots.push(node);
    }
    return roots.map((root) => {
      const link = root.querySelector(jobLinkSelector);
      const rect = root.getBoundingClientRect();
      const text = root.innerText || '';
      return {
        href: link ? link.getAttribute('href') || '' : '',
        linkText: link ? (link.innerText || '').trim() : '',
        cardText: text,
        visible: rect.width > 0 && rect.height > 0,
        plausible: rect.height <= 400 && text.split('\n').filter(Boolean).length <= 10,
        selected: Boolean(root.querySelector('[aria-current="true"], [aria-selected="true"]')) || /^\s*selected\b/i.test(text),
      };
    });
  });

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

  for (const card of linkCards) {
    if (!card.visible || !card.href || !card.plausible) continue;
    let url;
    try {
      url = new URL(card.href, currentUrl.origin);
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
    const title = card.linkText.trim() || lines.find((line) => !isMeta(line)) || '';
    const facts = lines.filter((line) => {
      if (!title || line.toLowerCase() !== title.toLowerCase()) {
        if (isMeta(line)) return false;
      }
      return true;
    });

    const location = facts.find((line) => looksLikeLocation(line)) || '';
    const company = facts.find((line) => line !== location && line.toLowerCase() !== title.toLowerCase()) || '';

    jobs.push({
      title,
      company,
      location,
      url: url.href,
      selected: card.selected,
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
      return !isMeta(line);
    });

    const location = facts.find((line) => looksLikeLocation(line)) || '';
    const company = facts.find((line) => line !== location && line.toLowerCase() !== title.toLowerCase()) || '';

    jobs.push({
      title,
      company,
      location,
      url: `https://www.linkedin.com/jobs/view/${card.jobId}/`,
      selected: /^selected\b/i.test(lines[0] || ''),
    });
    if (jobs.length === 40) break;
  }

  return { status: 'ok', count: jobs.length, jobs };
}
