/**
 * Script di packaging per il Chrome Web Store.
 * Crea dist/pinyin-corrector-<version>.zip con i contenuti di src/
 * (manifest alla radice), escludendo elementi non necessari.
 */
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'src');
const version = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8')).version;
const outDir = path.join(root, 'dist');
const out = path.join(outDir, 'pinyin-corrector-' + version + '.zip');
const tmp = path.join(outDir, 'pkg');

fs.rmSync(tmp, { recursive: true, force: true });
fs.rmSync(out, { force: true });
fs.mkdirSync(tmp, { recursive: true });

execSync('cp -r "' + src + '/." "' + tmp + '/"', { stdio: 'inherit' });

// esclusioni di sicurezza (se presenti dentro src/)
for (const ex of ['tests', 'scripts', 'ml', '.git', 'README', '*.md']) {
  const p = path.join(tmp, ex);
  try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) { /* ignora */ }
}

execSync('cd "' + tmp + '" && zip -r "' + out + '" . -x "*/.DS_Store"', { stdio: 'inherit' });
fs.rmSync(tmp, { recursive: true, force: true });

const size = fs.statSync(out).size;
console.log('Pacchetto creato:', path.relative(root, out), '(' + Math.round(size / 1024) + ' KB)');
