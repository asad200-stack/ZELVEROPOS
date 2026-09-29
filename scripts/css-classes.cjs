// Lists CSS class names used in src (ts/tsx) that are not defined in src/styles/*.css.
const fs = require('fs');
const path = require('path');

const used = new Set();
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx|ts)$/.test(name) && !p.includes(`${path.sep}i18n${path.sep}`)) {
      const src = fs.readFileSync(p, 'utf8');
      for (const m of src.matchAll(/class(?:Name)?=\{?[`'"]([^`'"]+)[`'"]/g)) collect(m[1]);
      for (const m of src.matchAll(/className=\{([^}]+)\}/g)) for (const s of m[1].matchAll(/'([^']+)'/g)) collect(s[1]);
      for (const m of src.matchAll(/\[\s*'([a-z][\w-]*)'/g)) collect(m[1]);
    }
  }
}
function collect(str) {
  for (const c of str.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) if (/^[a-z][\w-]*$/.test(c)) used.add(c);
}
walk('src');

const defined = new Set();
const stylesDir = path.join('src', 'styles');
if (fs.existsSync(stylesDir)) {
  for (const f of fs.readdirSync(stylesDir)) {
    for (const m of fs.readFileSync(path.join(stylesDir, f), 'utf8').matchAll(/\.([a-zA-Z][\w-]*)/g)) defined.add(m[1]);
  }
}
const missing = [...used].filter((c) => !defined.has(c)).sort();
console.log(missing.join('\n'));
console.error(`${missing.length} undefined of ${used.size} used`);
