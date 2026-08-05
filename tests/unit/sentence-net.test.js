const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

globalThis.chrome = { runtime: { getURL: () => 'data/sentence-net.json' } };
globalThis.PinynSentenceNet = require('../../src/llm/sentence-net.js');
const SN = globalThis.PinynSentenceNet;

const raw = JSON.parse(fs.readFileSync('src/data/sentence-net.json', 'utf8'));
const model = SN.build(raw);

describe('sentence-net (LM forma)', () => {
  it('frase troppo corta -> null (nessuna valutazione)', () => {
    assert.strictEqual(SN.scoreSentence(model, ['wo', 'qu']), null);
  });
  it('frase corretta -> non flaggata', () => {
    const sc = SN.scoreSentence(model, 'wo qu xuexiao'.split(' '));
    assert.ok(sc);
    assert.strictEqual(sc.flagged, false);
  });
  it('frase corretta lunga -> non flaggata', () => {
    const sc = SN.scoreSentence(model, 'ta mingtian qu shangdian mai shu'.split(' '));
    assert.ok(sc);
    assert.strictEqual(sc.flagged, false);
  });
  it('frase sgrammaticata -> flaggata', () => {
    const sc = SN.scoreSentence(model, 'ta zhe ge xihuan hen shu'.split(' '));
    assert.ok(sc);
    assert.strictEqual(sc.flagged, true);
  });
  it('punteggio in intervallo atteso', () => {
    const sc = SN.scoreSentence(model, 'wo xihuan zhongguo'.split(' '));
    assert.ok(sc.avgNegLog > 0 && sc.avgNegLog < 12);
    assert.ok(sc.perplexity > 1);
  });
});
