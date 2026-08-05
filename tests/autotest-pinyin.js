'use strict';
/**
 * Autotest sul corpus pinyin per livello HSK.
 *
 * Legge tests/fixtures/pinyin-levels.txt (una sezione per livello HSK) e
 * scansiona ogni parola col detector. Il corpus è PINYIN CORRETTO, quindi:
 *  - errori rossi (kind 'error') == 0  => il detector accetta tutto il pinyin corretto
 *  - sospetti gialli (kind 'tone') sono riportati per livello come diagnostica
 *    (letture corrette ma rare; crescono ai livelli avanzati).
 *
 * Esce con codice != 0 se ci sono errori rossi.
 */
const P = require('../src/utils/pinyin-utils.js');
const L = require('../src/utils/levenshtein.js');
globalThis.PinynUtils = P;
globalThis.PinynLevenshtein = L;
require('../src/utils/correction-engine.js');
require('../src/content/error-detector.js');

const fs = require('fs');
const path = require('path');

const sylData = JSON.parse(fs.readFileSync('src/data/pinyin-syllables.json', 'utf8'));
const SYL = new Set(sylData.syllables);
const HSK = JSON.parse(fs.readFileSync('src/data/hsk-3.0.json', 'utf8')).words;

const engine = globalThis.PinynCorrectionEngine.createEngine({ syllables: SYL, hskWords: HSK, hskLevel: 9 });
const det = globalThis.PinynErrorDetector.createDetector(SYL, { engine });

const corpusFile = path.join(__dirname, 'fixtures/pinyin-levels.txt');
const lines = fs.readFileSync(corpusFile, 'utf8').split('\n');

const sections = []; // {level, words:[{pinyin,hanzi,errors[],suspects[]}]}
let cur = null;
let wordsCount = 0;

for (const ln of lines) {
  const h = ln.match(/^# HSK Livello (.+)$/);
  if (h) {
    cur = { level: h[1], words: [] };
    sections.push(cur);
    continue;
  }
  if (!ln.trim() || ln.startsWith('#')) continue;
  const tab = ln.indexOf('\t');
  const pinyin = tab >= 0 ? ln.slice(0, tab) : ln;
  const hanzi = tab >= 0 ? ln.slice(tab + 1) : '';
  const res = det.scan(pinyin);
  cur.words.push({
    pinyin,
    hanzi,
    errors: res.filter((r) => r.kind === 'error'),
    suspects: res.filter((r) => r.kind === 'tone'),
  });
  wordsCount++;
}

let totalErrors = 0;
let totalSuspects = 0;

console.log('=== Autotest corpus pinyin per livello HSK ===');
console.log('File:', path.relative(process.cwd(), corpusFile), '(' + wordsCount + ' parole)');
console.log('');
console.log('Livello  | parole | errori(rossi) | sospetti(gialli)');
console.log('---------|--------|---------------|-----------------');
for (const s of sections) {
  const errs = s.words.reduce((a, w) => a + w.errors.length, 0);
  const sups = s.words.reduce((a, w) => a + w.suspects.length, 0);
  totalErrors += errs;
  totalSuspects += sups;
  const pad = (n) => String(n).padStart(6);
  console.log('  L' + String(s.level).padEnd(4) + ' |' + pad(s.words.length) + ' |' + pad(errs) + '        |' + pad(sups));
}

// esempi di errori (rossi)
const redExamples = [];
for (const s of sections) {
  for (const w of s.words) {
    for (const e of w.errors) {
      if (redExamples.length < 8) redExamples.push('L' + s.level + ' ' + w.hanzi + ' "' + w.pinyin + '" -> ' + e.token);
    }
  }
}

// primi sospetti per livello (diagnostica)
const suspExamples = [];
for (const s of sections) {
  let shown = 0;
  for (const w of s.words) {
    for (const e of w.suspects) {
      if (shown < 3) {
        suspExamples.push('L' + s.level + ' ' + w.hanzi + ' "' + w.pinyin + '" -> ' + e.token);
        shown++;
      }
    }
  }
}

console.log('');
console.log('TOTALE errori rossi: ' + totalErrors + ' | sospetti gialli: ' + totalSuspects);
if (redExamples.length) {
  console.log('');
  console.log('Esempi di errori rossi (da correggere):');
  redExamples.forEach((x) => console.log('  - ' + x));
}
if (suspExamples.length) {
  console.log('');
  console.log('Esempi di sospetti gialli (letture rare ma corrette):');
  suspExamples.forEach((x) => console.log('  - ' + x));
}

console.log('');
if (totalErrors === 0) {
  console.log('RISULTATO: OK — il detector accetta tutto il pinyin corretto del corpus.');
} else {
  console.log('RISULTATO: FALLITO — ' + totalErrors + ' parole corrette segnalate come errori.');
}
process.exit(totalErrors === 0 ? 0 : 1);
