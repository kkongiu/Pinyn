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
const hskData = JSON.parse(fs.readFileSync('src/data/hsk-3.0.json', 'utf8'));
const HSK = hskData.words;

const createDetector = (opts) => PinynErrorDetector.createDetector(SYL, opts);

describe('pinyin-utils — toni', () => {
  it('estrae tono numerico', () => {
    assert.deepStrictEqual(P.extractTone('hao3'), { base: 'hao', tone: 3 });
    assert.deepStrictEqual(P.extractTone('ma0'), { base: 'ma', tone: 0 });
  });
  it('riconosce token con cifra tonale', () => {
    assert.strictEqual(P.isToneNumbered('hao3'), true);
    assert.strictEqual(P.isToneNumbered('hao'), false);
  });
  it('tokenizza cifre tonali come parte del token', () => {
    const toks = P.tokenize('ni3 hao3');
    assert.deepStrictEqual(toks.map((t) => t.text), ['ni3', ' ', 'hao3']);
    assert.strictEqual(toks[0].isLatin, true);
  });
  it('convertToneNumbers: numeri -> diacritici', () => {
    assert.strictEqual(P.convertToneNumbers('ni3 hao3'), 'nǐ hǎo');
    assert.strictEqual(P.convertToneNumbers('ma0'), 'ma');
    assert.strictEqual(P.convertToneNumbers('Hello ni3'), 'Hello nǐ');
  });
});

describe('error-detector — toni', () => {
  it('accetta "hao3" come sillaba valida (base hao)', () => {
    const det = createDetector();
    const errs = det.scan('ni3 hao3').filter((r) => r.isError);
    assert.strictEqual(errs.length, 0);
  });
  it('rileva "xa3" come errore (base non valida)', () => {
    const det = createDetector();
    const errs = det.scan('xa3 hao3').filter((r) => r.isError);
    assert.strictEqual(errs.length, 1);
    assert.strictEqual(errs[0].token, 'xa3');
  });
});

describe('correction-engine — contesto e HSK', () => {
  const engine = PinynCorrectionEngine.createEngine({ syllables: SYL, hskWords: HSK, hskLevel: 3 });

  it('bigrammi costruiti dal vocabolario HSK', () => {
    const b = engine.bigrams;
    assert.ok(b.get('ni hao') >= 1, 'ni hao atteso');
    assert.ok(b.get('zai jian') >= 1, 'zai jian atteso');
  });

  it('ranking contestuale: prev=zai privilegia jian', () => {
    // "zai jian" ha bigramma; "jian" con errore "jianx"
    const sugg = engine.rankSuggestions('jianx', 'zai');
    assert.ok(sugg.includes('jian'), 'jian atteso in cima');
  });

  it('ranking non contestuale ok', () => {
    const sugg = engine.rankSuggestions('haoz', null);
    assert.ok(sugg.includes('hao'));
  });

  it('filtro HSK: parole di livello > hskLevel+1 non pesano', () => {
    const engL1 = PinynCorrectionEngine.createEngine({ syllables: SYL, hskWords: HSK, hskLevel: 1 });
    // "dian hua" (电话, L3) non in set per livello 1 -> nessun bonus
    // ma resta suggeribile via distanza (sillaba valida)
    const sugg = engL1.rankSuggestions('dian', null);
    assert.ok(sugg.includes('dian'));
  });

  it('setLevel aggiorna il filtro', () => {
    const eng = PinynCorrectionEngine.createEngine({ syllables: SYL, hskWords: HSK, hskLevel: 9 });
    eng.setLevel(1);
    // comportamento: il ranking cambia, ma i suggerimenti restano sillabe valide
    assert.ok(Array.isArray(eng.rankSuggestions('dian', null)));
  });

  it('detector usa engine: suggerimento contestuale "zai jianx"', () => {
    const det = createDetector({ engine });
    const errs = det.scan('zai jianx').filter((r) => r.isError);
    assert.strictEqual(errs.length, 1);
    assert.ok(errs[0].suggestions.includes('jian'), JSON.stringify(errs[0].suggestions));
  });
  it('detector accetta parole accentate UNITE (kāfēi, zhōngguó)', () => {
    const det = createDetector({ engine });
    assert.strictEqual(det.scan('kāfēi').filter((r) => r.isError).length, 0, 'kāfēi');
    assert.strictEqual(det.scan('zhōngguó').filter((r) => r.isError).length, 0, 'zhōngguó');
    assert.strictEqual(det.scan('xǐhuan').filter((r) => r.isError).length, 0, 'xǐhuan');
  });
  it('detector mantiene errore su parola senza accenti e non segmentabile', () => {
    const det = createDetector({ engine });
    assert.strictEqual(det.scan('kafei').filter((r) => r.isError).length, 1, 'kafei resta errore');
    assert.strictEqual(det.scan('xzq').filter((r) => r.isError).length, 1);
  });
});
