const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

globalThis.__PINYN_POS = JSON.parse(
  fs.readFileSync('src/data/hsk-pos.js', 'utf8').split('= ')[1].replace(/;\s*$/, '')
);
globalThis.PinynGrammar = require('../../src/utils/grammar-rules.js');
const G = globalThis.PinynGrammar;

const w = (hanzi) => ({ bare: '', hanzi });

describe('grammar-rules (verifica forma)', () => {
  it('avverbio di grado + nome -> avviso', () => {
    const notes = G.checkGrammar([w('我'), w('很'), w('学生')]);
    assert.ok(notes.length === 1);
    assert.ok(notes[0].message.includes('很'));
  });
  it('很 + aggettivo/verbo -> nessun avviso', () => {
    const notes = G.checkGrammar([w('我'), w('很'), w('好')]);
    assert.strictEqual(notes.length, 0);
  });
  it('是 + verbo -> avviso', () => {
    const notes = G.checkGrammar([w('我'), w('是'), w('去'), w('学校')]);
    assert.ok(notes.some((n) => n.message.includes('是')));
  });
  it('是 + nome -> nessun avviso', () => {
    const notes = G.checkGrammar([w('我'), w('是'), w('学生')]);
    assert.strictEqual(notes.length, 0);
  });
  it('吗 non a fine frase -> avviso', () => {
    const notes = G.checkGrammar([w('你'), w('去'), w('吗'), w('学校')]);
    assert.ok(notes.some((n) => n.message.includes('吗')));
  });
  it('吗 a fine frase -> nessun avviso', () => {
    const notes = G.checkGrammar([w('你'), w('去'), w('学校'), w('吗')]);
    assert.strictEqual(notes.length, 0);
  });
  it('frase corretta -> nessun avviso', () => {
    const notes = G.checkGrammar([w('我'), w('去'), w('学校')]);
    assert.strictEqual(notes.length, 0);
  });
  it('POS multi-tag (V/N) non fa scattare le regole', () => {
    // simula un POS ambiguo: la regola 很+N non deve scattare su tag composto
    const old = globalThis.__PINYN_POS['学生'];
    globalThis.__PINYN_POS['学生'] = 'V/N';
    const notes = G.checkGrammar([w('我'), w('很'), w('学生')]);
    assert.strictEqual(notes.length, 0);
    globalThis.__PINYN_POS['学生'] = old;
  });
});
