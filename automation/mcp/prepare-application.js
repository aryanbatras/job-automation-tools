async (page) => {
  const captchaCount = await page.locator(
    'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], [class*="captcha" i]',
  ).count();
  if (captchaCount > 0) {
    return { status: 'human_intervention_required', reason: 'captcha_detected' };
  }

  const buttons = await page.locator('button, input[type="submit"], [role="button"]').evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        text: (element.innerText || element.value || element.getAttribute('aria-label') || '').trim(),
        visible: rect.width > 0 && rect.height > 0,
        disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
        insideForm: Boolean(element.closest('form')),
      };
    }),
  );
  const finalControl = buttons.find(({ text, visible, insideForm }) =>
    visible && (
      /\bsubmit\b|\bsend\b|\bapply\s+now\b|\bcomplete\s+application\b/i.test(text)
      || (insideForm && /^apply$/i.test(text))
    ),
  );
  if (finalControl) {
    return {
      status: 'approval_required',
      reason: 'final_submission_control_present',
      control: finalControl.text,
    };
  }

  const fields = await page.locator(
    'input:not([type="hidden"]):visible, textarea:visible, select:visible, [role="combobox"]:visible',
  ).evaluateAll((elements) => {
    const fields = [];
    const radioGroups = new Map();
    for (const [index, element] of elements.entries()) {
      const type = (element.type || element.tagName || 'text').toLowerCase();
      const optionLabel = (
        element.labels?.[0]?.innerText
        || element.getAttribute('aria-label')
        || ''
      ).trim();
      const required = Boolean(element.required || element.getAttribute('aria-required') === 'true');
      const invalid = Boolean(
        element.getAttribute('aria-invalid') === 'true'
        || (element.validity && !element.validity.valid),
      );

      if (type === 'radio') {
        const name = element.name || element.getAttribute('name') || '';
        const scope = element.form
          || element.closest('fieldset')
          || element.closest('form')
          || element.ownerDocument
          || element.parentElement
          || element;
        let scopedGroups = radioGroups.get(scope);
        if (!scopedGroups) {
          scopedGroups = new Map();
          radioGroups.set(scope, scopedGroups);
        }
        const key = name || `radio:${element.id || index}`;
        let group = scopedGroups.get(key);
        if (!group) {
          const fieldset = element.closest('fieldset');
          group = {
            label: (
              fieldset?.querySelector('legend')?.innerText
              || fieldset?.getAttribute('aria-label')
              || ''
            ).trim(),
            type: 'radio',
            required: false,
            filled: false,
            invalid: false,
            options: [],
          };
          scopedGroups.set(key, group);
        }
        group.required ||= required;
        group.filled ||= Boolean(element.checked);
        group.invalid ||= invalid;
        if (optionLabel) group.options.push(optionLabel);
        continue;
      }

      const label = (
        element.labels?.[0]?.innerText
        || element.getAttribute('aria-label')
        || element.getAttribute('placeholder')
        || ''
      ).trim();
      const checkedControl = type === 'checkbox';
      const value = checkedControl ? Boolean(element.checked) : String(element.value || '').trim();
      const options = element.tagName === 'SELECT'
        ? Array.from(element.options || []).map((option) => (option.label || option.text || '').trim()).filter(Boolean)
        : [];
      fields.push({
        label,
        type,
        required,
        filled: checkedControl ? value : Boolean(value),
        invalid,
        options,
      });
    }
    const normalizedRadioGroups = Array.from(radioGroups.values()).flatMap((groups) => Array.from(groups.values()));
    return [...fields, ...normalizedRadioGroups];
  });

  const blockers = fields.filter((field) => field.required && (!field.label || !field.filled || field.invalid));
  if (blockers.length > 0 || fields.some((field) => field.invalid)) {
    return {
      status: 'needs_answers',
      reason: blockers.some((field) => !field.label) ? 'unlabeled_required_field' : 'required_or_invalid_fields',
      fields,
    };
  }

  const advanceControl = buttons.find(({ text, visible, disabled }) =>
    visible && !disabled && /^(next|continue|review)$/i.test(text),
  );
  if (!advanceControl) {
    return { status: 'ready_for_review', fields };
  }

  await page.getByRole('button', { name: new RegExp(`^${advanceControl.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).click();
  await page.waitForTimeout(250);
  return {
    status: 'advanced',
    control: advanceControl.text,
    url: page.url(),
    title: await page.title(),
  };
}
