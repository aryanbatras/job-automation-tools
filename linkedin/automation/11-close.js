// 11-close.js
// Closes the apply surface after a job is done, so the next job starts from
// the results list instead of on top of a stale form.

const closeApply = async (page) => {
  return page.evaluate(
    (mark) => {
      const root = document.querySelector(`[${mark}="1"]`);
      // Never fall back to the whole page: a job card's "Dismiss" button
      // lives there too, and clicking it would drop the job from the list.
      const scope = root || document.querySelector('[role="dialog"]');
      if (!scope) return 'none';
      const text = (button) =>
        (button.getAttribute('aria-label') || button.innerText || '').trim();
      const close = Array.from(scope.querySelectorAll('button')).find((button) =>
        /^(dismiss|close|cancel)$/i.test(text(button)),
      );
      if (close) {
        close.click();
        return 'closed';
      }
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return 'escape';
    },
    ROOT_MARK,
  );
};

if (typeof module === 'object' && module.exports) {
  module.exports = { closeApply };
}
