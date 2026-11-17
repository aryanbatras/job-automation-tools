// 06-inspect.js
// Inventory of every visible control in the apply surface. Never returns a
// value, only the question and its state.
//
// The scope is the same apply surface the advance and submit modules use, so
// the guardrail and the click always look at the same form.

const inspectFields = (page) =>
  page.evaluate(() => {
    const helpers = window.__JAT_HELPERS__;
    if (!helpers) return { fields: [], unsupported: [], scopeFound: false };
    const root = helpers.applyScope();
    if (!root) return { fields: [], unsupported: [], scopeFound: false };

    const fields = [];
    const unsupported = [];
    const radioGroups = new Map();

    for (const element of helpers.controlsIn(root)) {
      const type = (element.type || element.tagName || '').toLowerCase();
      const label = helpers.labelText(element);

      if (type === 'file') {
        unsupported.push({ label, reason: 'file_input' });
        continue;
      }
      if (type === 'radio') {
        const name = element.getAttribute('name') || '';
        const key = name || label || `radio:${fields.length}`;
        let group = radioGroups.get(key);
        if (!group) {
          group = {
            label: helpers.groupLabel(element),
            type: 'radio',
            required: false,
            invalid: false,
            filled: false,
            options: [],
          };
          radioGroups.set(key, group);
        }
        group.required = group.required || Boolean(element.required);
        group.invalid = group.invalid || element.getAttribute('aria-invalid') === 'true';
        group.filled = group.filled || Boolean(element.checked);
        if (label) group.options.push(label);
        continue;
      }

      const required = Boolean(element.required || element.getAttribute('aria-required') === 'true');
      const error = helpers.controlError
        ? helpers.controlError(element)
        : { message: '', over: false };
      // A message the page only refreshes on the next click is not proof
      // here: the step click is where the page validates. A hard over-length
      // or an aria-invalid mark is proof.
      const invalid = Boolean(
        element.getAttribute('aria-invalid') === 'true' ||
          (element.validity && !element.validity.valid) ||
          error.over,
      );
      const filled =
        (type === 'checkbox' ? Boolean(element.checked) : Boolean(String(element.value || '').trim())) &&
        !invalid;
      const options =
        element.tagName === 'SELECT'
          ? Array.from(element.options)
              .map((option) => (option.label || option.text || '').trim())
              .filter(Boolean)
          : [];

      fields.push({ label, type, required, invalid, filled, options });
    }

    for (const group of radioGroups.values()) fields.push(group);

    return {
      fields,
      unsupported,
      scopeFound: true,
      errors: helpers.validationErrors(root),
      broken: helpers.controlsWithErrors(root),
    };
  });

if (typeof module === 'object' && module.exports) {
  module.exports = { inspectFields };
}
