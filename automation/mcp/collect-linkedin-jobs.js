async (page) => {
  const currentUrl = new URL(page.url());
  if (!/(^|\.)linkedin\.com$/i.test(currentUrl.hostname)) {
    return { status: 'unsupported_page', jobs: [] };
  }

  const cards = await page.locator('a[href*="/jobs/view/"]').evaluateAll((links) =>
    links.map((link) => {
      const card = link.closest(
        'li.jobs-search-results__list-item, .job-card-container, .job-card-list__entity-lockup, article',
      ) || link.parentElement;
      return {
        href: link.href,
        linkText: link.innerText || link.getAttribute('aria-label') || '',
        cardText: card?.innerText || '',
      };
    }),
  );

  const jobs = [];
  const seen = new Set();
  for (const card of cards) {
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
    });
    if (jobs.length === 40) break;
  }

  return { status: 'ok', count: jobs.length, jobs };
}
