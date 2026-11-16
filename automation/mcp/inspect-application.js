async (page) => {
  const url = page.url();
  let site = '';
  try {
    site = new URL(url).hostname;
  } catch {
    site = '';
  }

  const challengeCount = await page.locator(
    'iframe[src*="recaptcha" i], iframe[src*="hcaptcha" i], iframe[src*="turnstile" i], [class*="captcha" i], [id*="captcha" i], [data-sitekey]',
  ).count();
  if (challengeCount > 0) {
    return {
      status: 'human_intervention_required',
      reason: 'captcha_detected',
      site,
      url,
      fields: [],
      unsupported: [],
    };
  }

  const inventory = await page
    .locator('input, textarea, select, [contenteditable="true"], [role="combobox"], [role="listbox"], [role="spinbutton"]')
    .evaluateAll((elements) => {
      const fields = [];
      const unsupported = [];
      const radioGroups = new Map();

      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const text = (value) => (value || '').trim();
      const labelOf = (element) =>
        text(element.labels?.[0]?.innerText) ||
        text(element.getAttribute('aria-label')) ||
        text(element.getAttribute('placeholder')) ||
        text(element.getAttribute('title'));
      const targetOf = (element) => {
        if (element.id) return `#${CSS.escape(element.id)}`;
        const name = element.getAttribute('name');
        if (name) return `[name="${name}"]`;
        return '';
      };

      for (const [index, element] of elements.entries()) {
        if (!visible(element)) continue;
        const tag = (element.tagName || '').toLowerCase();
        const type = (element.type || tag).toLowerCase();
        const role = text(element.getAttribute('role')).toLowerCase();
        const label = labelOf(element);
        const target = targetOf(element);

        if (type === 'file') {
          unsupported.push({ kind: 'file_input', label, target, reason: 'file_chooser' });
          continue;
        }
        if (['combobox', 'listbox', 'spinbutton'].includes(role)) {
          unsupported.push({ kind: 'custom_widget', label, target, reason: 'custom_widget' });
          continue;
        }
        if (element.getAttribute('contenteditable') === 'true') {
          unsupported.push({ kind: 'custom_widget', label, target, reason: 'contenteditable' });
          continue;
        }
        if (tag === 'select' && element.multiple) {
          unsupported.push({ kind: 'multi_select', label, target, reason: 'multiple_selection' });
          continue;
        }

        const required = Boolean(element.required || element.getAttribute('aria-required') === 'true');
        const invalid = Boolean(
          element.getAttribute('aria-invalid') === 'true' || (element.validity && !element.validity.valid),
        );

        if (type === 'radio') {
          const name = element.getAttribute('name') || '';
          const scope =
            element.form || element.closest('fieldset') || element.closest('form') || element.ownerDocument || element;
          let scoped = radioGroups.get(scope);
          if (!scoped) {
            scoped = new Map();
            radioGroups.set(scope, scoped);
          }
          const key = name || `radio:${element.id || index}`;
          let group = scoped.get(key);
          if (!group) {
            const fieldset = element.closest('fieldset');
            group = {
              label: text(fieldset?.querySelector('legend')?.innerText) || text(fieldset?.getAttribute('aria-label')),
              type: 'radio',
              target: name ? `[name="${name}"]` : target,
              required: false,
              invalid: false,
              filled: false,
              options: [],
            };
            scoped.set(key, group);
          }
          group.required ||= required;
          group.filled ||= Boolean(element.checked);
          group.invalid ||= invalid;
          if (label) group.options.push(label);
          continue;
        }

        const checkedControl = type === 'checkbox';
        const value = checkedControl ? Boolean(element.checked) : String(element.value || '').trim();
        const options = tag === 'select'
          ? Array.from(element.options || [])
            .map((option) => text(option.label || option.text))
            .filter((option) => option && option.toLowerCase() !== 'select')
          : [];

        fields.push({
          label,
          type,
          target,
          required,
          invalid,
          filled: checkedControl ? value : Boolean(value),
          options,
        });
      }

      for (const groups of radioGroups.values()) {
        for (const group of groups.values()) fields.push(group);
      }
      return { fields, unsupported };
    });

  const frames = await page.locator('iframe').evaluateAll((elements) =>
    elements
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((element) => ({
        kind: 'iframe',
        label: (element.getAttribute('title') || element.getAttribute('name') || 'embedded frame').trim(),
        target: '',
        reason: 'cross_frame_control',
      })),
  );

  const unsupported = [...inventory.unsupported, ...frames];
  const blocked = inventory.fields.filter(
    (field) => field.required && (!field.label || !field.filled || field.invalid),
  );
  const invalid = inventory.fields.filter((field) => field.invalid);

  let status = 'ok';
  if (unsupported.length > 0) status = 'manual_step';
  else if (blocked.length > 0 || invalid.length > 0) status = 'needs_answers';

  return {
    status,
    site,
    url,
    fields: inventory.fields,
    unsupported,
  };
};
