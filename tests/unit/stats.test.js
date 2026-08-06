const { describe, it } = require('node:test');
const assert = require('node:assert');
const Stats = require('../../src/utils/stats.js');

describe('stats — aggregazione', () => {
  it('applyEvent correction incrementa e registra il livello', () => {
    let s = Stats.applyEvent(null, { type: 'correction', level: 2 });
    assert.strictEqual(s.corrections, 1);
    assert.strictEqual(s.levels['2'], 1);
    s = Stats.applyEvent(s, { type: 'correction', level: 7.5 });
    assert.strictEqual(s.corrections, 2);
    assert.strictEqual(s.levels['7'], 1);
  });

  it('applyEvents somma ignore/accent/tonify/convert', () => {
    const s = Stats.applyEvents(null, [
      { type: 'ignore' },
      { type: 'accent' },
      { type: 'accent' },
      { type: 'tonify' },
      { type: 'convert' },
    ]);
    assert.strictEqual(s.ignores, 1);
    assert.strictEqual(s.accents, 2);
    assert.strictEqual(s.tonifies, 1);
    assert.strictEqual(s.converts, 1);
    assert.deepStrictEqual(s.levels, {});
  });

  it('non muta l\u2019input (clone read-modify-write)', () => {
    const base = Stats.empty();
    base.corrections = 5;
    const out = Stats.applyEvent(base, { type: 'correction', level: 1 });
    assert.strictEqual(base.corrections, 5);
    assert.strictEqual(out.corrections, 6);
    assert.strictEqual(out.levels['1'], 1);
    assert.strictEqual(base.levels['1'], undefined);
  });

  it('ignora eventi senza tipo', () => {
    const s = Stats.applyEvents(null, [{}, { type: 'correction' }]);
    assert.strictEqual(s.corrections, 1);
  });
});
