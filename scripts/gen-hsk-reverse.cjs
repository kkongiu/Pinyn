/**
 * Genera src/data/hsk-reverse.js: mappa inversa (parola inglese -> pinyin)
 * costruita dalle DEFINIZIONI COMPLETE (non dal singolo gloss pulito).
 *
 *   window.__PINYN_REVERSE = { <token inglese>: [<bare pinyin>...], ... }
 *
 * Copre i verbi (want, have, get...) che il gloss singolo perde.
 */
const fs = require('fs');
const path = require('path');

const PROJECT = path.resolve(__dirname, '..');
const HSK = JSON.parse(fs.readFileSync(path.join(PROJECT, 'src/data/hsk-3.0.json'), 'utf8')).words;

const strip = (n) => n.toLowerCase().replace(/v/g, 'ü').replace(/[0-5]/g, '').replace(/\s+/g, '');

const map = new Map(); // token -> Map(bare -> level)
const bareLevel = new Map();
for (const w of HSK) {
  if (!w.pinyin_numbers) continue;
  const bare = strip(w.pinyin_numbers);
  if (!bare) continue;
  if (!bareLevel.has(bare)) bareLevel.set(bare, w.level || 9);
  for (const d of (w.definitions || [])) {
    const clean = d.replace(/\[[^\]]*\]/g, ' ').replace(/[（(][^）)]*[）)]/g, ' ').toLowerCase();
    for (const tk of clean.split(/[^a-z]+/).filter((t) => t.length >= 1)) {
      if (!map.has(tk)) map.set(tk, new Map());
      map.get(tk).set(bare, w.level || 9);
    }
  }
}

const out = {};
for (const [tk, bareLvl] of map) {
  out[tk] = [...bareLvl.entries()]
    .sort((a, b) => (a[1] || 9) - (b[1] || 9) || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([b]) => b);
}

const js =
  '/* autogen: reverse dizionario (parola inglese -> pinyin). ' +
  Object.keys(out).length + ' token. */\n' +
  'window.__PINYN_REVERSE = ' + JSON.stringify(out) + ';\n';

const dst = path.join(PROJECT, 'src/data/hsk-reverse.js');
fs.writeFileSync(dst, js);
console.log('token:', Object.keys(out).length, '| size:', (fs.statSync(dst).size / 1e3).toFixed(0) + ' KB');
console.log('want ->', out.want);
console.log('have ->', out.have);
console.log('water ->', out.water);
