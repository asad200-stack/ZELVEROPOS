/**
 * Promote the live TEST Firebase Hosting version to Production via Hosting API clone.
 */
const { GoogleAuth } = require('google-auth-library');

const HOSTING_API = 'https://firebasehosting.googleapis.com/v1beta1';
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'pos-catch';
const TEST_SITE = process.env.HOSTING_TEST_SITE || 'pos-catch-test';
const PROD_SITE = process.env.HOSTING_PROD_SITE || 'pos-catch';
const TEST_HOST = process.env.HOSTING_TEST_URL || 'https://pos-catch-test.web.app';
const PROD_HOST = process.env.HOSTING_PROD_URL || 'https://pos-catch.web.app';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeRawBuildManifest(raw, envFallback) {
  if (!raw || typeof raw !== 'object') return null;
  const scriptVersion = Math.max(
    0,
    Number(raw.scriptVersion || raw.buildId || 0) || 0
  );
  const buildId = String(raw.buildId || scriptVersion || '').trim();
  if (!buildId && !scriptVersion) return null;
  const appVersion = String(raw.version || raw.appVersion || '').trim();
  const environment = String(raw.environment || raw.env || envFallback || '').trim().toLowerCase();
  return {
    buildId: buildId || String(scriptVersion),
    version: appVersion,
    appVersion,
    scriptVersion: scriptVersion || Number(buildId) || 0,
    cssVersion: Math.max(0, Number(raw.cssVersion || 0) || 0),
    deployedAt: String(raw.deployedAt || '').trim(),
    environment: environment || envFallback,
    env: environment || envFallback,
    commit: String(raw.commit || '').trim(),
    fetchedAt: new Date().toISOString()
  };
}

function parseBuildMetaFromHtml(html, envFallback) {
  if (!html || typeof html !== 'string') return null;
  const match = html.match(/window\.__APP_BUILD_META\s*=\s*(\{[\s\S]*?\});/);
  if (match) {
    try {
      const raw = JSON.parse(match[1]);
      const normalized = normalizeRawBuildManifest(raw, envFallback);
      if (normalized) return normalized;
    } catch (_) {}
  }
  const scriptMatch = html.match(/script\.js\?v=(\d+)/i);
  if (scriptMatch) {
    const scriptVersion = Number(scriptMatch[1] || 0) || 0;
    if (scriptVersion > 0) {
      return normalizeRawBuildManifest({
        buildId: String(scriptVersion),
        scriptVersion,
        environment: envFallback
      }, envFallback);
    }
  }
  return null;
}

async function fetchText(url) {
  const bust = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const bustUrl = url.includes('?') ? `${url}&_=${bust}` : `${url}?_=${bust}`;
  const res = await fetch(bustUrl, {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Accept: 'application/json,text/html,*/*'
    }
  });
  if (!res.ok) return { ok: false, text: '', contentType: '' };
  const text = await res.text();
  const contentType = String(res.headers.get('content-type') || '');
  return { ok: true, text, contentType };
}

async function fetchProdBuildManifestStrict(hostBase, envFallback) {
  const base = String(hostBase || '').replace(/\/+$/, '');
  if (!base) return null;
  const manifestTry = await fetchText(`${base}/build-manifest.json`);
  if (!manifestTry.ok || !manifestTry.text) return null;
  const trimmed = manifestTry.text.trim();
  if (!trimmed.startsWith('{') || trimmed.startsWith('<!')) return null;
  try {
    const raw = JSON.parse(trimmed);
    const normalized = normalizeRawBuildManifest(raw, envFallback);
    return normalized || null;
  } catch (_) {
    return null;
  }
}

async function fetchBuildManifest(hostBase, envFallback) {
  const strict = await fetchProdBuildManifestStrict(hostBase, envFallback);
  if (strict) return strict;

  const base = String(hostBase || '').replace(/\/+$/, '');
  if (!base) return null;
  const indexTry = await fetchText(`${base}/index.html`);
  if (indexTry.ok && indexTry.text) {
    return parseBuildMetaFromHtml(indexTry.text, envFallback);
  }
  return null;
}

function getBuildNumber(build) {
  return Math.max(0, Number(build && (build.scriptVersion || build.buildId) || 0) || 0);
}

