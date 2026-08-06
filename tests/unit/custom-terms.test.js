const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

globalThis.PinynUtils = require('../../src/utils/pinyin-utils.js');
globalThis.PinynLevenshtein = require('../../src/utils/levenshtein.js');
require('../../src/utils/correction-engine.js');
const CE = globalThis.PinynCorrectionEngine;
globalThis.PinynCustomTerms = require('../../src/utils/custom-terms.js');
const CT = globalThis.PinynCustomTerms;

const syllableSet = new Set(JSON.parse(fs.readFileSync('src/data/pinyin-syllables.json', 'utf8')).syllables);
globalThis.__PINYN_HSK = JSON.parse(fs.readFileSync('src/data/hsk-3.0.json', 'utf8')).words.map((w) => ({ w: w.word, p: w.pinyin_numbers, l: w.level }));

describe('custom-terms — validazione', () => {
  it('termine valido', () => {
    const r = CT.validateTerm({ hanzi: '拉面', pinyin: 'la mian', gloss: 'noodles', en: 'lamian' }, syllableSet);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.value.hanzi, '拉面');
  });
  it('hanzi mancante -> errore', () => {
    const r = CT.validateTerm({ hanzi: '', pinyin: 'la mian' }, syllableSet);
    assert.strictEqual(r.ok, false);
  });
  it('pinyin con sillaba non valida -> errore', () => {
    const r = CT.validateTerm({ hanzi: '拉面', pinyin: 'la xxx' }, syllableSet);
    assert.strictEqual(r.ok, false);
  });
  it('pinyin con toni numerici/diacritici ok', () => {
    assert.strictEqual(CT.validateTerm({ hanzi: '水', pinyin: 'shui3' }, syllableSet).ok, true);
    assert.strictEqual(CT.validateTerm({ hanzi: '水', pinyin: 'shuǐ' }, syllableSet).ok, true);
  });
  it('pinyin compatto multi-sillaba segmentato (moka -> mo ka)', () => {
    const r = CT.validateTerm({ hanzi: '摩卡', pinyin: 'moka' }, syllableSet);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.value.pinyin, 'mo ka');
  });
  it('pinyin compatto accentato normalizzato spaziato (xǐhuān -> xǐ huān)', () => {
    const r = CT.validateTerm({ hanzi: '喜欢', pinyin: 'xǐhuān' }, syllableSet);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.value.pinyin, 'xǐ huān');
  });
  it('pinyin compatto non segmentabile -> errore (mok, xuexioa)', () => {
    assert.strictEqual(CT.validateTerm({ hanzi: '测试', pinyin: 'mok' }, syllableSet).ok, false);
    assert.strictEqual(CT.validateTerm({ hanzi: '测试', pinyin: 'xuexioa' }, syllableSet).ok, false);
  });
  it('hanzi non cjk -> errore', () => {
    const r = CT.validateTerm({ hanzi: 'abc', pinyin: 'a' }, syllableSet);
    assert.strictEqual(r.ok, false);
  });
  it('toHskEntry -> livello 0', () => {
    assert.deepStrictEqual(CT.toHskEntry({ hanzi: '拉面', pinyin: 'la mian' }), { w: '拉面', p: 'la mian', l: 0 });
  });
});

describe('custom-terms — integrazione engine', () => {
  it('setWords con termine custom: riconosciuto e accentato', () => {
    const base = [{ w: '水', p: 'shui3', l: 1 }];
    const engine = CE.createEngine({ syllables: syllableSet, hskWords: base, hskLevel: 3 });
    engine.setWords(base.concat([{ w: '拉面', p: 'la1 mian4', l: 0 }]));
    const seg = engine.accentRun(['la', 'mian']);
    assert.strictEqual(seg.length, 1);
    assert.strictEqual(seg[0].count, 2);
    assert.ok(seg[0].text.includes('ā') && seg[0].text.includes('miàn'), 'atteso lāmiàn, ottenuto ' + seg[0].text);
    // il pinyin del termine non viene segnalato come sospetto
    assert.strictEqual(engine.toneSuspect('mian', 4), false);
  });
  it('dataset: 喜欢 accentato xǐhuān (huan tono 1)', () => {
    const engine = CE.createEngine({ syllables: syllableSet, hskWords: globalThis.__PINYN_HSK, hskLevel: 3 });
    assert.deepStrictEqual(engine.accentRun(['xihuan'])[0].text, 'xǐhuān');
  });
});

describe('custom-terms — applicazione ai globali', () => {
  it('applyToGlobals: HSK sostituito, defs settati, reverse popolato', () => {
    globalThis.__PINYN_HSK = [{ w: '水', p: 'shui3', l: 1 }];
    globalThis.__PINYN_DEFS = { shui: '水|water' };
    globalThis.__PINYN_REVERSE = {};
    const restore = {};
    const base = globalThis.__PINYN_HSK.slice();
    const terms = [{ hanzi: '拉面', pinyin: 'la mian', gloss: 'noodles', en: 'lamian' }];
    CT.applyToGlobals(base, terms, restore);
    assert.strictEqual(globalThis.__PINYN_HSK.length, 2);
    assert.strictEqual(globalThis.__PINYN_HSK[1].w, '拉面');
    assert.strictEqual(globalThis.__PINYN_DEFS['lamian'], '拉面|noodles');
    assert.deepStrictEqual(globalThis.__PINYN_REVERSE['lamian'], ['lamian']);
  });

  it('pruneGlobals ripristina alla rimozione', () => {
    globalThis.__PINYN_HSK = [{ w: '水', p: 'shui3', l: 1 }];
    globalThis.__PINYN_DEFS = { shui: '水|water' };
    globalThis.__PINYN_REVERSE = {};
    const restore = {};
    const base = globalThis.__PINYN_HSK.slice();
    CT.applyToGlobals(base, [{ hanzi: '拉面', pinyin: 'la mian', gloss: 'noodles', en: 'lamian' }], restore);
    CT.pruneGlobals(base, [], restore);
    assert.strictEqual(globalThis.__PINYN_HSK.length, 1);
    assert.strictEqual(globalThis.__PINYN_DEFS['lamian'], undefined);
    assert.strictEqual(globalThis.__PINYN_REVERSE['lamian'], undefined);
  });

  it('applyToGlobals idempotente (niente accumuli)', () => {
    globalThis.__PINYN_HSK = [];
    globalThis.__PINYN_DEFS = {};
    globalThis.__PINYN_REVERSE = {};
    const restore = {};
    const terms = [{ hanzi: '拉面', pinyin: 'la mian', gloss: 'noodles' }];
    CT.applyToGlobals([], terms, restore);
    CT.applyToGlobals([], terms, restore);
    assert.strictEqual(globalThis.__PINYN_HSK.length, 1);
  });
});
