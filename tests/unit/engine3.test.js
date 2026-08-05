const { describe, it } = require('node:test');
const assert = require('node:assert');

const P = require('../../src/utils/pinyin-utils.js');
const L = require('../../src/utils/levenshtein.js');

globalThis.PinynUtils = P;
globalThis.PinynLevenshtein = L;
require('../../src/content/error-detector.js');
require('../../src/utils/correction-engine.js');
const PinynErrorDetector = globalThis.PinynErrorDetector;
const PinynCorrectionEngine = globalThis.PinynCorrectionEngine;

const fs = require('node:fs');
const sylData = JSON.parse(fs.readFileSync('src/data/pinyin-syllables.json', 'utf8'));
const SYL = new Set(sylData.syllables);
const HSK = JSON.parse(fs.readFileSync('src/data/hsk-3.0.json', 'utf8')).words;

const createDetector = (opts) => PinynErrorDetector.createDetector(SYL, opts);

describe('dataset HSK completo', () => {
  it('contiene ~11k parole', () => {
    assert.ok(HSK.length > 10000, 'attese >10000, trovate ' + HSK.length);
  });
  it('ogni parola ha pinyin con toni', () => {
    const bad = HSK.filter((w) => !w.pinyin || !w.pinyin_numbers);
    assert.strictEqual(bad.length, 0);
  });
  it('livelli 1-6 e 7-9 presenti', () => {
    const levels = new Set(HSK.map((w) => w.level));
    assert.ok(levels.has(1) && levels.has(6) && levels.has(7.5));
  });
});

describe('segmentazione', () => {
  const engine = PinynCorrectionEngine.createEngine({ syllables: SYL, hskWords: HSK, hskLevel: 9 });
  it('nihao -> ni hao', () => {
    assert.deepStrictEqual(engine.segment('nihao'), ['ni', 'hao']);
  });
  it('zai jian senza spazio', () => {
    const seg = engine.segment('zaijian');
    assert.ok(seg && seg.join('') === 'zaijian');
    assert.ok(seg.includes('jian'));
  });
  it('stringa non segmentabile -> null', () => {
    assert.strictEqual(engine.segment('xzq'), null);
  });
  it('detector: suggerimento segmentato in testa', () => {
    const det = createDetector({ engine });
    const errs = det.scan('nihao hao').filter((r) => r.isError);
    assert.ok(errs.length >= 1);
    assert.strictEqual(errs[0].token, 'nihao');
    assert.strictEqual(errs[0].suggestions[0], 'ni hao');
  });
  it('match parola: zonguo -> zhōng guó', () => {
    const det = createDetector({ engine });
    const errs = det.scan('zonguo').filter((r) => r.isError);
    assert.ok(errs.length === 1);
    assert.ok(errs[0].suggestions.includes('zhōng guó'), JSON.stringify(errs[0].suggestions));
  });
  it('findWordSuggestions: zonguo avvicina 中国', () => {
    const sugg = engine.findWordSuggestions('zonguo', 2);
    assert.ok(sugg.includes('zhōng guó'), JSON.stringify(sugg));
  });
  it('supplemento: 你好 è nel dataset e suggerito per nihao', () => {
    assert.ok(HSK.some((w) => w.word === '你好'), '你好 assente');
    const sugg = engine.findWordSuggestions('nihao', 2);
    assert.strictEqual(sugg[0], 'nǐ hǎo', JSON.stringify(sugg));
  });
});

describe('accentazione automatica', () => {
  const engine = PinynCorrectionEngine.createEngine({ syllables: SYL, hskWords: HSK, hskLevel: 9 });

  it('frasi HSK accentuate: ni hao -> nǐ hǎo', () => {
    assert.deepStrictEqual(engine.addAccentsToPhrase(['ni', 'hao']), ['nǐ', 'hǎo']);
  });
  it('zai jian -> zài jiàn', () => {
    assert.deepStrictEqual(engine.addAccentsToPhrase(['zai', 'jian']), ['zài', 'jiàn']);
  });
  it('sillaba singola: xie -> xié (tono più frequente)', () => {
    assert.strictEqual(engine.accentSingle('xie'), 'xié');
  });
  it('parola non pinyin resta invariata', () => {
    assert.strictEqual(engine.accentSingle('hello'), 'hello');
    assert.deepStrictEqual(engine.addAccentsToPhrase(['hello', 'world']), ['hello', 'world']);
  });
  it('accentable: token validi senza accento', () => {
    const det = createDetector({ engine });
    const acc = det.accentable('ni hao');
    assert.ok(acc.length >= 2);
    assert.deepStrictEqual(acc.map((a) => a.accent), ['nǐ', 'hǎo']);
  });
  it('accentable ignora chi ha già numeri/accenti', () => {
    const det = createDetector({ engine });
    assert.strictEqual(det.accentable('ni3 nǐ').length, 0);
  });
});
