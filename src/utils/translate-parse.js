/**
 * TranslateParse — estrae il testo tradotto dalla risposta JSON dell'endpoint
 * gratuito di Google Translate (translate.googleapis.com/translate_a/single).
 * Funzione pura, testabile in node. Espone globalmente `PinynTranslateParse`.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PinynTranslateParse = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * @param {string|object} input  testo JSON grezzo o oggetto già parsato
   * @returns {{ok:boolean, translation:string, lang:string}}
   */
  function parseGtx(input) {
    let data = input;
    if (typeof input === 'string') {
      try {
        data = JSON.parse(input);
      } catch (_) {
        return { ok: false, translation: '', lang: '' };
      }
    }
    if (!Array.isArray(data) || !Array.isArray(data[0])) {
      return { ok: false, translation: '', lang: '' };
    }
    let translation = '';
    for (const seg of data[0]) {
      if (Array.isArray(seg) && typeof seg[0] === 'string') translation += seg[0];
    }
    translation = translation.trim();
    if (!translation) return { ok: false, translation: '', lang: '' };
    let lang = '';
    if (typeof data[2] === 'string') lang = data[2];
    return { ok: true, translation: translation, lang: lang };
  }

  /**
   * @param {string} text  testo da tradurre
   * @param {string} targetLang  codice lingua di destinazione (es. "it")
   * @returns {string} URL dell'endpoint gtx
   */
  function buildUrl(text, targetLang) {
    const q = String(text || '').trim();
    const tl = /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(String(targetLang || '')) ? targetLang : 'it';
    const params = [
      'client=gtx',
      'sl=auto',
      'tl=' + encodeURIComponent(tl),
      'dt=t',
      'q=' + encodeURIComponent(q),
    ];
    return 'https://translate.googleapis.com/translate_a/single?' + params.join('&');
  }

  return { parseGtx: parseGtx, buildUrl: buildUrl };
});
