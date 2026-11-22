(function () {
  try {
    var lang = localStorage.getItem('zelvero.lang') || 'en';
    var theme = localStorage.getItem('zelvero.theme') || 'light';
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.dataset.theme = theme;
  } catch (e) {}

  /**
   * A store that already moved to a versioned tree (/app/{version}/, via "Update now") keeps
   * opening it from the old links and the home-screen icon. Only versions listed in
   * /release.json "trees" are followed, so a removed tree can never trap anyone, and a store that
   * never updated (its last version is the root app's own) stays exactly where it is.
   */
  var path = location.pathname || '/';
  if (path.indexOf('/app/') === 0 || path.indexOf('/s/') === 0) return;
  var lastGood = null;
  try {
    lastGood = localStorage.getItem('zelvero.lastGoodVersion');
  } catch (e) {}
  if (!lastGood) return;
  var search = location.search || '';
  var hash = location.hash || '';
  fetch('/release.json', { cache: 'no-store' })
    .then(function (r) {
      return r.ok ? r.json() : {};
    })
    .then(function (meta) {
      var trees = meta && Array.isArray(meta.trees) ? meta.trees : [];
      if (trees.indexOf(lastGood) < 0) return;
      location.replace('/app/' + lastGood + (path === '/' ? '/' : path) + search + hash);
    })
    .catch(function () {});
})();
