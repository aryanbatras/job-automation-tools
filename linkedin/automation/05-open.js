// 05-open.js
// Opens a job and its apply surface.
//
// The job is opened from the results list when its card is a real button.
// Anchor cards, and cards the list has already unmounted, are opened by
// navigating to the job URL: the card is a shortcut, not a requirement.
// The apply control of the job is not always a button, so it is found by its
// text.

const ROOT_MARK = 'data-job-apply-root';

const applicantSystem = (url) => {
  try {
    return new URL(url).searchParams.get('applicantTrackingSystemName') || '';
  } catch {
    return '';
  }
};

const controlKeys = (page) =>
  page.evaluate(() => {
    const helpers = window.__JAT_HELPERS__;
    if (!helpers) return [];
    return helpers.controlsIn(document).map((element) => {
      const label = helpers.labelText(element);
      return `${element.id || ''}|${(element.type || element.tagName || '').toLowerCase()}|${label}`;
    });
  });

// The posting as text: title, company and the description body that the
// second filter reads.
const readJobFacts = (page) =>
  page.evaluate(() => {
    const firstLine = (node) =>
      node
        ? (node.innerText || '')
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)[0] || ''
        : '';
    const title = firstLine(document.querySelector('h1')) || (document.title || '').split('|')[0].trim();
    const company = firstLine(
      document.querySelector(
        '.job-details-jobs-unified-top-card__company-name, .jobs-unified-top-card__company-name, a[data-tracking-control-name*="company"]',
      ),
    );
    const descriptionNode = [
      '.jobs-description-content__text',
      '.jobs-description__content',
      '.jobs-description-content',
      '#job-details',
    ]
      .map((selector) => document.querySelector(selector))
      .find((node) => node && (node.innerText || '').trim().length > 0);
    return {
      title,
      company,
      description: (descriptionNode ? descriptionNode.innerText : '').trim().slice(0, 8000),
    };
  });

const openApply = async (page, job, options = {}) => {
  await installHelpers(page);

  // A previous run can leave the form open on this very job. Resume it
  // instead of hunting for the Easy Apply control behind the overlay.
  const resumable = await page.evaluate(({ jobId }) => {
    const helpers = window.__JAT_HELPERS__;
    if (!helpers) return false;
    const scope = helpers.applyScope();
    if (!scope || !helpers.painted(scope) || !/apply to/i.test(scope.innerText || '')) return false;
    const href = location.href;
    return (
      href.includes(`/jobs/view/${jobId}`) ||
      new URL(href).searchParams.get('currentJobId') === jobId
    );
  }, { jobId: job.id });
  if (resumable) return { status: 'open', controls: (await controlKeys(page)).length };

  // The in-page page object cannot navigate; it asks the driver to do it.
  const canNavigate = async (url) => {
    if (!page || page.canNavigate === false) return false;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      return true;
    } catch {
      return false;
    }
  };

  if (!options.direct) {
    // The results list is virtualised: its cards unmount, and a card click can
    // select the wrong job. One page per job is deterministic.
    const onThisJob = await page.evaluate(
      ({ jobId }) => location.pathname === `/jobs/view/${jobId}/`,
      { jobId: job.id },
    );
    if (!onThisJob) {
      if (!(await canNavigate(job.url))) return { status: 'navigate_required', url: job.url };
      return openApply(page, job, { ...options, direct: true });
    }
  }

  // The second filter: read the posting, then decide from the profile whether
  // this job is a fit before the apply form is ever opened.
  if (options.profile) {
    const facts = await readJobFacts(page);
    const verdict = matchJob({ ...job, ...facts }, {
      profile: options.profile,
      preferences: options.preferences,
    });
    if (!verdict.ok) return { status: 'skipped', reason: verdict.reasons.join(',') };
  }

  const opened = await page.evaluate(async () => {
    const helpers = window.__JAT_HELPERS__;
    if (!helpers) return { status: 'no_helpers' };
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    let easy = null;
    // LinkedIn shows a "Job search safety reminder" over some postings. It
    // covers the apply control until it is dismissed.
    const safety = Array.from(document.querySelectorAll('div[role="dialog"], dialog')).find(
      (node) =>
        node.getBoundingClientRect().height > 0 &&
        /job search safety reminder/i.test(node.innerText || ''),
    );
    if (safety) {
      const dismiss = Array.from(safety.querySelectorAll('button')).find((button) =>
        /^dismiss$/i.test((button.innerText || '').trim()),
      );
      if (dismiss) dismiss.click();
      await wait(500);
    }
    for (let tick = 0; tick < 20 && !easy; tick += 1) {
      easy =
        helpers.controlWithText(/^easy apply( to this job)?$/i) ||
        helpers.controlWithText(/^easy apply/i);
      if (!easy) await wait(300);
    }
    if (!easy) {
      const external = helpers.controlWithText(
        /^(apply|apply now|apply on company website|see job on company site)$/i,
      );
      return { status: external ? 'external_application_system' : 'no_easy_apply_control' };
    }
    easy.click();

    // The panel is a dialog that hydrates after the click; on a cold job page
    // it can take longer than the first poll window.
    const findScope = () => {
      const scope = helpers.applyScope();
      if (!scope) return null;
      const hasControls = scope.querySelector('input, select, textarea');
      if (!hasControls && !/apply to/i.test(scope.innerText || '')) return null;
      return scope;
    };
    let scope = null;
    for (let tick = 0; tick < 40; tick += 1) {
      await wait(250);
      scope = findScope();
      if (scope) break;
    }
    if (!scope) {
      // A click swallowed by a re-render leaves no panel: try the control once
      // more before calling the page broken.
      const again = helpers.controlWithText(/^easy apply( to this job)?$/i);
      if (again) again.click();
      for (let tick = 0; tick < 24; tick += 1) {
        await wait(250);
        scope = findScope();
        if (scope) break;
      }
    }
    if (!scope) return { status: 'apply_surface_not_found' };

    const title =
      (document.querySelector('h1')?.innerText || '').split('\n').filter(Boolean)[0] || '';
    return { status: 'open', title };
  });

  if (opened.status !== 'open') return opened;

  const bodyText = await page.locator('body').innerText().catch(() => '');
  if (/\bapplication\s+(submitted|sent)\b|already applied/i.test(bodyText)) {
    return { status: 'already_applied' };
  }

  const after = applicantSystem(page.url());
  if (after && !/^linkedin$/i.test(after)) {
    return { status: 'external_application_system', reason: after };
  }

  return { status: 'open', controls: (await controlKeys(page)).length };
};

if (typeof module === 'object' && module.exports) {
  module.exports = { openApply, readJobFacts, controlKeys, ROOT_MARK };
}
