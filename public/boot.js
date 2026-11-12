(function () {
  try {
    var lang = localStorage.getItem('zelvero.lang') || 'en';
    var theme = localStorage.getItem('zelvero.theme') || 'light';
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.dataset.theme = theme;
  } catch (e) {}

  /**
   * Versioned-tree redirect is opt-in (data-release-boot="1" on the boot-only shell).
   * Production Hosting keeps the normal app index so stores are not cut over.
   * Signed-out / first-time browsers use /release.json defaultVersion — no tenant required.
   */
  if (document.documentElement.getAttribute('data-release-boot') !== '1') return;
  var path = location.pathname || '/';
  if (path.indexOf('/app/') === 0) return;

  var search = location.search || '';
  var hash = location.hash || '';
  var lastGood = null;
  try {
    lastGood = localStorage.getItem('zelvero.lastGoodVersion');
  } catch (e) {}

  function go(version) {
    if (!version) return;
    var rest = path === '/' ? '/' : path;
    location.replace('/app/' + version + rest + search + hash);
  }

  fetch('/release.json', { cache: 'no-store' })
    .then(function (r) {
      return r.ok ? r.json() : {};
    })
    .then(function (meta) {
      go(lastGood || meta.defaultVersion);
    })
    .catch(function () {
      if (lastGood) go(lastGood);
    });
})();
