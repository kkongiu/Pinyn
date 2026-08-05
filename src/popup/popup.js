const enabled = document.getElementById('enabled');

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
