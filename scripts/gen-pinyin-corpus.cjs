/**
 * Genera tests/fixtures/pinyin-levels.txt dal vocabolario HSK.
 * Ogni sezione (# HSK Livello N) contiene una riga per parola:
 *   <pinyin accentato>\t<hanzi>
 * Serve all'autotest per verificare dove il detector comincia a fallire.
 */
const fs = require('fs');
const path = require('path');

const PROJECT = path.resolve(__dirname, '..');
const HSK = JSON.parse(fs.readFileSync(path.join(PROJECT, 'src/data/hsk-3.0.json'), 'utf8')).words;

const levelLabel = (l) => (l === 7.5 ? '7-9' : String(l));

const byLevel = new Map();
for (const w of HSK) {
  if (!w.pinyin) continue;
  // solo parole "pulite": hanzi (CJK) esclusivamente, niente template/varianti
  if (!/^[\u3400-\u9fff]+$/.test(w.word)) continue;
  const l = levelLabel(w.level);
  if (!byLevel.has(l)) byLevel.set(l, []);
  byLevel.get(l).push(w);
}

const order = ['1', '2', '3', '4', '5', '6', '7-9'].filter((l) => byLevel.has(l));

const lines = [];
lines.push('# Corpus pinyin per livello HSK — usato dall\'autotest');
lines.push('# Formato: <pinyin accentato>\t<hanzi>');
lines.push('# Ogni sezione corrisponde a un livello HSK.');
lines.push('');
for (const l of order) {
  lines.push('# HSK Livello ' + l);
  const words = byLevel.get(l).sort((a, b) => a.word.localeCompare(b.word));
  for (const w of words) {
    lines.push(w.pinyin + '\t' + w.word);
  }
  lines.push('');
}

const out = path.join(PROJECT, 'tests/fixtures/pinyin-levels.txt');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, lines.join('\n') + '\n');

console.log('Corpus scritto in', path.relative(PROJECT, out));
console.log('Righe:', lines.length - 2);
for (const l of order) {
  console.log('  Livello ' + l + ': ' + byLevel.get(l).length + ' parole');
}
