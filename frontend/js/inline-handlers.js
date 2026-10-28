/* CSP-safe replacements for historical HTML event attributes. No inline JavaScript. */
(function () {
  'use strict';
  document.addEventListener('error', function (ev) {
    const target = ev.target;
    if (target instanceof HTMLElement && target.hasAttribute('data-hide-on-error')) target.style.display = 'none';
  }, true);
  document.addEventListener('click', function (ev) {
    const button = ev.target.closest?.('[data-toggle-password],[data-link-to],[data-reload-page]');
    if (!button) return;
    if (button.dataset.togglePassword) {
      const field = document.querySelector(button.dataset.togglePassword);
      if (!field) return;
      field.type = field.type === 'password' ? 'text' : 'password';
      button.textContent = field.type === 'password' ? 'Show' : 'Hide';
    } else if (button.dataset.linkTo) {
      window.location.href = button.dataset.linkTo;
    } else if (button.hasAttribute('data-reload-page')) {
      window.location.reload();
    }
  });
})();
