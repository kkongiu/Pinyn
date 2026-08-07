const enabled = document.getElementById('enabled');
const searchInput = document.getElementById('search');
const resultsEl = document.getElementById('results');
const hanziToggle = document.getElementById('hanzi');
const grammarToggle = document.getElementById('grammar');
const spaceToggle = document.getElementById('spaceAfterAccept');
const translateToggle = document.getElementById('translate');

const tHanzi = document.getElementById('t-hanzi');
const tPinyin = document.getElementById('t-pinyin');
const tGloss = document.getElementById('t-gloss');
const tEn = document.getElementById('t-en');
const tAdd = document.getElementById('t-add');
const tError = document.getElementById('t-error');
const tList = document.getElementById('t-list');

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------- abilitato ----------
chrome.storage.sync.get('enabled', (data) => {
  enabled.checked = data.enabled !== false;
});

enabled.addEventListener('change', () => {
  chrome.storage.sync.set({ enabled: enabled.checked });
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'PC_SET_ENABLED', enabled: enabled.checked }, () => {});
    }
  });
});

// ---------- non usare in questa pagina / usa solo in questa pagina ----------
const siteBlocked = document.getElementById('site-blocked');
const siteAllowed = document.getElementById('site-allowed');
let currentHostname = null;

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0] && tabs[0].id != null) {
    chrome.tabs.sendMessage(tabs[0].id, { type: 'PC_GET_SITE_INFO' }, (res) => {
      if (res && res.hostname) {
        currentHostname = res.hostname;
        siteBlocked.checked = !!res.blocked;
        siteBlocked.disabled = false;
        siteAllowed.checked = !!res.allowed;
        siteAllowed.disabled = false;
      }
    });
  }
});

siteBlocked.addEventListener('change', () => {
  if (!currentHostname) return;
  chrome.storage.sync.get({ blockedHosts: [], allowedHosts: [] }, (data) => {
    const list = Array.isArray(data.blockedHosts) ? data.blockedHosts : [];
    const allowed = Array.isArray(data.allowedHosts) ? data.allowedHosts : [];
    const next = siteBlocked.checked
      ? (list.includes(currentHostname) ? list : list.concat([currentHostname]))
      : list.filter((h) => h !== currentHostname);
    // mutua esclusione: bloccare rimuove dall'allowlist
    const nextAllowed = siteBlocked.checked ? allowed.filter((h) => h !== currentHostname) : allowed;
    chrome.storage.sync.set({ blockedHosts: next, allowedHosts: nextAllowed });
  });
});

siteAllowed.addEventListener('change', () => {
  if (!currentHostname) return;
  chrome.storage.sync.get({ blockedHosts: [], allowedHosts: [] }, (data) => {
    const list = Array.isArray(data.blockedHosts) ? data.blockedHosts : [];
    const allowed = Array.isArray(data.allowedHosts) ? data.allowedHosts : [];
    const nextAllowed = siteAllowed.checked
      ? (allowed.includes(currentHostname) ? allowed : allowed.concat([currentHostname]))
      : allowed.filter((h) => h !== currentHostname);
    // mutua esclusione: "usa solo qui" rimuove dal blocco
    const nextBlocked = siteAllowed.checked ? list.filter((h) => h !== currentHostname) : list;
    chrome.storage.sync.set({ blockedHosts: nextBlocked, allowedHosts: nextAllowed });
  });
});

// ---------- caratteri cinesi (hanzi) ----------
chrome.storage.sync.get('hanzi', (data) => {
  hanziToggle.checked = !!data.hanzi;
});
hanziToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ hanzi: hanziToggle.checked }); // il content script propaga da solo
});

// ---------- verifica forma della frase ----------
chrome.storage.sync.get('grammar', (data) => {
  grammarToggle.checked = data.grammar !== false;
});
grammarToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ grammar: grammarToggle.checked });
});

// ---------- spazio dopo suggerimento ----------
chrome.storage.sync.get('spaceAfterAccept', (data) => {
  spaceToggle.checked = !!data.spaceAfterAccept;
});
spaceToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ spaceAfterAccept: spaceToggle.checked });
});

// ---------- traduzione su selezione ----------
chrome.storage.sync.get('translate', (data) => {
  translateToggle.checked = data.translate !== false;
});
translateToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ translate: translateToggle.checked });
});

