/**
 * Costruisce il dataset di addestramento per la rete dei toni.
 *
 * Fonte frasi: Tatoeba cinese (CC-BY) — /tmp/opencode/cmn.tsv
 * Dizionario: CC-CEDICT (trad+sem -> pinyin con toni)
 * Segmentazione: longest-match sul dizionario
 *
 * Output: ml/data/tone-data.json
 *   { vocab: [...bare syllables], N: finestra, train: {X,y}, val: {X,y} }
 *   X = [ [indice_sillaba...] (2N+1) ], y = classe tono (0=neutro,1-4)
 */
const fs = require('fs');
const path = require('path');

const PROJECT = path.resolve(__dirname, '..');
const CEDICT = '/tmp/opencode/cedict';
const TATOEBA = '/tmp/opencode/cmn.tsv';
const SYL_FILE = path.join(PROJECT, 'src/data/pinyin-syllables.json');

const N = 5;                     // finestra ±N
const CAP = 200000;              // esempi massimi
const VAL_FRAC = 0.1;

// ---------- 1. vocabolario sillabe ----------
const sylData = JSON.parse(fs.readFileSync(SYL_FILE, 'utf8'));
const syllables = [...sylData.syllables].sort();
const vocab = ['<pad>', ...syllables];
const idx = new Map(vocab.map((s, i) => [s, i]));

// ---------- 2. CC-CEDICT: hanzi (trad+sem) -> pinyin_numbers ----------
function normNumbers(s) {
  return s.toLowerCase().replace(/u:/g, 'ü');
}
function buildDict() {
  const dict = new Map();
  const lines = fs.readFileSync(CEDICT, 'utf8').split('\n');
  for (const l of lines) {
    const line = l.replace(/\r$/, '');
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.*)\/$/);
    if (!m) continue;
    const [, trad, simp, pinyin] = m;
    const pn = normNumbers(pinyin);
    for (const key of [simp, trad]) {
      if (!dict.has(key)) dict.set(key, pn);
    }
  }
  return dict;
}

// ---------- 3. segmentazione longest-match ----------
function makeSegmenter(dict) {
  const words = [...dict.keys()];
  let maxLen = 0;
  for (const w of words) if (w.length > maxLen) maxLen = w.length;
  const set = new Set(words);
  return function segment(text) {
    const segs = []; // [{word, pinyin_numbers}]
    let i = 0;
    const L = text.length;
    while (i < L) {
      let len = Math.min(maxLen, L - i);
      let found = null;
      while (len >= 1) {
        const w = text.slice(i, i + len);
        if (set.has(w)) { found = w; break; }
        len--;
      }
      if (found) {
        segs.push({ word: found, pinyin_numbers: dict.get(found) });
        i += found.length;
      } else {
        i++; // char sconosciuto = confine
      }
    }
    return segs;
  };
}

// ---------- 4. sillabe da un pinyin_numbers ----------
function syllablesOf(pn) {
  const out = [];
  for (const seg of pn.split(/\s+/).filter(Boolean)) {
    const m = seg.match(/^([a-zü]+)([0-5])$/);
    if (!m) continue;
    const bare = m[1];
    const tone = m[2] === '0' || m[2] === '5' ? 0 : Number(m[2]);
    if (idx.has(bare)) out.push({ bare, tone });
    else out.push({ bare: null, tone: -1 }); // sillaba fuori vocabolo
  }
  return out;
}

// ---------- 5. generazione esempi ----------
function windowsFromSegments(segments) {
  // appiattisci in lista di {idx, tone} con PAD ai confini
  const flat = [];
  for (const seg of segments) {
    const syls = syllablesOf(seg.pinyin_numbers);
    for (const s of syls) {
      flat.push({ idx: s.bare == null ? -1 : idx.get(s.bare), tone: s.tone });
    }
    flat.push(null); // separatore tra parole (contesto locale, no crossing)
  }
  // rimuovi il separatore finale
  if (flat.length && flat[flat.length - 1] === null) flat.pop();

  const ex = [];
  for (let p = 0; p < flat.length; p++) {
    const c = flat[p];
    if (c === null || c.idx < 0 || c.tone < 0) continue;
    const window = [];
    for (let k = -N; k <= N; k++) {
      const q = flat[p + k];
      window.push(q === null || q === undefined || q.idx < 0 ? 0 : q.idx);
    }
    ex.push({ X: window, y: c.tone });
  }
  return ex;
}

// ---------- main ----------
console.log('vocabolario sillabe:', vocab.length - 1);

const dict = buildDict();
console.log('dizionario CEDICT:', dict.size, 'parole');

const segment = makeSegmenter(dict);

const all = [];

// 6a. HSK parole come segmenti brevi
const HSK = JSON.parse(fs.readFileSync(path.join(PROJECT, 'src/data/hsk-3.0.json'), 'utf8')).words;
let hskEx = 0;
for (const w of HSK) {
  const pn = dict.get(w.word);
  if (!pn) continue;
  const segs = [{ word: w.word, pinyin_numbers: pn }];
  const ex = windowsFromSegments(segs);
  hskEx += ex.length;
  all.push(...ex);
}
console.log('esempi da HSK:', hskEx);

// 6b. Tatoeba frasi
const tato = fs.readFileSync(TATOEBA, 'utf8').split('\n').filter((l) => l.trim());
let tatoEx = 0;
for (const line of tato) {
  const parts = line.split('\t');
  if (parts.length < 3) continue;
  const text = parts[2];
  // spezza su caratteri non-CJK (i segmenti isolano il contesto)
  const chunks = text.split(/[^\u3400-\u9fff]+/).filter((c) => c.length > 0);
  for (const ch of chunks) {
    const segs = segment(ch);
    if (!segs.length) continue;
    const ex = windowsFromSegments(segs);
    tatoEx += ex.length;
    all.push(...ex);
  }
  if (all.length >= CAP) break;
}
console.log('esempi da Tatoeba:', tatoEx);
console.log('totale esempi:', all.length);

// mescola e split
for (let i = all.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [all[i], all[j]] = [all[j], all[i]];
}
const nVal = Math.floor(all.length * VAL_FRAC);
const val = all.slice(0, nVal);
const train = all.slice(nVal);

const toJson = (arr) => ({ X: arr.map((e) => e.X), y: arr.map((e) => e.y) });

const out = {
  N,
  vocab,
  train: toJson(train),
  val: toJson(val),
};
const outPath = path.join(PROJECT, 'ml/data/tone-data.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out));

console.log('scritto', path.relative(PROJECT, outPath));
console.log('train:', train.length, '| val:', val.length);
console.log('dimensione:', (fs.statSync(outPath).size / 1e6).toFixed(1), 'MB');

// distribuzione toni
const dist = [0, 0, 0, 0, 0];
for (const e of train) dist[e.y]++;
console.log('distribuzione toni (neutro,1,2,3,4):', dist.join(','));
