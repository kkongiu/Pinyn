const { describe, it } = require('node:test');
const assert = require('node:assert');

const D = require('../../src/utils/dict-search.js');
const fs = require('node:fs');
const HSK = JSON.parse(fs.readFileSync('src/data/hsk-3.0.json', 'utf8')).words;

const idx = D.buildIndex(HSK);
const words = (res) => res.map((r) => r.word);

describe('dict-search — dati', () => {
  it('quasi tutte le parole hanno una traduzione', () => {
    const withDefs = HSK.filter((w) => w.definitions && w.definitions.length > 0).length;
    assert.ok(withDefs / HSK.length > 0.99, withDefs + '/' + HSK.length);
  });
  it('你好 ha una definizione', () => {
    const nihao = HSK.find((w) => w.word === '你好');
    assert.ok(nihao && nihao.definitions.length > 0, JSON.stringify(nihao && nihao.definitions));
  });
});

describe('dict-search — ricerca hanzi', () => {
  it('hanzi esatto in cima', () => {
    const res = D.search('好', idx);
    assert.strictEqual(res[0].word, '好');
  });
  it('sotto-stringa hanzi', () => {
    const res = words(D.search('你好', idx));
    assert.ok(res.includes('你好'));
  });
});

describe('dict-search — ricerca pinyin', () => {
  it('pinyin senza toni', () => {
    const res = words(D.search('hao', idx));
    assert.ok(res.includes('好') && res.includes('号'), res.join(','));
  });
  it('pinyin con accenti', () => {
    const res = words(D.search('hǎo', idx));
    assert.ok(res.includes('好'), res.join(','));
  });
  it('pinyin con numeri', () => {
    const res = words(D.search('hao3', idx));
    assert.ok(res.includes('好'), res.join(','));
  });
  it('frase pinyin multi-sillaba', () => {
    const res = words(D.search('nihao', idx));
    assert.ok(res.includes('你好'), res.join(','));
  });
});

describe('dict-search — ricerca inglese (inversa)', () => {
  it('gloss esatto', () => {
    const res = words(D.search('hello', idx));
    assert.ok(res.includes('你好'), res.join(','));
  });
  it('gloss sotto-stringa', () => {
    const res = words(D.search('computer', idx));
    assert.ok(res.includes('电脑'), res.join(','));
  });
  it('gloss di parola composta', () => {
    const res = words(D.search('good', idx));
    assert.ok(res.includes('好'), res.join(','));
  });
});

describe('dict-search — edge case', () => {
  it('query vuota -> []', () => {
    assert.deepStrictEqual(D.search('   ', idx), []);
  });
  it('nessun risultato -> []', () => {
    assert.deepStrictEqual(D.search('zzqqxx', idx), []);
  });
  it('bareOf normalizza toni e v', () => {
    assert.strictEqual(D.bareOf('ni3 hao3'), 'ni hao');
    assert.strictEqual(D.bareOf('nǐ hǎo'), 'ni hao');
    assert.strictEqual(D.bareOf('lv3'), 'lü');
  });
  it('isHanzi', () => {
    assert.strictEqual(D.isHanzi('好'), true);
    assert.strictEqual(D.isHanzi('hao'), false);
  });
});
