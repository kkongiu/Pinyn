const fs = require('fs');
const PROJECT = require('path').join(__dirname, '..');

// riusa pinyin-utils per convertire numeri -> diacritici
const P = require(PROJECT + '/src/utils/pinyin-utils.js');

const csv = fs.readFileSync('/tmp/opencode/hsk/hsk30.csv', 'utf8');
const lines = csv.split('\n').filter((l, i) => i > 0 && l.trim());

// ---- CC-CEDICT: mappa hanzi -> glosses (unite su tutte le letture) ----
const CEDICT_FILE = '/tmp/opencode/cedict';
function loadCedict() {
  const map = new Map();
  if (!fs.existsSync(CEDICT_FILE)) return map;
  const raw = fs.readFileSync(CEDICT_FILE, 'utf8').split('\n');
  for (const l of raw) {
    const line = l.replace(/\r$/, '');
    if (!line || line.startsWith('#')) continue;
    const m1 = line.match(/^(\S+)\s+(\S+)\s+\[[^\]]+\]\s+\/(.*)\/$/);
    if (!m1) continue;
    const simp = m1[2];
    const glosses = m1[3].split('/').filter(Boolean);
    let e = map.get(simp);
    if (!e) { e = { glosses: new Set() }; map.set(simp, e); }
    for (const g of glosses) e.glosses.add(g);
  }
  return map;
}
const CEDICT = loadCedict();

function defsFor(simp) {
  const e = CEDICT.get(simp);
  if (!e || e.glosses.size === 0) return [];
  return [...e.glosses].slice(0, 8);
}

