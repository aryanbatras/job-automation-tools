async (page) => {
  const captchaCount = await page.locator(
    'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], [class*="captcha" i], [id*="captcha" i], [data-sitekey]',
  ).count();
  if (captchaCount > 0) {
    return { status: 'human_intervention_required', reason: 'captcha_detected' };
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

  const isFinalControl = (control) => {
    if (!/\b(submit|send|complete|finalize)\b/i.test(control.text)) return false;
    if (/\b(search|feedback|comment|save|draft|note|review)\b/i.test(control.text)) return false;
    if (/application/i.test(control.text)) return true;
    return control.insideForm;
  };

  const candidates = controls.filter((control) => (
    control.visible && !control.disabled && isFinalControl(control)
  ));

  if (candidates.length !== 1) {
    return {
      status: candidates.length === 0 ? 'no_final_control' : 'ambiguous_final_control',
      reason: 'final_control_not_unambiguous',
      candidates: candidates.map((control) => control.text),
      clicked: false,
    };
  }

  const target = candidates[0];
  const exact = new RegExp(`^${target.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  if (target.tag === 'A') {
    await page.getByRole('link', { name: exact }).click();
  } else {
    await page.getByRole('button', { name: exact }).click();
  }
  await page.waitForTimeout(500);

  const body = await page.locator('body').innerText();
  const success = /application\s+(was|has been)\s+submitted|thank you for applying|we('| ha)ve received your application|submitted successfully|application sent/i
    .test(body);

  if (!success) {
    return {
      status: 'submission_unverified',
      reason: 'success_marker_absent',
      control: target.text,
      clicked: true,
    };
  }

  return {
    status: 'submitted',
    control: target.text,
    clicked: true,
    url: page.url(),
    title: await page.title(),
  };
};
