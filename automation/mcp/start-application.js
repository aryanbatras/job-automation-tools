async (page) => {
  const rawUrl = page.url();
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { status: 'unsupported_job_url', reason: 'malformed_url' };
  }

  const host = url.hostname.toLowerCase();
  const isHost = (domain) => host === domain || host.endsWith(`.${domain}`);

  const captchaCount = await page.locator(
    'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], [class*="captcha" i], [id*="captcha" i], [data-sitekey]',
  ).count();
  if (captchaCount > 0) {
    return { status: 'human_intervention_required', reason: 'captcha_detected' };
  }

  let site;
  if (isHost('linkedin.com')) {
    const id = url.pathname.match(/^\/jobs\/view\/(\d+)/)?.[1] || url.searchParams.get('currentJobId');
    if (!id || !/^\d{4,}$/.test(id)) {
      return { status: 'unsupported_job_url', reason: 'linkedin_job_id_missing' };
    }
    site = 'linkedin';
  } else if (isHost('wellfound.com')) {
    if (!/^\/job\//.test(url.pathname)) {
      return { status: 'unsupported_job_url', reason: 'wellfound_job_path' };
    }
    site = 'wellfound';
  } else if (isHost('ashbyhq.com')) {
    if (!/^\/[^/]+\/[0-9a-f-]{6,}/i.test(url.pathname)) {
      return { status: 'unsupported_job_url', reason: 'ashby_job_path' };
    }
    site = 'ashby';
  } else if (isHost('docs.google.com')) {
    if (!/^\/forms\/(d\/e\/|u\/)/.test(url.pathname)) {
      return { status: 'unsupported_job_url', reason: 'google_forms_path' };
    }
    site = 'google_forms';
  } else {
    return { status: 'unsupported_site', reason: 'domain_not_supported', host };
  }

  if (site === 'google_forms') {
    return { status: 'form_ready', site, url: rawUrl, title: await page.title() };
  }

  const controls = await page.locator('button, a[href], [role="button"]').evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        text: (element.innerText || element.value || element.getAttribute('aria-label') || '').trim(),
        visible: rect.width > 0 && rect.height > 0,
        disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
        tag: element.tagName,
        role: (element.getAttribute('role') || '').toLowerCase(),
        insideForm: Boolean(element.closest('form')),
        nativeSubmit: element.tagName === 'BUTTON' && (element.getAttribute('type') || '').toLowerCase() === 'submit',
      };
    }),
  );

  const isFinalControl = (control) => (
    /\b(submit|send|complete|finalize)\b/i.test(control.text)
    || (control.insideForm && /^apply$/i.test(control.text))
  );
  const entryControls = controls.filter((control) => (
    control.visible
    && !control.disabled
    && /apply/i.test(control.text)
    && !isFinalControl(control)
    && !(control.insideForm && control.nativeSubmit)
  ));

  if (entryControls.length !== 1) {
    return {
      status: 'manual_step',
      reason: entryControls.length === 0 ? 'no_apply_control' : 'ambiguous_apply_control',
      site,
      candidates: entryControls.map((control) => control.text),
    };
  }

  const entry = entryControls[0];
  const exact = new RegExp(`^${entry.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  if (entry.tag === 'A') {
    await page.getByRole('link', { name: exact }).click();
  } else {
    await page.getByRole('button', { name: exact }).click();
  }
  await page.waitForTimeout(500);

  return {
    status: 'started',
    site,
    control: entry.text,
    url: page.url(),
    title: await page.title(),
  };
}
