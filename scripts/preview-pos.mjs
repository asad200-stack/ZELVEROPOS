import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const root = join(import.meta.dirname, '..');
const tile = readFileSync(join(root, 'src/features/pos/ProductTile.tsx'), 'utf8');
if (!tile.includes('data-pos-ui={POS_UI_ID}')) {
  console.error('Canonical product tile marker is missing.');
  process.exit(1);
}
const hits = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walk(path);
    } else if (name.endsWith('.tsx') && readFileSync(path, 'utf8').includes('className="product-tile"')) {
      hits.push(path.slice(root.length + 1));
    }
  }
}
walk(join(root, 'src'));
if (hits.length !== 1 || !hits[0].endsWith('ProductTile.tsx')) {
  console.error('Expected exactly one product-tile implementation.', hits);
  process.exit(1);
}
console.log('POS UI canonical. Starting preview at http://127.0.0.1:5310/preview/pos');
const child = spawn('npx', ['vite', '--mode', 'preview', '--host', '127.0.0.1', '--port', '5310', '--strictPort'], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
});
child.on('exit', (code) => process.exit(code ?? 1));
