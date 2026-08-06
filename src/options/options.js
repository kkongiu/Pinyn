const level = document.getElementById('hsk-level');
const autoAccent = document.getElementById('auto-accent');
const toneNet = document.getElementById('tone-net');
const hanzi = document.getElementById('hanzi');
const grammar = document.getElementById('grammar');
const spaceAfterAccept = document.getElementById('spaceAfterAccept');

chrome.storage.sync.get({ hskLevel: 3, autoAccent: false, toneNet: true, hanzi: false, grammar: true, spaceAfterAccept: false }, (data) => {
  level.value = String(data.hskLevel || 3);
  autoAccent.checked = !!data.autoAccent;
  toneNet.checked = data.toneNet !== false;
  hanzi.checked = !!data.hanzi;
  grammar.checked = data.grammar !== false;
  spaceAfterAccept.checked = !!data.spaceAfterAccept;
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
