/**
 * Genera src/data/hsk-defs.js: mappa compatta per il lookup delle traduzioni
 * nel content script.
 *
 *   window.__PINYN_DEFS = { <pinyin compatto senza toni>: "hanzi|gloss", ... }
 *
 * Per ogni pinyin compatto si tiene la parola PIÙ COMUNE (livello più basso,
 * poi rank). Il gloss è "pulito": si scartano CL:, variant of, old variant.
 */
const fs = require('fs');
const path = require('path');

const PROJECT = path.resolve(__dirname, '..');
const HSK = JSON.parse(fs.readFileSync(path.join(PROJECT, 'src/data/hsk-3.0.json'), 'utf8')).words;

function stripTones(numbers) {
  return numbers.toLowerCase().replace(/v/g, 'ü').replace(/[0-5]/g, '').replace(/\s+/g, '');
}

// gloss "pulito": preferisce la voce più corta e senza marcatori tecnici
function cleanGloss(defs) {
  const bad = /^(CL:|.*(variant of|old variant|erhua form|also pr|dialect|surname|bound form|as in)).*$/i;
  const candidates = defs
    .filter((d) => !bad.test(d))
    .sort((a, b) => a.length - b.length);
  return candidates[0] || defs[0] || '';
}

const byBare = new Map();
for (const w of HSK) {
  if (!w.pinyin_numbers) continue;
  const bare = stripTones(w.pinyin_numbers);
  if (!bare) continue;
  const gloss = cleanGloss(w.definitions || []);
  const cur = byBare.get(bare);
  if (!cur || w.level < cur.level || (w.level === cur.level && (w.rank || 1e9) < (cur.rank || 1e9))) {
    byBare.set(bare, { word: w.word, gloss, level: w.level, rank: w.rank || 1e9 });
  }
}

const out = {};
for (const [bare, v] of byBare) {
  out[bare] = v.word + '|' + v.gloss;
}

const js =
  '/* autogen: traduzioni per lookup (vedi scripts/gen-hsk-defs.cjs). ' +
  byBare.size + ' voci. */\n' +
  'window.__PINYN_DEFS = ' + JSON.stringify(out) + ';\n';

const dst = path.join(PROJECT, 'src/data/hsk-defs.js');
fs.writeFileSync(dst, js);

console.log('voci:', byBare.size);
console.log('scritto', path.relative(PROJECT, dst), '(' + (fs.statSync(dst).size / 1e3).toFixed(0) + ' KB)');
console.log('esempi:', JSON.stringify({ kafei: out.kafei, wo: out.wo, he: out.he, zhongguo: out.zhongguo, xihuan: out.xihuan }));
