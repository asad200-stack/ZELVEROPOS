// Environment detection for CATCH POS.
// Determines whether the current frontend is running on the TEST or PROD site.

(function () {
    const host = (typeof window !== 'undefined' && window.location && window.location.hostname) || '';
    const hostname = String(host).toLowerCase();

    // Test site identifiers. Adjust these to match the actual test site URLs after
    // creating the Firebase Hosting site (e.g. pos-catch-test.web.app).
    const TEST_HOSTS = [
        'pos-catch-test.web.app',
        'pos-catch-test.firebaseapp.com',
        'pos-catch--test.web.app',
        'pos-catch--test.firebaseapp.com'
    ];

    const isTest = TEST_HOSTS.some((h) => hostname === h || hostname.endsWith('.' + h));

    window.__APP_ENV = isTest ? 'test' : 'prod';
    window.__APP_ENV_IS_TEST = isTest;

    // Default semantic version label. Override this in the build/deploy step
    // or via the hosting cache-busting query parameter if needed.
    window.__APP_VERSION_LABEL = window.__APP_VERSION_LABEL || '1.0.0';

    // Show the TEST badge in the header when running on the test environment.
    function renderAppEnvBadge() {
        try {
            const badge = document.getElementById('appEnvBadge');
            if (badge) badge.style.display = isTest ? 'inline-flex' : 'none';
            if (document.body) {
                document.body.classList.toggle('app-env-test', isTest);
                document.body.classList.toggle('app-env-prod', !isTest);
            }
        } catch (_) {}
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', renderAppEnvBadge);
    } else {
        renderAppEnvBadge();
    }
})();