function evaluateDeploymentStatus(snapshots, prev) {
  const test = snapshots && snapshots.test ? snapshots.test : null;
  const prod = snapshots && snapshots.prod ? snapshots.prod : null;
  const approved = (prev && prev.latestApprovedBuild) || test || null;
  const testBuild = getBuildNumber(test);
  const prodBuild = getBuildNumber(prod);
  const approvedBuild = getBuildNumber(approved);

  const buildMetadataAvailable = testBuild > 0 && prodBuild > 0 && approvedBuild > 0;
  const buildsAligned = testBuild === prodBuild && prodBuild === approvedBuild;
  const promotionRequired = buildMetadataAvailable && testBuild > prodBuild;
  const releaseAllowed = buildMetadataAvailable && buildsAligned;
  const promoteAllowed = testBuild > 0 && prodBuild > 0 && testBuild > prodBuild;

  let statusMessage = 'Build information unavailable. Cannot verify production deployment.';
  let promoteMessage = 'Cannot promote or release because build metadata is missing.';

  if (buildMetadataAvailable) {
    if (promotionRequired) {
      statusMessage = `Promote TEST build ${testBuild} to Production before releasing to users.`;
      promoteMessage = `Clone TEST build ${testBuild} to Production (current: ${prodBuild}).`;
    } else if (!buildsAligned) {
      statusMessage = `Build mismatch. TEST ${testBuild}, Production ${prodBuild}, Approved ${approvedBuild}.`;
      promoteMessage = 'Production already has the latest TEST build.';
    } else {
      statusMessage = 'Production matches approved TEST build. You can release to users.';
      promoteMessage = 'Production already has the latest TEST build.';
    }
  }

  return {
    buildMetadataAvailable,
    promotionRequired,
    releaseAllowed,
    promoteAllowed,
    statusMessage,
    promoteMessage,
    test,
    prod,
    latestApprovedBuild: approved
  };
}

async function getHostingAccessToken() {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/firebase.hosting'] });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token = tokenResponse && tokenResponse.token ? tokenResponse.token : tokenResponse;
  if (!token) throw new Error('Could not obtain Firebase Hosting access token.');
  return token;
}

