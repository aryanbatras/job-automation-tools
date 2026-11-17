// browser/page-shim.js
// A small stand-in for the Playwright page object, so the engine can run
// inside a page that another tool already drives. It implements only the API
// the engine uses, and it never navigates: navigation stays with the driver
// that owns the browser.
//
// The value setter goes through the native prototype setter and fires real
// input and change events, so controlled inputs keep the value instead of
// resetting it on the next render.

const createPageShim = () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const resolveAll = (selector) => Array.from(document.querySelectorAll(selector));

  const setValue = (element, value) => {
    const prototype =
      element.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : element.tagName === 'SELECT'
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const wrap = (elements) => ({
    count: async () => elements.length,
    first: () => wrap(elements.slice(0, 1)),
    nth: (index) => wrap(elements.slice(index, index + 1)),
    locator: (selector) =>
      wrap(elements.flatMap((element) => Array.from(element.querySelectorAll(selector)))),
    evaluate: async (fn, arg) => (elements[0] ? fn(elements[0], arg) : undefined),
    evaluateAll: async (fn, arg) => fn(elements, arg),
    innerText: async () => (elements[0] ? elements[0].innerText || '' : ''),
    allInnerTexts: async () => elements.map((element) => element.innerText || ''),
    textContent: async () => (elements[0] ? elements[0].textContent || '' : ''),
    getAttribute: async (name) => (elements[0] ? elements[0].getAttribute(name) : null),
    isVisible: async () => {
      const element = elements[0];
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return true;
      const style = window.getComputedStyle(element);
      return !(style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0');
    },
    click: async () => {
      const element = elements[0];
      if (!element) throw new Error('no element to click');
      element.scrollIntoView({ block: 'center' });
      element.click();
    },
    fill: async (value) => {
      const element = elements[0];
      if (!element) throw new Error('no element to fill');
      setValue(element, value);
    },
    check: async () => {
      const element = elements[0];
      if (!element) throw new Error('no element to check');
      element.click();
    },
    setChecked: async (checked) => {
      const element = elements[0];
      if (!element) throw new Error('no element to set');
      if (Boolean(element.checked) !== Boolean(checked)) element.click();
    },
    selectOption: async (options) => {
      const element = elements[0];
      if (!element) throw new Error('no element to select in');
      const wanted = options && typeof options === 'object' ? options.label || options.value : options;
      const option = Array.from(element.options).find(
        (item) => item.label === wanted || item.value === wanted,
      );
      if (!option) throw new Error(`option not found: ${wanted}`);
      setValue(element, option.value);
    },
  });

  const locator = (selector) => wrap(resolveAll(selector));

  const byRole = (role, options = {}) => {
    const selector = role === 'button' ? 'button, a[href]' : '*';
    const name = options.name;
    const elements = resolveAll(selector).filter((element) => {
      const text = (element.innerText || element.getAttribute('aria-label') || '').trim();
      if (name instanceof RegExp) return name.test(text);
      if (typeof name === 'string') return text === name;
      return true;
    });
    return wrap(elements);
  };

  return {
    evaluate: async (fn, arg) => fn(arg),
    locator,
    getByRole: byRole,
    waitForTimeout: sleep,
    url: () => location.href,
    goto: async () => {
      throw new Error('navigation_not_supported_in_page');
    },
  };
};

if (typeof module === 'object' && module.exports) {
  module.exports = { createPageShim };
}
