'use strict';
/**
 * Batteria estesa di verifica dell'affidabilità del correttore pinyin.
 * Copre: integrità dati, tokenizer, toni, correzione, segmentazione,
 * accentazione, suggerimenti parola, fuzz e performance.
 */
const P = require('../src/utils/pinyin-utils.js');
const L = require('../src/utils/levenshtein.js');
globalThis.PinynUtils = P;
globalThis.PinynLevenshtein = L;
require('../src/utils/correction-engine.js');
require('../src/content/error-detector.js');

const sylData = JSON.parse(require('fs').readFileSync('src/data/pinyin-syllables.json', 'utf8'));
const SYL = new Set(sylData.syllables);
const HSK = JSON.parse(require('fs').readFileSync('src/data/hsk-3.0.json', 'utf8')).words;

const engine = globalThis.PinynCorrectionEngine.createEngine({ syllables: SYL, hskWords: HSK, hskLevel: 9 });
const det = globalThis.PinynErrorDetector.createDetector(SYL, { engine });
const D = require('../src/utils/dict-search.js');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; }
  else { fail++; failures.push(name + (detail ? ' :: ' + detail : '')); }
}
const t0 = Date.now();

// ---------- A. Tokenizer ----------
{
  const t = P.tokenize('ni hao, 你好! 123 ni3 nǐ');
  check('A1 token contenuto', ['ni','hao','ni3','nǐ'].every(x => t.some(y => y.text === x)), t.map(x=>x.text).join('|'));
  check('A1b ordine', t[0].text === 'ni' && t[2].text === 'hao');
  check('A2 digit tone in token', t.some(x => x.text === 'ni3' && x.isLatin));
  check('A3 diacritico token', t.some(x => x.text === 'nǐ'));
  check('A4 CJK non latin', t.some(x => x.text.includes('你好') && !x.isLatin));
  check('A5 empty', P.tokenize('').length === 0);
  check('A6 solo spazio', P.tokenize('  ').length === 1);
}

// ---------- B. Toni ----------
{
  const cases = [
    ['ni3', 'nǐ'], ['hao3', 'hǎo'], ['wo3', 'wǒ'], ['shi4', 'shì'],
    ['lv3', 'lǚ'], ['nü3', 'nǚ'], ['xue2', 'xué'], ['er4', 'èr'],
    ['yi1', 'yī'], ['si4', 'sì'], ['zhong1', 'zhōng'], ['guo2', 'guó'],
  ];
  for (const [a, b] of cases) check(`B ton ${a}->${b}`, P.toToneMark(a) === b, P.toToneMark(a));
  const noV = cases.filter(([a]) => !a.includes('v'));
  check('B roundtrip', noV.every(([a, b]) => P.toToneNumber(b) === a), noV.map(([a,b]) => a + '=>' + P.toToneNumber(b)).join(';'));
  check('B2 v->ü', P.toToneMark('lv3') === 'lǚ', P.toToneMark('lv3'));
  check('B convertToneNumbers', P.convertToneNumbers('ni3 hao3 wo3') === 'nǐ hǎo wǒ', P.convertToneNumbers('ni3 hao3 wo3'));
}

// ---------- C. Integrità sillabe ----------
{
  check('C1 nessun vuoto', sylData.syllables.every(s => s.length >= 1));
  check('C2 solo a-z/ü/ê', sylData.syllables.every(s => /^[a-züê]+$/.test(s)));
  check('C3 duplicati assenti', new Set(sylData.syllables).size === sylData.syllables.length);
  check('C4 lunghezza max <=6', sylData.syllables.every(s => s.length <= 6), sylData.syllables.filter(s=>s.length>6).join(','));
  const known = ['ni','hao','shi','zhong','guo','zi','ci','si','zhi','chi','ri','er','mai','kuai','zhang'];
  check('C5 sillabe note presenti', known.every(s => SYL.has(s)), known.filter(s => !SYL.has(s)).join(','));
  check('C6 er presente', SYL.has('er'));
}