// ---------- termini personalizzati ----------
const CT = window.PinynCustomTerms;
let customTerms = [];
let syllableSet = null;

fetch(chrome.runtime.getURL('data/pinyin-syllables.json'))
  .then((r) => (r.ok ? r.json() : Promise.reject()))
  .then((d) => { syllableSet = new Set(d.syllables); })
  .catch(() => {});

chrome.storage.local.get('customTerms', (data) => {
  customTerms = Array.isArray(data.customTerms) ? data.customTerms : [];
  renderTerms();
});

function saveTerms(next) {
  customTerms = next;
  chrome.storage.local.set({ customTerms });
  // mirror best-effort in storage.sync (quota limitata): sotto ~50KB
  const size = CT ? CT.sizeBytes(customTerms) : JSON.stringify(customTerms).length;
  if (size <= 50 * 1024) chrome.storage.sync.set({ customTerms });
  else chrome.storage.sync.remove('customTerms');
  renderTerms();
}

function renderTerms() {
  tList.innerHTML = '';
  if (!customTerms.length) {
    tList.innerHTML = '<li class="term-empty">Nessun termine personalizzato.</li>';
    return;
  }
  customTerms.forEach((t, i) => {
    const li = document.createElement('li');
    const info = document.createElement('span');
    info.className = 'term-info';
    info.textContent = t.hanzi + ' ' + t.pinyin + (t.gloss ? ' — ' + t.gloss : '') + (t.en ? '  [*' + t.en + ']' : '');
    const del = document.createElement('button');
    del.className = 'term-del';
    del.textContent = '✕';
    del.title = 'Rimuovi';
    del.addEventListener('click', () => saveTerms(customTerms.filter((_, j) => j !== i)));
    li.appendChild(info);
    li.appendChild(del);
    tList.appendChild(li);
  });
}

function addTerm() {
  const res = CT.validateTerm({ hanzi: tHanzi.value, pinyin: tPinyin.value, gloss: tGloss.value, en: tEn.value }, syllableSet);
  if (!res.ok) {
    tError.textContent = res.error;
    return;
  }
  tError.textContent = '';
  if (customTerms.some((t) => t.hanzi === res.value.hanzi)) {
    tError.textContent = 'Termine già presente.';
    return;
  }
  saveTerms(customTerms.concat([res.value]));
  tHanzi.value = tPinyin.value = tGloss.value = tEn.value = '';
  tHanzi.focus();
}
tAdd.addEventListener('click', addTerm);
[tHanzi, tPinyin, tGloss, tEn].forEach((el) => {
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') addTerm(); });
});

// ---------- dizionario ----------
// La ricerca chiede al content script della pagina attiva (dati già iniettati);
// niente fetch di hsk-3.0.json (2.7MB) a ogni apertura del popup.
function searchDict(q, limit, cb) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0] || tabs[0].id == null) { cb(null); return; }
    chrome.tabs.sendMessage(tabs[0].id, { type: 'PC_SEARCH_DICT', q, limit }, (res) => {
      if (chrome.runtime.lastError) { cb(null); return; }
      cb(res && res.results || null);
    });
  });
}

let timer = null;
searchInput.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(renderResults, 120);
});

// precompila la ricerca dalla selezione sulla pagina (se presente)
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (!tabs[0] || tabs[0].id == null) return;
  chrome.tabs.sendMessage(tabs[0].id, { type: 'PC_GET_SELECTION' }, (res) => {
    const sel = res && res.selection;
    if (sel && sel.trim() && !searchInput.value) {
      searchInput.value = sel.trim();
      renderResults();
    }
  });
});

