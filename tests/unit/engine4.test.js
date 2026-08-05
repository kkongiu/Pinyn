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
const SYL = new Set(JSON.parse(fs.readFileSync('src/data/pinyin-syllables.json', 'utf8')).syllables);
const HSK = JSON.parse(fs.readFileSync('src/data/hsk-3.0.json', 'utf8')).words;

const engine = PinynCorrectionEngine.createEngine({ syllables: SYL, hskWords: HSK, hskLevel: 3 });
const createDetector = () => PinynErrorDetector.createDetector(SYL, { engine });

describe('tono sospetto (giallo)', () => {
  it('toneSuspect: tono raro -> sospetto', () => {
    assert.strictEqual(engine.toneSuspect('hao', 1), true);   // hao1 raro
    assert.strictEqual(engine.toneSuspect('hao', 3), false);  // hǎo dominante
    assert.strictEqual(engine.toneSuspect('ma', 4), true);    // mà raro
    assert.strictEqual(engine.toneSuspect('shi', 2), false);  // bilanciato
    assert.strictEqual(engine.toneSuspect('zhong', 3), false); // 种 abbastanza comune
  });

  it('detector: hao1 -> kind tone con suggerimento', () => {
    const det = createDetector();
    const tone = det.scan('hao1').filter((e) => e.kind === 'tone');
    assert.strictEqual(tone.length, 1);
    assert.strictEqual(tone[0].isError, false);
    assert.ok(tone[0].suggestions.includes('hǎo'), JSON.stringify(tone[0].suggestions));
  });

  it('detector: hao3 corretto -> nessun sospetto', () => {
    const det = createDetector();
    assert.strictEqual(det.scan('hao3').filter((e) => e.kind).length, 0);
  });

  it('errori veri restano errori (rosso)', () => {
    const det = createDetector();
    const e = det.scan('hkao').filter((r) => r.isError);
    assert.strictEqual(e.length, 1);
    assert.strictEqual(e[0].kind, 'error');
  });
});

describe('pinyinLevel (statistiche)', () => {
  it('risolve il livello di una parola accentuata', () => {
    assert.strictEqual(engine.pinyinLevel('zhōng guó'), 1);   // 中国 L1
    assert.strictEqual(engine.pinyinLevel('yī zài'), 4);      // 一再 L4
    assert.strictEqual(engine.pinyinLevel('yī lǜ'), 4);       // 一律 L4
  });
  it('risolve sillaba singola', () => {
    assert.strictEqual(engine.pinyinLevel('hǎo'), 1);
  });
  it('parola ignota -> null', () => {
    assert.strictEqual(engine.pinyinLevel('hello world'), null);
  });
});