// ---------- D. Correzione (frase valide / errori noti) ----------
{
  const valid = ['ni hao', 'zhong guo ren', 'wo hen hao', 'xie xie ni', 'zai jian', 'shang hai', 'xi huan', 'dian nao'];
  for (const s of valid) {
    const errs = det.scan(s).filter(r => r.isError);
    check(`D valida "${s}"`, errs.length === 0, JSON.stringify(errs));
  }
  const errCases = [
    ['hkao', 'hao'], ['gguo', 'guo'], ['haoz', 'hao'], ['xio', 'xiǎo'],
    ['zaijianx', 'zài jiàn'], ['beijingg', 'běi jīng'],
  ];
  for (const [bad, expect] of errCases) {
    const errs = det.scan(bad).filter(r => r.isError);
    check(`D errore "${bad}"->${expect}`, errs.length === 1 && errs[0].suggestions.includes(expect), JSON.stringify(errs.map(e=>e.suggestions)));
  }
  // contrazioni valide senza spazi accettate (nihao, hele, xuexiao)
  for (const good of ['nihao', 'hele', 'xuexiao', 'kafei']) {
    const ok = det.scan(good).filter(r => r.isError).length === 0;
    check(`D contrazione accettata "${good}"`, ok, good);
  }
  // refuso con sillabe di una sola lettera -> errore (xuexioa)
  const xo = det.scan('xuexioa').filter(r => r.isError);
  check('D xuexioa->errore', xo.length === 1, JSON.stringify(xo.map(e => e.suggestions)));
  // match parola per zonguo
  const zg = det.scan('zonguo').filter(r=>r.isError);
  check('D zonguo->zhōng guó', zg.length === 1 && zg[0].suggestions.includes('zhōng guó'), JSON.stringify(zg.map(e=>e.suggestions)));
  // Ignora
  const d2 = globalThis.PinynErrorDetector.createDetector(SYL, { engine });
  d2.ignore('hkao');
  check('D ignore', d2.scan('hkao').filter(r=>r.isError).length === 0);
}

// ---------- E. Segmentazione ----------
{
  const segCases = [
    ['nihao', ['ni','hao']], ['zaijian', ['zai','jian']], ['zhongguo', ['zhong','guo']],
    ['zhongwen', ['zhong','wen']], ['xiexie', ['xie','xie']], ['hao', ['hao']],
    ['buhao', ['bu','hao']],
  ];
  for (const [inp, exp] of segCases) {
    const r = engine.segment(inp);
    check(`E seg ${inp}->${exp.join(' ')}`, r && r.join(' ') === exp.join(' '), r && r.join(' '));
  }
  check('E non segmentabile', engine.segment('xzq') === null);
}

// ---------- F. Accentazione ----------
{
  const accCases = [
    [['ni','hao'], 'nǐ hǎo'], [['zai','jian'], 'zài jiàn'], [['zhong','guo'], 'zhōng guó'],
    [['xie','xie'], 'xiè xie'], [['dian','nao'], 'diàn nǎo'], [['xue','sheng'], 'xué sheng'],
    [['wo','men'], 'wǒ men'], [['bei','jing'], 'běi jīng'],
  ];
  for (const [inp, exp] of accCases) {
    const r = engine.addAccentsToPhrase(inp).join(' ');
    check(`F acc ${inp.join(' ')}->${exp}`, r === exp, r);
  }
  check('F non pinyin invariato', engine.addAccentsToPhrase(['hello','world']).join(' ') === 'hello world');
  // accentable
  const acc = det.accentable('ni hao zai jian');
  check('F accentable conta', acc.length === 4, acc.length);

  // regressione: terzo tono su parole base + unione delle parole
  check('F2 wo -> wǒ (non wò)', engine.accentSingle('wo') === 'wǒ', engine.accentSingle('wo'));
  check('F3 zhongguo unito', engine.accentRun(['zhong','guo']).map(s=>s.text).join('') === 'zhōngguó',
    JSON.stringify(engine.accentRun(['zhong','guo'])));
  check('F4 wo ai ni separato', engine.accentRun(['wo','ai','ni']).map(s=>s.text).join(' ') === 'wǒ ài nǐ');
  check('F5 zhongguo senza spazi', engine.accentRun(['zhongguo'])[0].text === 'zhōngguó');
}

// ---------- G. Suggerimenti parola ----------
{
  const wordCases = [
    ['nihao', 'nǐ hǎo'], ['diannao', 'diàn nǎo'], ['xuesheng', 'xué sheng'],
    ['laoshi', 'lǎo shī'], ['pengyou', 'péng you'], ['zaijian', 'zài jiàn'],
  ];
  for (const [inp, exp] of wordCases) {
    const r = engine.findWordSuggestions(inp, 2);
    check(`G word ${inp}->${exp}`, r.includes(exp), JSON.stringify(r));
  }
}