function renderResults() {
  const q = searchInput.value;
  if (!q.trim()) {
    resultsEl.innerHTML = '';
    return;
  }
  searchDict(q.trim(), 20, (results) => {
    if (!results) {
      resultsEl.innerHTML = '<div class="no-results">Apri il dizionario su una pagina web.</div>';
      return;
    }
    if (!results.length) {
      resultsEl.innerHTML =
        '<div class="no-results">Nessun risultato</div>' +
        '<button class="add-from-search" id="add-from-search">Aggiungi come termine</button>';
      const btn = document.getElementById('add-from-search');
      btn.addEventListener('click', () => {
        if (/[\u3400-\u9fff]/.test(q)) tHanzi.value = q.trim();
        else tPinyin.value = q.trim();
        const sec = document.querySelector('.terms');
        if (sec) sec.scrollIntoView({ block: 'center' });
        (tHanzi.value ? tHanzi : tPinyin).focus();
      });
      return;
    }
    resultsEl.innerHTML = results.map(entryHtml).join('');
    resultsEl.querySelectorAll('[data-correct]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const word = btn.dataset.word || '';
        const pinyin = btn.dataset.pinyin || '';
        const gloss = btn.dataset.gloss || '';
        // se esiste già un termine con lo stesso hanzi, lo rimuove così
        // il salvataggio del valore corretto non trova duplicati
        const idx = customTerms.findIndex((t) => t.hanzi === word);
        if (idx >= 0) saveTerms(customTerms.filter((_, i) => i !== idx));
        tHanzi.value = word;
        tPinyin.value = pinyin;
        tGloss.value = gloss;
        tEn.value = '';
        tError.textContent = '';
        const sec = document.querySelector('.terms');
        if (sec) sec.scrollIntoView({ block: 'center' });
        tHanzi.focus();
      });
    });
  });
}

function entryHtml(r) {
  const lvl = r.level === 7.5 ? '7-9' : r.level;
  const pos = r.pos ? ' <span class="pos">' + escapeHtml(r.pos) + '</span>' : '';
  const defs = cleanDefs(r.definitions);
  const gloss = defs.text || (r.definitions && r.definitions[0]) || '';
  return (
    '<div class="entry">' +
    '<div class="entry-head">' +
    '<span class="hanzi">' + escapeHtml(r.word) + '</span>' +
    '<span class="pinyin">' + escapeHtml(r.pinyin) + '</span>' +
    '<span class="badge">L' + escapeHtml(String(lvl)) + '</span>' +
    '</div>' +
    '<div class="defs">' + escapeHtml(defs.text) + pos + (defs.extra ? ' <span class="more">+' + defs.extra + ' altre</span>' : '') + '</div>' +
    '<button class="entry-correct" data-correct="1" data-word="' + escapeHtml(r.word) + '" data-pinyin="' + escapeHtml(r.pinyin) + '" data-gloss="' + escapeHtml(gloss) + '">Correggi / override</button>' +
    '</div>'
  );
}

// gloss principale "pulito": la voce più corta e senza marcatori tecnici
function cleanDefs(definitions) {
  const bad = /^(CL:|.*(variant of|old variant|erhua form|also pr|surname)).*$/i;
  const clean = (definitions || []).filter((d) => !bad.test(d)).sort((a, b) => a.length - b.length);
  const text = clean[0] || (definitions && definitions[0]) || '';
  const extra = clean.length > 1 ? clean.length - 1 : (definitions && definitions.length ? definitions.length - 1 : 0);
  return { text, extra: extra > 0 ? extra : 0 };
}

// ---------- statistiche ----------
// I content script aggregano gli eventi in chrome.storage.local (`pcStats`);
// il popup li legge direttamente. Niente round-trip al service worker: in MV3
// il SW usa una partizione IndexedDB separata da quella dei content script,
// quindi leggere le statistiche lì restituirebbe sempre 0.
function renderStats() {
  chrome.storage.local.get('pcStats', (data) => {
    const d = data.pcStats || { corrections: 0, ignores: 0, accents: 0, levels: {} };
    document.getElementById('st-corr').textContent = String(d.corrections || 0);
    document.getElementById('st-ign').textContent = String(d.ignores || 0);
    document.getElementById('st-acc').textContent = String(d.accents || 0);
    const levels = document.getElementById('st-levels');
    const keys = Object.keys(d.levels || {}).sort((a, b) => Number(a) - Number(b));
    levels.innerHTML = keys.length
      ? keys.map((k) => '<span class="lvl">L' + k + ': ' + d.levels[k] + '</span>').join('')
      : '<span class="hint">Correggi qualcosa per vedere il progresso per livello.</span>';
  });
}

renderStats();

// ---------- supporto ----------
const support = document.getElementById('support');
const supportClose = document.getElementById('support-close');
chrome.storage.local.get('supportDismissed', (data) => {
  if (data.supportDismissed) support.hidden = true;
});
supportClose.addEventListener('click', () => {
  support.hidden = true;
  chrome.storage.local.set({ supportDismissed: true });
});
