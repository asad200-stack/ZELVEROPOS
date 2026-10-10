(function () {
  try {
    var lang = localStorage.getItem('zelvero.lang') || 'en';
    var theme = localStorage.getItem('zelvero.theme') || 'light';
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.dataset.theme = theme;
  } catch (e) {}
})();