// ---------- H. Integrità dataset HSK ----------
{
  const ids = new Set();
  let dup = 0;
  for (const w of HSK) { if (ids.has(w.id)) dup++; ids.add(w.id); }
  check('H1 id unici', dup === 0, dup);
  check('H2 pinyin_numbers presenti', HSK.every(w => w.pinyin_numbers && w.pinyin_numbers.trim()));
  check('H3 livello valido', HSK.every(w => w.level === 1 || w.level === 2 || w.level === 3 || w.level === 4 || w.level === 5 || w.level === 6 || w.level === 7.5));
  // tutte le sillabe nei pinyin devono essere valide OPPURE erhua "r"/"r5" o "n"/"n5" (particelle)
  const bad = [];
  for (const w of HSK) {
    const parts = w.pinyin_numbers.toLowerCase().replace(/v/g, 'ü').split(/\s+/).map(x => x.replace(/[0-5]/g, ''));
    for (const p of parts) {
      if (!SYL.has(p) && p !== 'r' && p !== 'n' && p !== 'm' && p !== 'ng') bad.push(w.word + ':' + p);
    }
  }
  check('H4 sillabe valide (o erhua/particelle)', bad.length === 0, bad.slice(0, 10).join(', '));
}

// ---------- I. Fuzz / crash ----------
{
  const charset = 'abcdefghijklmnopqrstuvwxyz üāáǎàōóǒò ēéěè īíǐì ūúǔù ' + '1234567890 ,.!?你好世界';
  let rngState = 42;
  const rnd = () => { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return rngState / 0x7fffffff; };
  let crashes = 0;
  const start = Date.now();
  for (let i = 0; i < 400; i++) {
    let s = '';
    const len = 1 + Math.floor(rnd() * 24);
    for (let k = 0; k < len; k++) s += charset[Math.floor(rnd() * charset.length)];
    try {
      det.scan(s);
      engine.segment(s.replace(/[^a-zü]/g, ''));
      engine.addAccentsToPhrase(s.replace(/[^a-zü\s]/g, '').split(/\s+/).filter(Boolean));
      engine.findWordSuggestions(s.replace(/[^a-zü]/g, '').slice(0, 8), 2);
    } catch (e) { crashes++; if (crashes <= 3) console.log('  FUZZ CRASH:', JSON.stringify(s), e.message); }
  }
  check('I1 fuzz nessun crash', crashes === 0, crashes);
  check('I2 fuzz < 3s', Date.now() - start < 3000, Date.now() - start + 'ms');
}

// ---------- J. Performance ----------
{
  const para = 'ni hao wo hen hao zhong guo ren lai shang hai dian nao xue sheng lao shi ' +
    'zai jian xie xie ni peng you men yi qi chi fan kan dian ying ting yin yue ';
  const N = 50;
  let t = Date.now();
  for (let i = 0; i < N; i++) det.scan(para);
  const scanMs = (Date.now() - t) / N;
  check('J1 scan testo < 5ms', scanMs < 5, scanMs.toFixed(3) + 'ms');

  t = Date.now();
  for (let i = 0; i < N; i++) engine.findWordSuggestions('zonguo', 2);
  const wordMs = (Date.now() - t) / N;
  check('J2 findWordSuggestions < 50ms', wordMs < 50, wordMs.toFixed(3) + 'ms');

  t = Date.now();
  for (let i = 0; i < N; i++) engine.segment('zhongguorenzaibeijing');
  const segMs = (Date.now() - t) / N;
  check('J3 segment < 2ms', segMs < 2, segMs.toFixed(3) + 'ms');
}

// ---------- K. Dizionario inverso ----------
{
  const t = Date.now();
  const idx = D.buildIndex(HSK);
  const buildMs = Date.now() - t;
  check('K1 buildIndex < 2s', buildMs < 2000, buildMs + 'ms');

  const qs = [['好', '好'], ['hao', '好'], ['hǎo', '好'], ['hello', '你好'], ['computer', '电脑'], ['nihao', '你好']];
  for (const [q, expect] of qs) {
    const found = D.search(q, idx, 20).some((r) => r.word === expect);
    check(`K2 "${q}" -> ${expect}`, found);
  }
  check('K3 nessun risultato', D.search('zzqqxx', idx).length === 0);

  const t2 = Date.now();
  for (let i = 0; i < 50; i++) D.search('hao', idx);
  const qMs = (Date.now() - t2) / 50;
  check("K4 ricerca < 15ms", qMs < 15, qMs.toFixed(2) + "ms");
}

const totalMs = Date.now() - t0;
console.log('\n===== RAPPORTO =====');console.log(`Pass: ${pass}   Fail: ${fail}   Tempo: ${totalMs}ms`);
if (failures.length) {
  console.log('\nFallimenti:');
  failures.forEach(f => console.log('  - ' + f));
} else {
  console.log('\nTUTTI I CHECK SUPERATI');
}
process.exit(fail ? 1 : 0);
