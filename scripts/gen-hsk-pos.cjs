/**
 * Genera src/data/hsk-pos.js: mappa hanzi -> POS (per le regole grammaticali).
 * Solo POS "puliti" (tag singoli); i multi-tag (V/N) restano per compatibilità
 * ma le regole li tratteranno come ambigui.
 *
 *   window.__PINYN_POS = { <hanzi>: "<POS>", ... }
 */
const fs = require('fs');
const path = require('path');

const PROJECT = path.resolve(__dirname, '..');
const HSK = JSON.parse(fs.readFileSync(path.join(PROJECT, 'src/data/hsk-3.0.json'), 'utf8')).words;

const map = {};
for (const w of HSK) {
  const pos = (w.pos || '').trim();
  if (!pos) continue;
  if (!(w.word in map)) map[w.word] = pos;
}

const js =
  '/* autogen: POS per le regole grammaticali (vedi scripts/gen-hsk-pos.cjs). ' +
  Object.keys(map).length + ' voci. */\n' +
  'window.__PINYN_POS = ' + JSON.stringify(map) + ';\n';

const dst = path.join(PROJECT, 'src/data/hsk-pos.js');
fs.writeFileSync(dst, js);
console.log('voci:', Object.keys(map).length, '| size:', (fs.statSync(dst).size / 1e3).toFixed(0) + ' KB');
console.log('esempi:', JSON.stringify({ 很: map.很, 学生: map.学生, 是: map.是, 吗: map.吗, 去: map.去, 我: map.我 }));