// Supplemento: parole HSK base assenti nel dataset sorgente.
const SUPPLEMENT = [
  ['你好', 'nǐ hǎo', 'ni3 hao3', 1, 'intj', ['hello; hi']],
  ['您好', 'nín hǎo', 'nin2 hao3', 1, 'intj', ['hello (polite)']],
  ['喝水', 'hē shuǐ', 'he1 shui3', 1, 'v', ['to drink water']],
  ['好吗', 'hǎo ma', 'hao3 ma', 1, 'intj', ['(used at end of sentence) is it okay?; how about...?']],
  ['很高兴', 'hěn gāo xìng', 'hen3 gao1 xing4', 1, 'adj', ['very happy; very glad']],
  ['早上好', 'zǎo shang hǎo', 'zao3 shang hao3', 1, 'intj', ['good morning']],
  ['贵姓', 'guì xìng', 'gui4 xing4', 1, 'n', ['(polite) may I ask your (sur)name?']],
  ['上海', 'shàng hǎi', 'shang4 hai3', 2, 'n', ['Shanghai']],
  ['广州', 'guǎng zhōu', 'guang3 zhou1', 2, 'n', ['Guangzhou']],
  ['深圳', 'shēn zhèn', 'shen1 zhen4', 2, 'n', ['Shenzhen']],
  ['香港', 'xiāng gǎng', 'xiang1 gang3', 2, 'n', ['Hong Kong']],
  ['澳门', 'ào mén', 'ao4 men2', 2, 'n', ['Macau']],
  ['台湾', 'tái wān', 'tai2 wan1', 2, 'n', ['Taiwan']],
  ['美国', 'měi guó', 'mei3 guo2', 2, 'n', ['United States']],
  ['英国', 'yīng guó', 'ying1 guo2', 2, 'n', ['United Kingdom']],
  ['日本', 'rì běn', 'ri4 ben3', 2, 'n', ['Japan']],
  ['韩国', 'hán guó', 'han2 guo2', 2, 'n', ['South Korea']],
  ['法国', 'fǎ guó', 'fa3 guo2', 2, 'n', ['France']],
  ['德国', 'dé guó', 'de2 guo2', 2, 'n', ['Germany']],
  ['天安门', 'tiān ān mén', 'tian1 an1 men2', 2, 'n', ['Tiananmen']],
  ['面条', 'miàn tiáo', 'mian4 tiao2', 2, 'n', ['noodles']],
  ['好玩', 'hǎo wán', 'hao3 wan2', 2, 'adj', ['fun; amusing']],
  // Paesi e città comuni
  ['意大利', 'yì dà lì', 'yi4 da4 li4', 2, 'n', ['Italy']],
  ['西班牙', 'xī bān yá', 'xi1 ban1 ya2', 2, 'n', ['Spain']],
  ['加拿大', 'jiā ná dà', 'jia1 na2 da4', 2, 'n', ['Canada']],
  ['俄罗斯', 'é luó sī', 'e2 luo2 si1', 2, 'n', ['Russia']],
  ['澳大利亚', 'ào dà lì yà', 'ao4 da4 li4 ya4', 2, 'n', ['Australia']],
  ['巴西', 'bā xī', 'ba1 xi1', 2, 'n', ['Brazil']],
  ['印度', 'yìn dù', 'yin4 du4', 2, 'n', ['India']],
  ['泰国', 'tài guó', 'tai4 guo2', 2, 'n', ['Thailand']],
  ['越南', 'yuè nán', 'yue4 nan2', 2, 'n', ['Vietnam']],
  ['新加坡', 'xīn jiā pō', 'xin1 jia1 po1', 2, 'n', ['Singapore']],
  ['马来西亚', 'mǎ lái xī yà', 'ma3 lai2 xi1 ya4', 2, 'n', ['Malaysia']],
  ['印度尼西亚', 'yìn dù ní xī yà', 'yin4 du4 ni2 xi1 ya4', 2, 'n', ['Indonesia']],
  ['土耳其', 'tǔ ěr qí', 'tu3 er3 qi2', 2, 'n', ['Turkey']],
  ['埃及', 'āi jí', 'ai1 ji2', 2, 'n', ['Egypt']],
  ['瑞士', 'ruì shì', 'rui4 shi4', 2, 'n', ['Switzerland']],
  ['瑞典', 'ruì diǎn', 'rui4 dian3', 2, 'n', ['Sweden']],
  ['挪威', 'nuó wēi', 'nuo2 wei1', 2, 'n', ['Norway']],
  ['荷兰', 'hé lán', 'he2 lan2', 2, 'n', ['Netherlands']],
  ['比利时', 'bǐ lì shí', 'bi3 li4 shi2', 2, 'n', ['Belgium']],
  ['葡萄牙', 'pú táo yá', 'pu2 tao2 ya2', 2, 'n', ['Portugal']],
  ['希腊', 'xī là', 'xi1 la4', 2, 'n', ['Greece']],
  ['波兰', 'bō lán', 'bo1 lan2', 2, 'n', ['Poland']],
  ['奥地利', 'ào dì lì', 'ao4 di4 li4', 2, 'n', ['Austria']],
  ['墨西哥', 'mò xī gē', 'mo4 xi1 ge1', 2, 'n', ['Mexico']],
  ['阿根廷', 'ā gēn tíng', 'a1 gen1 ting2', 2, 'n', ['Argentina']],
  ['罗马', 'luó mǎ', 'luo2 ma3', 2, 'n', ['Rome']],
  ['伦敦', 'lún dūn', 'lun2 dun1', 2, 'n', ['London']],
  ['巴黎', 'bā lí', 'ba1 li2', 2, 'n', ['Paris']],
  ['纽约', 'niǔ yuē', 'niu3 yue1', 2, 'n', ['New York']],
  ['东京', 'dōng jīng', 'dong1 jing1', 2, 'n', ['Tokyo']],
  ['首尔', 'shǒu ěr', 'shou3 er3', 2, 'n', ['Seoul']],
  ['莫斯科', 'mò sī kē', 'mo4 si1 ke1', 2, 'n', ['Moscow']],
  ['柏林', 'bó lín', 'bo2 lin2', 2, 'n', ['Berlin']],
  ['悉尼', 'xī ní', 'xi1 ni2', 2, 'n', ['Sydney']],
  ['多伦多', 'duō lún duō', 'duo1 lun2 duo1', 2, 'n', ['Toronto']],
];

const words = [];
const seen = new Set();

for (const w of SUPPLEMENT) {
  if (seen.has(w[0])) continue;
  seen.add(w[0]);
  const defs = (w[5] && w[5].length) ? w[5] : defsFor(w[0]);
  words.push({
    id: w[0], word: w[0], pinyin: w[1], pinyin_numbers: w[2],
    level: w[3], pos: w[4] || '', rank: 1, definitions: defs,
  });
}

