const level = document.getElementById('hsk-level');
const autoAccent = document.getElementById('auto-accent');

chrome.storage.sync.get({ hskLevel: 3, autoAccent: false }, (data) => {
  level.value = String(data.hskLevel || 3);
  autoAccent.checked = !!data.autoAccent;
});

level.addEventListener('change', () => {
  chrome.storage.sync.set({ hskLevel: Number(level.value) });
});

autoAccent.addEventListener('change', () => {
  chrome.storage.sync.set({ autoAccent: autoAccent.checked });
});
