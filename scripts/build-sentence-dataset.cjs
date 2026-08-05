/**
 * Costruisce il dataset per il LM di frasi (verifica forma).
 * Segmenta le frasi Tatoeba in PAROLE pinyin (longest-match su CEDICT),
 * costruisce il vocabolario delle N parole più frequenti e salva le
 * sequenze di indici.
 *
 * Output: ml/data/sentence-data.json
 *   { vocab: [...parole], seqs: [[idx...]], valSeqs: [[idx...]] }
 */
const fs = require('fs');
const path = require('path');

const PROJECT = path.resolve(__dirname, '..');
const CEDICT = '/tmp/opencode/cedict';
const TATOEBA = '/tmp/opencode/cmn.tsv';

const VOCAB_SIZE = 4000;
const MAX_LEN = 20;
const VAL_FRAC = 0.05;

function loadDict() {
  const dict = new Map();
  const lines = fs.readFileSync(CEDICT, 'utf8').split('\n');
  for (const l of lines) {
    const line = l.replace(/\r$/, '');
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.*)\/$/);
    if (!m) continue;
    for (const k of [m[1], m[2]]) if (!dict.has(k)) dict.set(k, m[3].toLowerCase().replace(/u:/g, 'ü'));
  }
  return dict;
}

const dict = loadDict();
const wordSet = new Set(dict.keys());
let maxLen = 0;
for (const w of wordSet) if (w.length > maxLen) maxLen = w.length;

function segment(text) {
  const segs = [];
  let i = 0;
  while (i < text.length) {
    let len = Math.min(maxLen, text.length - i);
    let found = null;
    while (len >= 1) {
      if (wordSet.has(text.slice(i, i + len))) { found = text.slice(i, i + len); break; }
      len--;
    }
    if (found) { segs.push(dict.get(found)); i += found.length; }
    else i++;
  }
  return segs;
}

// pinyin bare compatto di una parola
function bareOf(pn) {
  return pn.toLowerCase().replace(/v/g, 'ü').replace(/[0-5]/g, '').replace(/\s+/g, '');
}

const seqs = [];
const freq = new Map();
const tato = fs.readFileSync(TATOEBA, 'utf8').split('\n').filter((l) => l.trim());
for (const line of tato) {
  const t = line.split('\t')[2];
  if (!t) continue;
  const chunks = t.split(/[^\u3400-\u9fff]+/).filter((c) => c.length > 0);
  for (const ch of chunks) {
    const segs = segment(ch);
    if (!segs.length) continue;
    const words = segs.map(bareOf).filter(Boolean);
    if (words.length < 2 || words.length > MAX_LEN) continue;
    seqs.push(words);
    for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
  }
}

// vocabolario top-N
const vocab = ['<pad>', '<unk>', ...[...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, VOCAB_SIZE).map(([w]) => w)];
const w2i = new Map(vocab.map((w, i) => [w, i]));
const toIdx = (w) => (w2i.has(w) ? w2i.get(w) : 1); // 1 = <unk>

const allIdx = seqs.map((s) => s.map(toIdx));

// mescola e split
for (let i = allIdx.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [allIdx[i], allIdx[j]] = [allIdx[j], allIdx[i]];
}
const nVal = Math.floor(allIdx.length * VAL_FRAC);
const out = {
  vocab,
  seqs: allIdx.slice(nVal),
  valSeqs: allIdx.slice(0, nVal),
};

const dst = path.join(PROJECT, 'ml/data/sentence-data.json');
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.writeFileSync(dst, JSON.stringify(out));

console.log('frasi:', allIdx.length, '| vocab:', vocab.length);
console.log('train seqs:', out.seqs.length, '| val:', out.valSeqs.length);
console.log('size:', (fs.statSync(dst).size / 1e6).toFixed(1), 'MB');
console.log('parole top:', vocab.slice(2, 8));
