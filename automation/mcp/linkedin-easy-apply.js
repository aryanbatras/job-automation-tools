async (page) => {
  const CHALLENGE_SELECTOR =
    'iframe[src*="recaptcha" i], iframe[src*="hcaptcha" i], iframe[src*="turnstile" i], [class*="captcha" i], [id*="captcha" i], [data-sitekey]';

  const report = {
    status: 'unknown',
    url: page.url(),
    steps: [],
    filled: [],
    skipped: [],
    unsupported: [],
    prefilled: [],
    validationErrors: [],
    submitVisible: false,
    notes: [],
  };

  const firstVisible = async (locator) => {
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
    return null;
  };

  const submitButton = () => firstVisible(page.getByRole('button', { name: /^(submit application|submit|send application)$/i }));
  const nextButton = () => firstVisible(page.getByRole('button', { name: /^(next|continue)$/i }));

  const challengePresent = async () => (await page.locator(CHALLENGE_SELECTOR).count()) > 0;

  if (!/(^|\.)linkedin\.com$/i.test(new URL(page.url()).hostname)) {
    return { ...report, status: 'unsupported_site', reason: 'not_linkedin' };
  }

  // LinkedIn renders the apply surface as a page overlay without a dialog role,
  // so treat a visible Submit/Next control as "the form is open".
  let submit = await submitButton();
  let next = await nextButton();
  if (!submit && !next) {
    const entry = await firstVisible(page.getByRole('button', { name: /easy apply/i }));
    if (!entry) {
      return { ...report, status: 'manual_step', reason: 'no_easy_apply_button' };
    }
    await entry.click({ timeout: 15000 }).catch(async () => {
      await entry.evaluate((element) => element.click());
    });
    await page.waitForTimeout(1800);
    submit = await submitButton();
    next = await nextButton();
    if (!submit && !next) {
      return { ...report, status: 'manual_step', reason: 'easy_apply_surface_not_open' };
    }
  }

  const fillPage = async () =>
    page.evaluate(() => {
      const injected = window.__JOB_ANSWERS__;
      const answers = Array.isArray(injected) ? injected : (injected && injected.entries) || [];
      const norm = (value) =>
        String(value || '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, ' ')
          .trim();

      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return true;
        // Custom radios and checkboxes hide the input and style the label.
        const label = element.closest('label');
        if (!label) return false;
        const labelRect = label.getBoundingClientRect();
        return labelRect.width > 0 && labelRect.height > 0;
      };

      const labelText = (element) => {
        const labels = element.labels ? Array.from(element.labels) : [];
        const fromLabels = labels
          .map((label) => label.innerText || label.textContent || '')
          .join(' ')
          .trim();
        return (
          fromLabels ||
          (element.getAttribute('aria-label') || '') ||
          (element.getAttribute('placeholder') || '') ||
          (element.getAttribute('name') || '')
        ).trim();
      };

      const groupLabel = (element) => {
        const fieldset = element.closest('fieldset');
        if (fieldset) {
          const legend = fieldset.querySelector('legend');
          if (legend && legend.innerText.trim()) return legend.innerText.trim();
        }
        const group = element.closest('[role="radiogroup"]');
        if (group) {
          const labelled = group.getAttribute('aria-label') || group.getAttribute('aria-labelledby');
          if (labelled) return labelled.trim();
          const heading = group.querySelector('h1,h2,h3,h4,h5,legend,strong,b');
          if (heading) return heading.innerText.trim();
        }
        let node = element.parentElement;
        for (let depth = 0; depth < 6 && node; depth += 1) {
          const heading = node.querySelector('h1,h2,h3,h4,h5,legend');
          if (heading && heading.innerText.trim()) return heading.innerText.trim();
          node = node.parentElement;
        }
        return '';
      };

      const setNativeValue = (element, value) => {
        const prototype =
          element.tagName === 'TEXTAREA'
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
        setter.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      };

      const matchEntry = (label, name) => {
        const normalizedLabel = norm(label);
        const normalizedName = norm(name);
        for (const entry of answers) {
          const candidate = norm(entry.label);
          if (candidate && (candidate === normalizedLabel || (normalizedName && candidate === normalizedName))) {
            return entry;
          }
        }
        for (const entry of answers) {
          const candidate = norm(entry.label);
          if (!candidate) continue;
          if (normalizedLabel && (normalizedLabel.includes(candidate) || candidate.includes(normalizedLabel))) {
            return entry;
          }
          if (entry.keywords && entry.keywords.some((keyword) => normalizedLabel.includes(norm(keyword)))) {
            return entry;
          }
        }
        return null;
      };

      const result = { filled: [], skipped: [], unsupported: [], prefilled: [] };
      const controls = Array.from(document.querySelectorAll('input, textarea, select')).filter(visible);

      for (const element of controls) {
        const type = (element.type || element.tagName || '').toLowerCase();
        if (type === 'hidden') continue;
        const label = labelText(element);

        if (type === 'file') {
          result.unsupported.push({ label, reason: 'file_input' });
          continue;
        }

        if (type === 'radio') {
          const question = groupLabel(element);
          const entry =
            matchEntry(question, element.getAttribute('name')) ||
            matchEntry(label, element.getAttribute('name'));
          if (!entry) {
            result.skipped.push({ label: question || label, reason: 'no_answer' });
            continue;
          }
          const wanted = norm(entry.value);
          const scope = element.closest('fieldset, [role="radiogroup"], form') || document;
          const radios = Array.from(scope.querySelectorAll('input[type="radio"]'));
          const option =
            radios.find((radio) => norm(labelText(radio)) === wanted) ||
            radios.find((radio) => norm(labelText(radio)).includes(wanted));
          if (!option) {
            result.skipped.push({ label: question || label, reason: 'option_not_found' });
            continue;
          }
          if (!option.checked) option.click();
          result.filled.push({ label: question || label, how: 'radio' });
          continue;
        }

        if (type === 'checkbox') {
          const entry = matchEntry(label, element.getAttribute('name'));
          if (!entry) {
            result.skipped.push({ label, reason: 'no_answer' });
            continue;
          }
          const wanted = ['true', 'yes', 'checked'].includes(norm(entry.value));
          if (element.checked !== wanted) element.click();
          result.filled.push({ label, how: 'checkbox' });
          continue;
        }

        const currentValue = String(element.value || '').trim();
        if (currentValue) {
          result.prefilled.push({ label });
          continue;
        }

        const entry = matchEntry(label, element.getAttribute('name'));
        if (!entry) {
          result.skipped.push({ label, reason: 'no_answer' });
          continue;
        }
        const value = String(entry.value == null ? '' : entry.value);

        if (element.tagName === 'SELECT') {
          const options = Array.from(element.options);
          const option =
            options.find((item) => norm(item.label) === norm(value)) ||
            options.find((item) => norm(item.label).includes(norm(value)));
          if (!option) {
            result.skipped.push({ label, reason: 'option_not_found' });
            continue;
          }
          if (element.value !== option.value) {
            element.value = option.value;
            element.dispatchEvent(new Event('change', { bubbles: true }));
          }
          result.filled.push({ label, how: 'select' });
          continue;
        }

        setNativeValue(element, value);
        result.filled.push({ label, how: 'text' });
      }

      return result;
    });

  for (let step = 0; step < 6; step += 1) {
    if (await challengePresent()) {
      return { ...report, status: 'human_intervention_required', reason: 'captcha_detected' };
    }

    // Lazy-rendered sections below the fold must exist before fields are read.
    for (let scroll = 0; scroll < 6; scroll += 1) {
      await page.mouse.wheel(0, 1200).catch(() => {});
      await page.waitForTimeout(250);
    }
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});

    const filled = await fillPage();
    report.filled.push(...filled.filled);
    report.skipped.push(...filled.skipped);
    report.unsupported.push(...filled.unsupported);
    report.prefilled.push(...filled.prefilled);

    submit = await submitButton();
    next = await nextButton();

    if (submit && (await submit.isEnabled().catch(() => false))) {
      report.submitVisible = true;
      report.status = 'ready_for_submit';
      report.steps.push({ step, action: 'submit_available' });
      return report;
    }

    if (!next) {
      report.status = 'manual_step';
      report.reason = 'no_next_or_submit_control';
      report.steps.push({ step, action: 'stopped' });
      return report;
    }

    if (!(await next.isEnabled().catch(() => false))) {
      report.status = 'needs_answers';
      report.reason = 'next_control_disabled';
      report.steps.push({ step, action: 'blocked' });
      return report;
    }

    await next.click({ timeout: 15000 }).catch(async () => {
      await next.evaluate((element) => element.click());
    });
    await page.waitForTimeout(1500);

    const errors = await page
      .locator('.artdeco-inline-message, [role="alert"], .jobs-application-form__error')
      .allInnerTexts()
      .catch(() => []);
    report.validationErrors.push(...errors.map((text) => text.trim()).filter(Boolean).slice(0, 5));
    report.steps.push({ step, action: 'advanced' });

    if (report.validationErrors.length > 0) {
      report.status = 'needs_answers';
      report.reason = 'validation_error';
      return report;
    }
  }

  report.status = 'manual_step';
  report.reason = 'step_limit_reached';
  return report;
}
