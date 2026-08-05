// Service worker (MV3) — logica stabilita nelle fasi successive; per ora
// gestisce lo stato abilitato/disabilitato e pronto per la correzione.
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({ enabled: true });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'PC_SET_ENABLED') {
    sendResponse({ ok: true });
    return;
  }
});
