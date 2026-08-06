const { describe, it } = require('node:test');
const assert = require('node:assert');

const TP = require('../../src/utils/translate-parse.js');

describe('translate-parse — parseGtx', () => {
  it('singolo segmento', () => {
    const r = TP.parseGtx('[[["Ciao mondo","你好世界",null,null,10]],null,"zh-CN"]');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.translation, 'Ciao mondo');
    assert.strictEqual(r.lang, 'zh-CN');
  });

  it('segmenti multipli concatenati', () => {
    const r = TP.parseGtx('[[["Ciao ","你好",null,null,10],["mondo.","世界。",null,null,11]],null,"zh-CN"]');
    assert.strictEqual(r.translation, 'Ciao mondo.');
  });

  it('testo con virgolette e accenti', () => {
    const r = TP.parseGtx('[[["«Perché no?»","“为什么不行？”",null,null,10]],null,"zh-CN"]');
    assert.strictEqual(r.translation, '«Perché no?»');
  });

  it('JSON malformato -> ok false', () => {
    const r = TP.parseGtx('non-json');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.translation, '');
  });

  it('formato inatteso -> ok false', () => {
    assert.strictEqual(TP.parseGtx('{}').ok, false);
    assert.strictEqual(TP.parseGtx(null).ok, false);
    assert.strictEqual(TP.parseGtx('[[],null,"zh-CN"]').ok, false);
  });

  it('accetta oggetto già parsato', () => {
    const r = TP.parseGtx(JSON.parse('[[["Sì","是的",null,null,10]],null,"zh-CN"]'));
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.translation, 'Sì');
  });
});

describe('translate-parse — buildUrl', () => {
  it('contiene client/sl/tl/dt/q', () => {
    const url = TP.buildUrl('你好世界', 'it');
    assert.ok(url.startsWith('https://translate.googleapis.com/translate_a/single?'));
    assert.ok(url.includes('client=gtx'));
    assert.ok(url.includes('sl=auto'));
    assert.ok(url.includes('tl=it'));
    assert.ok(url.includes('q=%E4%BD%A0%E5%A5%BD%E4%B8%96%E7%95%8C'));
  });

  it('fallback a it se targetLang non valido', () => {
    assert.ok(TP.buildUrl('x', '??').includes('tl=it'));
    assert.ok(TP.buildUrl('x', '').includes('tl=it'));
    assert.ok(TP.buildUrl('x', 'zh-CN').includes('tl=zh-CN'));
  });
});
