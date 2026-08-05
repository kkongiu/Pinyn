const enabled = document.getElementById('enabled');
const searchInput = document.getElementById('search');
const resultsEl = document.getElementById('results');
const hanziToggle = document.getElementById('hanzi');

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

// ---------- caratteri cinesi (hanzi) ----------
chrome.storage.sync.get('hanzi', (data) => {
  hanziToggle.checked = !!data.hanzi;
});
hanziToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ hanzi: hanziToggle.checked }); // il content script propaga da solo
});

// ---------- dizionario ----------
let index = null;

fetch(chrome.runtime.getURL('data/hsk-3.0.json'))
  .then((r) => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  })
  .then((data) => {
    index = PinynDict.buildIndex(data.words || []);
    searchInput.placeholder = 'Cerca: hanzi, pinyin, inglese…';
  })
  .catch(() => {
    resultsEl.innerHTML = '<div class="no-results">Dizionario non disponibile. Ricarica l\'estensione.</div>';
  });

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
  if (!q.trim() || !index) {
    resultsEl.innerHTML = '';
    return;
  }
  const res = PinynDict.search(q, index, 20);
  if (!res.length) {
    resultsEl.innerHTML = '<div class="no-results">Nessun risultato</div>';
    return;
  }
  resultsEl.innerHTML = res.map(entryHtml).join('');
}

function entryHtml(r) {
  const lvl = r.level === 7.5 ? '7-9' : r.level;
  const pos = r.pos ? ' <span class="pos">' + escapeHtml(r.pos) + '</span>' : '';
  const defs = cleanDefs(r.definitions);
  return (
    '<div class="entry">' +
    '<div class="entry-head">' +
    '<span class="hanzi">' + escapeHtml(r.word) + '</span>' +
    '<span class="pinyin">' + escapeHtml(r.pinyin) + '</span>' +
    '<span class="badge">L' + escapeHtml(String(lvl)) + '</span>' +
    '</div>' +
    '<div class="defs">' + escapeHtml(defs.text) + pos + (defs.extra ? ' <span class="more">+' + defs.extra + ' altre</span>' : '') + '</div>' +
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
function renderStats() {
  chrome.runtime.sendMessage({ type: 'PC_GET_STATS' }, (res) => {
    const d = (res && res.stats) || { corrections: 0, ignores: 0, accents: 0, levels: {} };
    document.getElementById('st-corr').textContent = String(d.corrections);
    document.getElementById('st-ign').textContent = String(d.ignores);
    document.getElementById('st-acc').textContent = String(d.accents);
    const levels = document.getElementById('st-levels');
    const keys = Object.keys(d.levels).sort((a, b) => Number(a) - Number(b));
    levels.innerHTML = keys.length
      ? keys.map((k) => '<span class="lvl">L' + k + ': ' + d.levels[k] + '</span>').join('')
      : '<span class="hint">Correggi qualcosa per vedere il progresso per livello.</span>';
  });
}

renderStats();
