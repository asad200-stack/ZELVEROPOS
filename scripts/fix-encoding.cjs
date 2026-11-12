// Converts UTF-16LE (no BOM) / UTF-16 BOM files to UTF-8 (no BOM). Usage: node scripts/fix-encoding.cjs [dir...]
// A repo-wide run (predev/prebuild, root ".") does not scan the marketing app or the cinematic workspace.
// Passing one of those directories explicitly still scans it.
const fs = require('fs');
const path = require('path');
const SKIP = new Set(['node_modules', '.git', 'dist', 'legacy', 'lib', 'coverage', '.firebase']);
const SKIP_REL = new Set(['apps/marketing', 'docs/awakening'].map((p) => path.normalize(p)));
const EXT = /\.(ts|tsx|js|mjs|cjs|json|css|html|md|rules|txt|yml|yaml|svg|example|gitignore|firebaserc)$|^\.env/;
let fixed = 0;
function looksUtf16le(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return true;
  if (buf.length < 4) return false;
  let zeros = 0, pairs = Math.min(buf.length >> 1, 2000);
  for (let i = 0; i < pairs; i++) if (buf[i * 2 + 1] === 0) zeros++;
  return zeros / pairs > 0.3;
}
function walk(p, root) {
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    if (SKIP.has(path.basename(p))) return;
    const rel = path.relative(root, p);
    if (rel && SKIP_REL.has(path.normalize(rel))) return;
    for (const f of fs.readdirSync(p)) walk(path.join(p, f), root);
    return;
  }
  if (!EXT.test(path.basename(p))) return;
  const buf = fs.readFileSync(p);
  if (!looksUtf16le(buf)) {
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) { fs.writeFileSync(p, buf.subarray(3)); fixed++; }
    return;
  }
  let text = buf.toString('utf16le');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  fs.writeFileSync(p, text, 'utf8');
  fixed++;
}
const roots = process.argv.slice(2);
(roots.length ? roots : ['.']).forEach((r) => {
  if (!fs.existsSync(r)) return;
  const root = path.resolve(r);
  walk(root, root);
});
if (fixed) console.log('fix-encoding: converted ' + fixed + ' file(s) to UTF-8');