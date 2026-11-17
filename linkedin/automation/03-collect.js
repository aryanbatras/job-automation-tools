// 03-collect.js
// Reads the job cards from the results list. LinkedIn ships several card
// shapes, so the card root is resolved generically and the facts are parsed
// out of the card text.

const collectJobs = async (page) => {
  const linkCards = await page.locator('a[href*="/jobs/view/"]').evaluateAll((links) => {
    const jobLinkSelector = 'a[href*="/jobs/view/"]';
    const hrefOf = (link) =>
      typeof link.getAttribute === 'function' ? link.getAttribute('href') || '' : link.href || '';
    const innerTextOf = (link) => (link.innerText || link.textContent || '').trim();

    const cardOf = (link) => {
      if (typeof link.closest === 'function') {
        const found = link.closest(
          'li.jobs-search-results__list-item, .job-card-container, .job-card-list__entity-lockup, article',
        );
        if (found && typeof found.innerText === 'string' && found.innerText.length) return found;
      }
      let node = link;
      if (link.parentElement && typeof link.parentElement.querySelectorAll === 'function') {
        let guard = 0;
        while (node.parentElement && guard < 15) {
          if (node.parentElement.querySelectorAll(jobLinkSelector).length > 1) break;
          node = node.parentElement;
          guard += 1;
        }
      }
      return node;
    };

    return links.map((link) => {
      const card = cardOf(link);
      const rect =
        typeof link.getBoundingClientRect === 'function'
          ? link.getBoundingClientRect()
          : { width: 100, height: 100 };
      const cardRect =
        typeof card.getBoundingClientRect === 'function'
          ? card.getBoundingClientRect()
          : { width: 100, height: 100 };
      const text = (card.innerText || '').trim();
      return {
        href: hrefOf(link),
        linkText: innerTextOf(link),
        cardText: text,
        visible: rect.width > 0 && rect.height > 0,
        plausible: cardRect.height <= 400 && text.split('\n').filter(Boolean).length <= 10,
        selected: /^\s*selected\b/i.test(text),
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
    /^\d+\s+notifications?$/i.test(line);
  const looksLikeLocation = (line) =>
    /\b(remote|hybrid|on-?site|onsite|anywhere)\b/i.test(line) ||
    /\b(india|usa|uk|canada|australia|germany|netherlands|ireland|singapore|uae|dubai)\b/i.test(line) ||
    /,/.test(line);

  // The "Applied" badge is a line of the card. A one-line card is still
  // possible, so the end of the text counts too. "Applied Scientist" is a
  // title, not a badge: only a whole line or the very end match.
  const hasAppliedBadge = (text) => {
    const value = String(text || '');
    if (value.split('\n').some((line) => /^\s*applied\s*$/i.test(line))) return true;
    return /\bapplied\s*$/i.test(value.trim());
  };

  const jobs = [];
  const seen = new Set();

  const describe = (title, facts) => {
    // A company name can contain a comma ("Textellent, Inc."), so a real
    // workplace marker or country wins over the comma heuristic.
    const strong = facts.find((line) =>
      /\b(remote|hybrid|on-?site|onsite|anywhere|india|usa|uk|canada|australia|germany|netherlands|ireland|singapore|uae|dubai)\b/i.test(
        line,
      ),
    );
    const location = strong || facts.find((line) => looksLikeLocation(line)) || facts[1] || '';
    const company = facts.find((line) => line !== location) || '';
    return { title, company, location };
  };

  for (const card of linkCards) {
    if (!card.visible || !card.href || !card.plausible) continue;
    let url;
    try {
      url = new URL(card.href, 'https://www.linkedin.com');
    } catch {
      continue;
    }
    const id = url.pathname.match(/^\/jobs\/view\/(\d+)/)?.[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    url.pathname = `/jobs/view/${id}/`;
    url.search = '';
    url.hash = '';

    const lines = card.cardText.split('\n').map((line) => line.trim()).filter(Boolean);
    const title = card.linkText.trim() || lines.find((line) => !isMeta(line)) || '';
    const facts = lines.filter((line) => {
      if (title && line.toLowerCase() === title.toLowerCase()) return false;
      return !isMeta(line);
    });

    jobs.push({
      ...describe(title, facts),
      id,
      url: url.href,
      selected: card.selected,
      applied: hasAppliedBadge(card.cardText),
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

    jobs.push({
      ...describe(title, facts),
      id: card.jobId,
      url: `https://www.linkedin.com/jobs/view/${card.jobId}/`,
      selected: /^selected\b/i.test(lines[0] || ''),
      applied: hasAppliedBadge(card.cardText),
    });
    if (jobs.length === 40) break;
  }

  return jobs;
};

// "Show results" reloads the list and the cards mount a moment later, so an
// empty read is not proof of an empty result set.
const collectJobsWhenReady = async (page, ticks = 8) => {
  let jobs = await collectJobs(page);
  for (let tick = 0; tick < ticks && jobs.length === 0; tick += 1) {
    await page.waitForTimeout(500);
    jobs = await collectJobs(page);
  }

  // The list is virtualised: only the cards near the viewport exist. Scroll
  // the list itself, then merge whatever new cards mounted.
  const seen = new Map(jobs.map((job) => [job.id, job]));
  for (let pass = 0; pass < 6; pass += 1) {
    const scrolled = await page.evaluate(() => {
      const card = document.querySelector('[role="button"][componentkey]');
      let node = card ? card.parentElement : null;
      while (node && node !== document.body) {
        const style = window.getComputedStyle(node);
        if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 20) {
          node.scrollTop = Math.min(node.scrollHeight, node.scrollTop + node.clientHeight);
          return 'list';
        }
        node = node.parentElement;
      }
      window.scrollBy(0, window.innerHeight);
      return 'window';
    });
    await page.waitForTimeout(600);
    const more = await collectJobs(page);
    let added = 0;
    for (const job of more) {
      if (seen.has(job.id)) continue;
      seen.set(job.id, job);
      added += 1;
    }
    if (added === 0 && scrolled === 'list') break;
    if (seen.size >= 40) break;
  }
  return Array.from(seen.values());
};

if (typeof module === 'object' && module.exports) {
  module.exports = { collectJobs, collectJobsWhenReady };
}
