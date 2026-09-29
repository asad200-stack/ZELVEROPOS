const { execSync } = require('child_process');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function ensureUtf8Module(relativePath) {
  const full = path.join(ROOT, relativePath);
  if (!fs.existsSync(full)) return;
  const buf = fs.readFileSync(full);
  if (buf.length >= 2 && buf[1] === 0x00) {
    let text = fs.readFileSync(full, 'utf16le');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    fs.writeFileSync(full, text, 'utf8');
    console.log(`Normalized UTF-8 encoding for ${relativePath}`);
  }
}

const TARGET = process.argv[2] || 'test';
const ALLOWED_TARGETS = ['test', 'prod'];

if (!ALLOWED_TARGETS.includes(TARGET)) {
  console.error(`Usage: node scripts/deploy.js <${ALLOWED_TARGETS.join('|')}>`);
  process.exit(1);
}

const IS_PROD = TARGET === 'prod';

function run(command) {
  console.log(`\n> ${command}`);
  execSync(command, { stdio: 'inherit' });
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function main() {
  if (IS_PROD) {
    console.warn('\n========================================');
    console.warn('PRODUCTION DEPLOYMENT REQUESTED');
    console.warn('By policy, all changes must be validated');
    console.warn('on the TEST environment first.');
    console.warn('========================================\n');

    const answer = await ask('Type "deploy-to-production" to confirm: ');
    if (answer !== 'deploy-to-production') {
      console.log('Production deployment cancelled.');
      process.exit(0);
    }

    const second = await ask('Are you sure? This affects all users (yes/no): ');
    if (second !== 'yes') {
      console.log('Production deployment cancelled.');
      process.exit(0);
    }
  } else {
    console.log('\n========================================');
    console.log('DEPLOYING TO TEST ENVIRONMENT');
    console.log('This will NOT affect production users.');
    console.log('========================================\n');
  }

  // Sync build manifest + bump asset cache-bust versions before hosting deploy.
  ensureUtf8Module('functions/hosting-promote.js');
  ensureUtf8Module('package.json');
  run('node scripts/ensure-public-utf8.js');
  run(`node scripts/ensure-utf8.js functions/hosting-promote.js`);
  run(`node scripts/sync-build-manifest.js ${TARGET} --bump`);

  // Deploy hosting to the selected target.
  run(`firebase deploy --only hosting:${TARGET}`);

  console.log(`\nHosting deployed to ${TARGET}.`);
  if (!IS_PROD) {
    console.log('Backend (Functions/Firestore) is shared with production.');
    console.log('Run "npm run deploy:backend" only when you intend to update shared backend services.');
  }
}

main().catch((err) => {
  console.error('Deployment failed:', err && err.message ? err.message : err);
  process.exit(1);
});