for (const ln of lines) {
  const parts = ln.split(',');
  // ID,Simplified,Traditional,Pinyin,POS,Level,WebNo,WebPinyin,OCR,Variants,CEDICT
  const word = parts[1];
  const pos = parts[4];
  let levelRaw = parts[5];
  const rank = parseInt(parts[6], 10) || 999999;
  const cedixt = parts[10] || '';

  if (!word || seen.has(word)) continue;

  const m = cedixt.match(/\[([^\]]+)\]/);
  let pinyinNumbers = m ? m[1].trim() : '';

  if (!pinyinNumbers) {
    // fallback: WebPinyin (diacritici) -> numbers
    const wp = parts[7] || parts[3];
    if (!wp) continue;
    pinyinNumbers = wp
      .toLowerCase()
      .split('')
      .map((ch) => (isChineseTone(ch) ? toneNum(ch) : ch))
      .join('');
  }

  // Sanifica: CEDICT usa "u:" per ü e talvolta contiene parentesi/varianti.
  pinyinNumbers = sanitizeNumbers(pinyinNumbers);
  if (!pinyinNumbers) continue;

  const level = levelRaw === '7-9' ? 7.5 : Number(levelRaw);
  if (!level || level < 1) continue;

  const pinyin = P.convertToneNumbers(pinyinNumbers).replace(/\s+/g, ' ').trim();

  seen.add(word);
  words.push({
    id: word,
    word,
    pinyin,
    pinyin_numbers: pinyinNumbers,
    level,
    pos: pos || '',
    rank,
    definitions: defsFor(word),
  });
}

function isChineseTone(ch) {
  return /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/.test(ch);
}
function toneNum(ch) {
  const map = {
    ā: 'a1', á: 'a2', ǎ: 'a3', à: 'a4',
    ē: 'e1', é: 'e2', ě: 'e3', è: 'e4',
    ī: 'i1', í: 'i2', ǐ: 'i3', ì: 'i4',
    ō: 'o1', ó: 'o2', ǒ: 'o3', ò: 'o4',
    ū: 'u1', ú: 'u2', ǔ: 'u3', ù: 'u4',
    ǖ: 'v1', ǘ: 'v2', ǚ: 'v3', ǜ: 'v4',
  };
  return map[ch] || ch;
}

/** Pulisce la stringa pinyin numerica: u: -> ü, scarta segmenti non validi. */
function sanitizeNumbers(numbers) {
  return numbers
    .toLowerCase()
    .replace(/u:/g, 'ü')
    .replace(/ü:[0-5]/g, 'ü')
    .replace(/([a-zü]+)[:；;|,，]+\s*/g, '$1 ') // separatori
    .split(/\s+/)
    .map((seg) => seg.replace(/^[^a-zü]+|[^a-zü0-5]+$/g, ''))
    .filter((seg) => /^[a-zü]+[0-5]?$/.test(seg))
    .join(' ')
    .trim();
}

words.sort((a, b) => a.level - b.level || a.word.localeCompare(b.word));

const out = { note: 'Vocabolario HSK 3.0 completo (ivankra/hsk30, MIT). Livello "7-9" -> 7.5.', source: 'https://github.com/ivankra/hsk30', words };
fs.writeFileSync(PROJECT + '/src/data/hsk-3.0.json', JSON.stringify(out, null, 1) + '\n');

// versione compatta per l'iniezione nel content script (senza rank: non usato)
const compact = words.map((w) => ({ w: w.id, p: w.pinyin_numbers, l: w.level }));
const js =
  '/* autogen: vocabolario HSK 3.0 completo (vedi data/hsk-3.0.json). ' +
  words.length + ' parole. Formato compatto {w,p,l}. */\n' +
  'window.__PINYN_HSK = ' + JSON.stringify(compact) + ';\n';
fs.writeFileSync(PROJECT + '/src/data/hsk-3.0.js', js);

console.log('parole totali:', words.length);
console.log('per livello:');
const by = {};
words.forEach((w) => { by[w.level] = (by[w.level] || 0) + 1; });
console.log(JSON.stringify(by));
console.log('size js:', fs.statSync(PROJECT + '/src/data/hsk-3.0.js').size, 'bytes');
console.log('esempio:', JSON.stringify(words.slice(0, 2)));
