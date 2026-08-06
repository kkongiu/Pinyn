const level = document.getElementById('hsk-level');
const autoAccent = document.getElementById('auto-accent');
const toneNet = document.getElementById('tone-net');
const hanzi = document.getElementById('hanzi');
const grammar = document.getElementById('grammar');
const spaceAfterAccept = document.getElementById('spaceAfterAccept');
const translate = document.getElementById('translate');
const translateLang = document.getElementById('translate-lang');
const translateMax = document.getElementById('translate-max');

chrome.storage.sync.get({ hskLevel: 3, autoAccent: false, toneNet: true, hanzi: false, grammar: true, spaceAfterAccept: false, translate: true, translateLang: '', translateMaxLen: 500 }, (data) => {
  level.value = String(data.hskLevel || 3);
  autoAccent.checked = !!data.autoAccent;
  toneNet.checked = data.toneNet !== false;
  hanzi.checked = !!data.hanzi;
  grammar.checked = data.grammar !== false;
  spaceAfterAccept.checked = !!data.spaceAfterAccept;
  translate.checked = data.translate !== false;
  if (translateLang.value !== String(data.translateLang || '')) translateLang.value = String(data.translateLang || '');
  const n = Number(data.translateMaxLen);
  translateMax.value = String(n >= 1 && n <= 2000 ? n : 500);
});

level.addEventListener('change', () => {
  chrome.storage.sync.set({ hskLevel: Number(level.value) });
});

autoAccent.addEventListener('change', () => {
  chrome.storage.sync.set({ autoAccent: autoAccent.checked });
});

toneNet.addEventListener('change', () => {
  chrome.storage.sync.set({ toneNet: toneNet.checked });
});

hanzi.addEventListener('change', () => {
  chrome.storage.sync.set({ hanzi: hanzi.checked });
});

grammar.addEventListener('change', () => {
  chrome.storage.sync.set({ grammar: grammar.checked });
});

spaceAfterAccept.addEventListener('change', () => {
  chrome.storage.sync.set({ spaceAfterAccept: spaceAfterAccept.checked });
});

translate.addEventListener('change', () => {
  chrome.storage.sync.set({ translate: translate.checked });
});

translateLang.addEventListener('change', () => {
  chrome.storage.sync.set({ translateLang: translateLang.value });
});

translateMax.addEventListener('change', () => {
  const n = Number(translateMax.value);
  if (n >= 1 && n <= 2000) chrome.storage.sync.set({ translateMaxLen: n });
});
