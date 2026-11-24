(function () {
  /**
   * Shop websites (/s/<slug>): ask for the catalogue now, while the app's scripts are still
   * downloading, instead of after they start (saves about a second on every visit). The store
   * page picks the answer up from window.__zvCatalog (see storefrontPrefetch.ts).
   */
  try {
    var m = /(?:^|\/)s\/([a-z0-9-]{3,30})\/?$/.exec(location.pathname || '');
    var meta = document.querySelector('meta[name="zv-functions"]');
    var base = meta ? meta.getAttribute('content') || '' : '';
    if (m && /^https:\/\/[a-z0-9-]+\.cloudfunctions\.net\/$/.test(base) && base.indexOf('-demo-') < 0) {
      window.__zvCatalog = {
        slug: m[1],
        promise: fetch(base + 'publicStoreCatalog', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: { slug: m[1] } })
        })
          .then(function (r) {
            return r.ok ? r.json() : null;
          })
          .then(function (j) {
            return j && j.result ? j.result : null;
          })
          .catch(function () {
            return null;
          })
      };
    }
  } catch (e) {}

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
