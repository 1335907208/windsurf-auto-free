const fs = require('fs');
const path = require('path');
const cp = require('child_process');

function run(cmd, args) {
  const r = cp.spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    process.exit(r.status || 1);
  }
}

const lang = process.argv[2];
if (lang !== 'en' && lang !== 'zh') {
  console.error('Usage: node scripts/build.js <en|zh>');
  process.exit(1);
}

const root = path.join(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const pkgBackup = fs.readFileSync(pkgPath, 'utf8');

try {
  const langPkgPath = path.join(root, `package.${lang}.json`);
  if (!fs.existsSync(langPkgPath)) {
    console.error(`Missing ${path.basename(langPkgPath)}. Create it first.`);
    process.exit(1);
  }

  fs.copyFileSync(langPkgPath, pkgPath);

  if (lang === 'zh') {
    run('npx', ['tsc', '-p', './']);
  } else {
    run('npx', [
      'tsc',
      'src/extension_en.ts',
      '--module', 'commonjs',
      '--target', 'ES2020',
      '--outDir', 'dist',
      '--rootDir', 'src',
      '--sourceMap',
      '--strict',
      '--esModuleInterop',
      '--skipLibCheck'
    ]);

    const dist = path.join(root, 'dist');
    fs.copyFileSync(path.join(dist, 'extension_en.js'), path.join(dist, 'extension.js'));
    const mapSrc = path.join(dist, 'extension_en.js.map');
    if (fs.existsSync(mapSrc)) {
      fs.copyFileSync(mapSrc, path.join(dist, 'extension.js.map'));
    }
  }
} finally {
  fs.writeFileSync(pkgPath, pkgBackup, 'utf8');
}