async function hostingJson(path, options = {}) {
  const token = await getHostingAccessToken();
  const url = path.startsWith('http') ? path : `${HOSTING_API}/${path.replace(/^\//, '')}`;
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) ? data.error.message : `Hosting API error (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

async function pollHostingOperation(operation, timeoutMs = 600000) {
  const started = Date.now();
  const opName = typeof operation === 'string' ? operation : operation.name;
  if (!opName) return operation;
  while (Date.now() - started < timeoutMs) {
    const path = opName.replace(HOSTING_API + '/', '').replace(/^\/+/, '');
    const op = await hostingJson(path);
    if (op.done) {
      if (op.error) throw new Error(op.error.message || 'Hosting operation failed.');
      return op.response || op.result || op;
    }
    await sleep(2500);
  }
  throw new Error('Hosting promotion timed out. Check Firebase Hosting console for status.');
}

async function getLiveChannel(siteId) {
  return hostingJson(`sites/${siteId}/channels/live`);
}

async function getLiveVersionName(siteId) {
  const channel = await getLiveChannel(siteId);
  const versionName = channel && channel.release && channel.release.version && channel.release.version.name;
  if (!versionName) throw new Error(`No live version found on site ${siteId}.`);
  return versionName;
}

function resolveClonedVersionName(clonedVersion, operation) {
  const candidates = [
    clonedVersion && clonedVersion.name,
    clonedVersion && clonedVersion.version && clonedVersion.version.name,
    operation && operation.response && operation.response.name,
    operation && operation.response && operation.response.version && operation.response.version.name,
    operation && operation.result && operation.result.name
  ];
  for (const value of candidates) {
    if (value && String(value).includes('/versions/')) return String(value);
  }
  return '';
}

async function getLatestSiteVersionName(siteId) {
  const data = await hostingJson(`sites/${siteId}/versions?pageSize=1`);
  const versions = Array.isArray(data.versions) ? data.versions : [];
  if (!versions.length || !versions[0].name) {
    throw new Error(`No versions found on site ${siteId}.`);
  }
  return String(versions[0].name);
}

async function releaseVersionToLive(siteId, versionName) {
  if (!versionName) throw new Error('Missing cloned production version name.');
  const encoded = encodeURIComponent(versionName);
  return hostingJson(`sites/${siteId}/channels/live/releases?versionName=${encoded}`, {
    method: 'POST',
    body: {}
  });
}

async function waitForLiveVersion(siteId, expectedVersionName, timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const liveVersion = await getLiveVersionName(siteId);
    if (liveVersion === expectedVersionName) return liveVersion;
    await sleep(3000);
  }
  return getLiveVersionName(siteId);
}

async function waitForVerifiedProdManifest(testBuildBefore, timeoutMs = 90000) {
  const targetBuild = getBuildNumber(testBuildBefore);
  if (!targetBuild) throw new Error('TEST build metadata is unavailable.');
  const started = Date.now();
  let latest = null;
  while (Date.now() - started < timeoutMs) {
    latest = await fetchProdBuildManifestStrict(PROD_HOST, 'production');
    if (latest && getBuildNumber(latest) === targetBuild) {
      return latest;
    }
    await sleep(3000);
  }
  return latest;
}

async function promoteTestLiveVersionToProduction() {
  const sourceVersionName = await getLiveVersionName(TEST_SITE);
  const prodLiveVersionBefore = await getLiveVersionName(PROD_SITE);
  const testBuildBefore = await fetchProdBuildManifestStrict(TEST_HOST, 'test')
    || await fetchBuildManifest(TEST_HOST, 'test');
  const prodBuildBefore = await fetchBuildManifest(PROD_HOST, 'production');
  const targetBuild = getBuildNumber(testBuildBefore);

  if (!targetBuild) {
    throw new Error('TEST build-manifest.json is missing or invalid. Deploy TEST before promoting.');
  }

  const cloneOp = await hostingJson(`sites/${PROD_SITE}/versions:clone`, {
    method: 'POST',
    body: { sourceVersion: sourceVersionName, finalize: true }
  });
  let clonedVersion = cloneOp;
  if (cloneOp && cloneOp.name && String(cloneOp.name).includes('/operations/')) {
    clonedVersion = await pollHostingOperation(cloneOp);
  }

  let clonedVersionName = resolveClonedVersionName(clonedVersion, cloneOp);
  if (!clonedVersionName) {
    clonedVersionName = await getLatestSiteVersionName(PROD_SITE);
  }

  await releaseVersionToLive(PROD_SITE, clonedVersionName);
  const prodLiveVersionAfter = await waitForLiveVersion(PROD_SITE, clonedVersionName);
  const prodBuildAfter = await waitForVerifiedProdManifest(testBuildBefore);

  if (!prodBuildAfter || getBuildNumber(prodBuildAfter) !== targetBuild) {
    const observed = getBuildNumber(prodBuildAfter);
    const manifestUrl = `${PROD_HOST}/build-manifest.json`;
    throw new Error(
      `Promotion verification failed. Expected production build-manifest.json buildId ${targetBuild} at ${manifestUrl}, but got ${observed || 'no valid manifest'}. Live production is still serving build ${getBuildNumber(prodBuildBefore) || 'unknown'}.`
    );
  }

  return {
    projectId: PROJECT_ID,
    sourceVersionName,
    targetSite: PROD_SITE,
    sourceSite: TEST_SITE,
    clonedVersionName,
    prodLiveVersionBefore,
    prodLiveVersionAfter,
    verified: true,
    fromBuildId: String(testBuildBefore.buildId || targetBuild),
    toBuildId: String(prodBuildAfter.buildId || targetBuild),
    testBuildBefore,
    prodBuildBefore,
    prodBuildAfter,
    testBuildAfter: testBuildBefore
  };
}

async function readDeploymentSnapshots() {
  const [testManifest, prodManifest] = await Promise.all([
    fetchBuildManifest(TEST_HOST, 'test'),
    fetchBuildManifest(PROD_HOST, 'production')
  ]);
  return { test: testManifest, prod: prodManifest };
}

module.exports = {
  PROJECT_ID,
  TEST_SITE,
  PROD_SITE,
  TEST_HOST,
  PROD_HOST,
  readDeploymentSnapshots,
  promoteTestLiveVersionToProduction,
  fetchBuildManifest,
  fetchProdBuildManifestStrict,
  evaluateDeploymentStatus,
  normalizeRawBuildManifest,
  getBuildNumber
};
