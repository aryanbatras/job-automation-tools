async (page) => {
  const captchaCount = await page.locator(
    'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], [class*="captcha" i], [id*="captcha" i], [data-sitekey]',
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
        nativeSubmit: element.tagName === 'BUTTON' && (element.getAttribute('type') || '').toLowerCase() === 'submit',
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

  const unsupported = await page
    .locator('iframe, [role="combobox"], [role="listbox"], [contenteditable="true"], input[type="file"]')
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })
        .map((element) => {
          const role = (element.getAttribute('role') || '').toLowerCase();
          const kind = element.tagName === 'IFRAME'
            ? 'iframe'
            : element.tagName === 'INPUT'
              ? 'file_input'
              : 'custom_widget';
          return {
            kind,
            label: (
              element.getAttribute('title')
              || element.getAttribute('aria-label')
              || element.getAttribute('name')
              || 'unsupported control'
            ).trim(),
          };
        }),
    );
  if (unsupported.length > 0) {
    return { status: 'manual_step', reason: 'unsupported_control', unsupported };
  }

  const fields = await page.locator(
    'input:not([type="hidden"]):not([type="file"]):visible, textarea:visible, select:visible',
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

  const progressionControl = buttons.find(({ text, visible, disabled }) =>
    visible && !disabled && /^(next|continue|review|back|previous)$/i.test(text),
  );
  if (progressionControl) {
    return {
      status: 'manual_step',
      reason: progressionControl.nativeSubmit
        ? 'progression_control_may_submit'
        : 'progression_requires_verified_adapter',
      control: progressionControl.text,
      fields,
    };
  }

  return { status: 'ready_for_review', fields };
};
