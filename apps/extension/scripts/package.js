const fs = require('fs');
const path = require('path');
const cp = require('child_process');

function run(cmd, args, cwd) {
  console.log(`Running: ${cmd} ${args.join(' ')}`);
  const r = cp.spawnSync(cmd, args, {
    cwd: cwd || process.cwd(),
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  if (r.status !== 0) {
    console.error(`Command failed with exit code ${r.status}`);
    process.exit(r.status || 1);
  }
}

const lang = process.argv[2];
const outFile = process.argv[3];
if (lang !== 'en' && lang !== 'zh') {
  console.error('Usage: node scripts/package.js <en|zh> <output.vsix>');
  process.exit(1);
}
if (!outFile) {
  console.error('Missing output filename. Example: ide-toolkit-en.vsix');
  process.exit(1);
}

console.log(`\n=== Packaging ${lang.toUpperCase()} version: ${outFile} ===\n`);

const root = path.join(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const pkgBackup = fs.readFileSync(pkgPath, 'utf8');

try {
  const langPkgPath = path.join(root, `package.${lang}.json`);
  if (!fs.existsSync(langPkgPath)) {
    console.error(`Missing ${path.basename(langPkgPath)}. Create it first.`);
    process.exit(1);
  }

  console.log(`1. Copying package.${lang}.json -> package.json`);
  fs.copyFileSync(langPkgPath, pkgPath);

  if (lang === 'zh') {
    console.log(`2. Compiling Chinese version...`);
    run('npx', ['tsc', '-p', './'], root);
  } else {
    console.log(`2. Compiling English version...`);
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
    ], root);

    const dist = path.join(root, 'dist');
    const enJs = path.join(dist, 'extension_en.js');
    const outJs = path.join(dist, 'extension.js');

    if (!fs.existsSync(enJs)) {
      console.error(`ERROR: ${enJs} not found! Compilation may have failed.`);
      process.exit(1);
    }

    console.log(`3. Copying extension_en.js -> extension.js`);
    fs.copyFileSync(enJs, outJs);

    const mapSrc = path.join(dist, 'extension_en.js.map');
    if (fs.existsSync(mapSrc)) {
      fs.copyFileSync(mapSrc, path.join(dist, 'extension.js.map'));
    }
  }

  console.log(`4. Packaging VSIX...`);
  run('npx', ['vsce', 'package', '-o', outFile], root);
  console.log(`\n=== Done! Created: ${outFile} ===\n`);
} finally {
  console.log(`5. Restoring original package.json`);
  fs.writeFileSync(pkgPath, pkgBackup, 'utf8');
}
