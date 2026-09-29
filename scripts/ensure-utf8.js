const fs = require('fs');
const path = require('path');

const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/ensure-utf8.js <file>');
  process.exit(1);
}

const full = path.resolve(target);
const buf = fs.readFileSync(full);
const isUtf16 = (buf.length >= 2 && buf[1] === 0x00)
  || (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe);
if (isUtf16) {
  let text = fs.readFileSync(full, 'utf16le');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  fs.writeFileSync(full, text, 'utf8');
  console.log(`Converted ${target} to UTF-8`);
} else {
  console.log(`${target} is already UTF-8`);
}
