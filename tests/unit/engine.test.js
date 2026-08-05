const { describe, it } = require('node:test');
const assert = require('node:assert');

const P = require('../../src/utils/pinyin-utils.js');
const L = require('../../src/utils/levenshtein.js');

globalThis.PinynUtils = P;
globalThis.PinynLevenshtein = L;
require('../../src/content/error-detector.js');
const PinynErrorDetector = globalThis.PinynErrorDetector;

const fs = require('node:fs');
const data = JSON.parse(fs.readFileSync('src/data/pinyin-syllables.json', 'utf8'));
const createDetector = () => PinynErrorDetector.createDetector(new Set(data.syllables));

describe('pinyin-utils', () => {
  it('estrae tono da diacritico', () => {
    assert.deepStrictEqual(P.extractTone('nǐ'), { base: 'ni', tone: 3 });
  });
  it('estrae tono da numero', () => {
    assert.deepStrictEqual(P.extractTone('hao3'), { base: 'hao', tone: 3 });
  });
  it('aggiunge mark', () => {
    assert.strictEqual(P.addToneMark('ni', 3), 'nǐ');
  });
  it('converte tra formati', () => {
    assert.strictEqual(P.toToneNumber('nǐ'), 'ni3');
    assert.strictEqual(P.toToneMark('hao3'), 'hǎo');
  });
  it('tokenizza preservando testo non-latino', () => {
    const toks = P.tokenize('ciao ni hao! 你好');
    assert.strictEqual(toks.length, 6);
    assert.strictEqual(toks[0].text, 'ciao');
    assert.strictEqual(toks[0].isLatin, true);
    assert.strictEqual(toks[4].text, 'hao');
    assert.strictEqual(toks[5].isLatin, false);
  });
});

describe('levenshtein', () => {
  it('distanza base', () => {
    assert.strictEqual(L.distance('kitten', 'sitting'), 3);
  });
  it('swaps costo 1', () => {
    assert.strictEqual(L.distance('ao', 'oa'), 1);
    assert.strictEqual(L.distance('hkao', 'hao'), 1);
  });
});

describe('error-detector', () => {
  const det = createDetector();
  it('rileva token non pinyin', () => {
    const errs = det.scan('ni hkao').filter((r) => r.isError);
    assert.ok(errs.length >= 1);
    assert.strictEqual(errs[0].token, 'hkao');
  });
  it('accetta sillabe valide', () => {
    const res = det.scan('ni hao zhong guo');
    assert.strictEqual(res.filter((r) => r.isError).length, 0);
  });
  it('suggerisce correzioni per "haoz"', () => {
    const sugg = det.suggest('haoz', 1);
    assert.ok(sugg.includes('hao'));
  });
  it('"Ignora" esclude un token dai controlli', () => {
    const d = createDetector();
    assert.ok(d.scan('hkao').some((r) => r.isError));
    d.ignore('hkao');
    assert.strictEqual(d.scan('hkao').filter((r) => r.isError).length, 0);
  });
});
