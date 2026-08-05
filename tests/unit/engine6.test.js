const { describe, it } = require('node:test');
const assert = require('node:assert');

const P = require('../../src/utils/pinyin-utils.js');
const L = require('../../src/utils/levenshtein.js');
const TN = require('../../src/llm/tone-net.js');

globalThis.PinynUtils = P;
globalThis.PinynLevenshtein = L;
require('../../src/utils/correction-engine.js');
const PinynCorrectionEngine = globalThis.PinynCorrectionEngine;

const fs = require('node:fs');
const SYL = new Set(JSON.parse(fs.readFileSync('src/data/pinyin-syllables.json', 'utf8')).syllables);
const HSK = JSON.parse(fs.readFileSync('src/data/hsk-3.0.json', 'utf8')).words;

let model = null;
try {
  model = TN.build(JSON.parse(fs.readFileSync('src/data/tone-net.json', 'utf8')));
} catch (_) { model = null; }

describe('tone-net — modello', () => {
  it('modello presente e caricato', () => {
    assert.ok(model, 'tone-net.json mancante/corrotto');
  });
  it('pesi dequantizzati come Float32Array', () => {
    assert.ok(model.E instanceof Float32Array);
    assert.ok(model.W1 instanceof Float32Array);
    assert.ok(model.b1 instanceof Float32Array);
  });
  it('predictTones lunghezza corretta', () => {
    const t = TN.predictTones(model, ['wo', 'qu', 'shang', 'hai']);
    assert.strictEqual(t.length, 4);
    t.forEach((v) => assert.ok(v >= 0 && v <= 4));
  });
  it('frase nota: wo qu shang hai -> 3 4 4 3', () => {
    const t = TN.predictTones(model, ['wo', 'qu', 'shang', 'hai']);
    assert.deepStrictEqual(Array.from(t), [3, 4, 4, 3], String(t));
  });
});

describe('tone-net — integrazione accenti (ibrido)', () => {
  const eng = PinynCorrectionEngine.createEngine({ syllables: SYL, hskWords: HSK, hskLevel: 9 });
  const engNet = PinynCorrectionEngine.createEngine({ syllables: SYL, hskWords: HSK, hskLevel: 9 });
  engNet.setTonePredictor((bares) => TN.predictTones(model, bares));

  it('senza predictor resta l\'euristica', () => {
    const r = eng.accentRun(['wo', 'qu', 'shang', 'hai']).map((s) => s.text).join(' ');
    assert.ok(/^wǒ/.test(r), r);
  });
  it('con predictor accentua i toni contestuali', () => {
    const r = engNet.accentRun(['wo', 'qu', 'shang', 'hai']).map((s) => s.text).join(' ');
    assert.strictEqual(r, 'wǒ qù shànghǎi', r); // 上海 è una parola (unita)
  });
  it('accentChoice: tono e share validi', () => {
    const c = eng.accentChoice('wo');
    assert.ok(c.tone >= 0 && c.tone <= 4);
    assert.ok(c.share > 0 && c.share <= 1);
  });
  it('toneVariants: he offre hé E hē', () => {
    const v = eng.toneVariants('he');
    assert.ok(v.includes('hé'), JSON.stringify(v));
    assert.ok(v.includes('hē'), JSON.stringify(v));
  });
  it('toneVariants: wo -> wǒ, wò', () => {
    const v = eng.toneVariants('wo');
    assert.deepStrictEqual(v.slice(0, 2), ['wǒ', 'wò'], JSON.stringify(v));
  });
  it('predictor non rompe le parole non pinyin', () => {
    const r = engNet.accentRun(['hello', 'world']).map((s) => s.text).join(' ');
    assert.strictEqual(r, 'hello world', r);
  });
});
