const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const EXTENSIONS = new Set(['.js', '.json', '.css', '.html']);

function isUtf16(buf) {
  return (buf.length >= 2 && buf[1] === 0x00)
    || (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe);
}

function convertFileToUtf8(filePath) {
  const buf = fs.readFileSync(filePath);
  if (!isUtf16(buf)) return false;
  let text = fs.readFileSync(filePath, 'utf16le');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  fs.writeFileSync(filePath, text, 'utf8');
  return true;
}

function walk(dir, converted) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      walk(full, converted);
      continue;
    }
    const ext = path.extname(name).toLowerCase();
    if (!EXTENSIONS.has(ext)) continue;
    if (convertFileToUtf8(full)) {
      converted.push(path.relative(PUBLIC_DIR, full).replace(/\\/g, '/'));
    }
  }
}

function main() {
  const converted = [];
  walk(PUBLIC_DIR, converted);
  if (!converted.length) {
    console.log('All public assets are already UTF-8.');
    return;
  }
  console.log(`Converted ${converted.length} file(s) to UTF-8:`);
  converted.forEach((file) => console.log(`- ${file}`));
}

main();
