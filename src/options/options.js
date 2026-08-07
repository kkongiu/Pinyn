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

// ---------- siti esclusi / consentiti ----------
const blockedList = document.getElementById('blocked-list');
const allowedList = document.getElementById('allowed-list');

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderSites(el, key, emptyText) {
  const defaults = {};
  defaults[key] = [];
  chrome.storage.sync.get(defaults, (data) => {
    const list = Array.isArray(data[key]) ? data[key] : [];
    el.innerHTML = list.length
      ? list.map((h) => '<li><span>' + escapeHtml(h) + '</span><button data-h="' + escapeHtml(h) + '">Rimuovi</button></li>').join('')
      : '<li class="empty">' + emptyText + '</li>';
    el.querySelectorAll('[data-h]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const defaults2 = {};
        defaults2[key] = [];
        chrome.storage.sync.get(defaults2, (data) => {
          const arr = Array.isArray(data[key]) ? data[key] : [];
          const set = {};
          set[key] = arr.filter((h) => h !== btn.dataset.h);
          chrome.storage.sync.set(set);
        });
      });
    });
  });
}

function renderSitesAll() {
  renderSites(blockedList, 'blockedHosts', 'Nessun sito escluso.');
  renderSites(allowedList, 'allowedHosts', 'Nessun sito. Estensione attiva ovunque.');
}

renderSitesAll();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && (changes.blockedHosts || changes.allowedHosts)) renderSitesAll();
});
