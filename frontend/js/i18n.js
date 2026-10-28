/* English-first strings. Consumers opt in; existing copy remains untouched until translated and reviewed. */
(function (root) {
  'use strict';
  const strings = Object.freeze({
    en: Object.freeze({ 'common.save': 'Save', 'common.cancel': 'Cancel', 'common.loading': 'Loading…',
      'auth.signIn': 'Sign in', 'auth.signOut': 'Sign out', 'payment.verify': 'Verify payment',
      'error.tryAgain': 'Please try again.' })
  });
  root.AHCT_I18N = Object.freeze({ defaultLocale: 'en', locales: Object.keys(strings),
    t(key, locale = 'en') { return (strings[locale] || strings.en)[key] || strings.en[key] || key; } });
})(window);
