const { describe, it } = require('node:test');
const assert = require('node:assert');

const fs = require('node:fs');

const DEFS_RAW = fs.readFileSync('src/data/hsk-defs.js', 'utf8');
const DEFS = JSON.parse(DEFS_RAW.split('= ')[1].replace(/;\s*$/, ''));
const HSK = JSON.parse(fs.readFileSync('src/data/hsk-3.0.json', 'utf8')).words;

const strip = (numbers) => numbers.toLowerCase().replace(/v/g, 'ü').replace(/[0-5]/g, '').replace(/\s+/g, '');

describe('hsk-defs.js — hanzi tono-aware (sillabe singole)', () => {
  // replica la mappa bare+tone -> carattere più comune (livello più basso)
  const HSK7 = HSK;
  const map = new Map();
  for (const w of HSK7) {
    if (w.word.length !== 1) continue;
    const nums = (w.pinyin_numbers || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (nums.length !== 1) continue;
    const m = nums[0].match(/^([a-zü]+)([0-5])$/);
    if (!m) continue;
    const key = m[1] + (m[2] === '0' || m[2] === '5' ? '0' : m[2]);
    const cur = map.get(key);
    if (!cur || (w.level || 9) < cur.l) map.set(key, { hanzi: w.word, l: w.level || 9 });
  }
  it('shi2 -> 十 e ma3 -> 马 (livello più basso vince)', () => {
    assert.strictEqual(map.get('shi2').hanzi, '十');
    assert.strictEqual(map.get('ma3').hanzi, '马');
  });
  it('shui3 -> 水, wo3 -> 我', () => {
    assert.strictEqual(map.get('shui3').hanzi, '水');
    assert.strictEqual(map.get('wo3').hanzi, '我');
  });
  it('he2 -> 和', () => {
    assert.strictEqual(map.get('he2').hanzi, '和');
  });
  it('le0 neutro -> 了', () => {
    assert.strictEqual(map.get('le0').hanzi, '了');
  });
});

describe('hsk-defs.js — reverse dizionario (inglese -> cinese)', () => {
  // replica l'indice inverso usato dal content script (any-token + stopword)
  const STOP = new Set(('to of and or the a an in at on by for with from is are was were be been being it its this that ' +
    'these those as not no do does did can could will would should may might have has had about into ' +
    'than then when where which who whom what how if but so very also used mostly form etc especially').split(' '));
  const MARK = new Set(['loanword', 'variant', 'classifier', 'coll', 'idiom', 'surname', 'bound', 'erhua', 'dialect', 'abbreviation', 'slang', 'radical', 'kangxi']);
  const idx = new Map();
  for (const bare of Object.keys(DEFS)) {
    const v = DEFS[bare];
    const i = v.indexOf('|');
    if (i < 0) continue;
    const hanzi = v.slice(0, i);
    const gloss = v.slice(i + 1);
    const toks = gloss.toLowerCase().split(/[^a-z]+/).filter((t) => t.length >= 3 && !STOP.has(t) && !MARK.has(t));
    toks.forEach((tk) => {
      if (!idx.has(tk)) idx.set(tk, []);
      idx.get(tk).push({ bare, hanzi });
    });
  }
  const hanziFor = (token) => (idx.get(token) || []).map((h) => h.hanzi);

  it('water -> 水', () => {
    assert.ok(hanziFor('water').includes('水'), JSON.stringify(hanziFor('water')));
  });
  it('*he (esplicito) -> 他 ha il gloss "he"', () => {
    assert.ok(DEFS.ta.includes('he'), JSON.stringify(DEFS.ta));
  });
  it('coffee -> 咖啡', () => {
    assert.ok(hanziFor('coffee').includes('咖啡'), JSON.stringify(hanziFor('coffee')));
  });
  it('dog -> 狗', () => {
    assert.ok(hanziFor('dog').includes('狗'), JSON.stringify(hanziFor('dog').slice(0, 5)));
  });
  it('and (funzione) -> nessun rumore', () => {
    assert.strictEqual((idx.get('and') || []).length, 0);
  });
  it('wo/he (pinyin, 2 lettere) -> nessun hit inglese', () => {
    assert.strictEqual((idx.get('wo') || []).length, 0);
    assert.strictEqual((idx.get('he') || []).length, 0);
  });
  it('marker tecnici esclusi (loanword, idiom)', () => {
    assert.strictEqual((idx.get('loanword') || []).length, 0);
    assert.strictEqual((idx.get('idiom') || []).length, 0);
  });
});

describe('hsk-defs.js — integrità', () => {
  it('è un oggetto con ~9k voci', () => {
    const n = Object.keys(DEFS).length;
    assert.ok(n > 8000 && n < 10000, n);
  });
  it('ogni voce è "hanzi|gloss"', () => {
    const bad = Object.entries(DEFS).filter(([, v]) => !v.includes('|'));
    assert.strictEqual(bad.length, 0);
  });
  it('parole comuni risolte', () => {
    assert.strictEqual(DEFS.kafei, '咖啡|(loanword) coffee');
    assert.strictEqual(DEFS.wo, '我|I; me; my');
    assert.strictEqual(DEFS.zhongguo, '中国|China');
    assert.strictEqual(DEFS.xihuan, '喜欢|to like; to be fond of');
  });
  it('copertura: la maggior parte delle parole HSK ha un entry per pinyin', () => {
    let hit = 0;
    for (const w of HSK) {
      if (w.pinyin_numbers && DEFS[strip(w.pinyin_numbers)]) hit++;
    }
    const pct = (100 * hit) / HSK.length;
    assert.ok(pct > 85, pct.toFixed(1) + '%');
  });
  it('i gloss puliti non contengono marcatori tecnici', () => {
    // il fallback "variant of" è ammesso quando TUTTI i gloss sono tecnici
    const bad = Object.values(DEFS)
      .map((v) => v.split('|')[1])
      .filter((g) => /^(CL:|.*variant of.*)/.test(g));
    assert.ok(bad.length / Object.keys(DEFS).length < 0.01, bad.slice(0, 3).join(', '));
  });
});
