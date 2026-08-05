/**
 * ToneNet — rete neurale per i toni del pinyin, eseguita in JS puro.
 *
 * Modello: MLP a finestra di contesto (embedding + 2 hidden + softmax),
 * addestrato offline e quantizzato in int8 (vedi ml/).
 *
 * Caricamento lazy di src/data/tone-net.json (int8, ~200KB) con
 * dequantizzazione in Float32Array. Se il caricamento fallisce, ritorna
 * null (il chiamante usa il fallback euristico).
 *
 * Espone globalmente `PinynToneNet`.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.PinynToneNet = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  let cachePromise = null;

  function defaultUrl() {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      return chrome.runtime.getURL('data/tone-net.json');
    }
    return null;
  }

  function dequantize(v, s, perRow, d) {
    const n = v.length;
    const out = new Float32Array(n);
    if (perRow) {
      for (let r = 0; r < s.length; r++) {
        const sc = s[r];
        const base = r * d;
        for (let j = 0; j < d; j++) out[base + j] = v[base + j] * sc;
      }
    } else {
      for (let i = 0; i < n; i++) out[i] = v[i] * s;
    }
    return out;
  }

  /** @returns {Promise<object|null>} modello dequantizzato o null */
  function loadToneNet(url) {
    url = url || defaultUrl();
    if (!url) return Promise.resolve(null);
    if (cachePromise) return cachePromise;
    cachePromise = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then((m) => build(m))
      .catch(() => null);
    return cachePromise;
  }

  function build(m) {
    const V = m.vocab.length;
    const EMB = m.emb_dim;
    return {
      N: m.N,
      vocab: m.vocab,
      vocabIndex: (function () {
        const map = new Map();
        m.vocab.forEach((s, i) => map.set(s, i));
        return map;
      })(),
      EMB,
      H1: m.h1,
      H2: m.h2,
      E: dequantize(m.E.v, m.E.s, true, EMB),
      W1: dequantize(m.W1.v, m.W1.s, false, 0),
      W2: dequantize(m.W2.v, m.W2.s, false, 0),
      W3: dequantize(m.W3.v, m.W3.s, false, 0),
      b1: Float32Array.from(m.b1),
      b2: Float32Array.from(m.b2),
      b3: Float32Array.from(m.b3),
    };
  }

  /** Forward di un singolo esempio (array di indici, lunghezza 2N+1). */
  function forwardOne(model, X) {
    const L = 2 * model.N + 1;
    const EMB = model.EMB;
    const H1 = model.H1;
    const H2 = model.H2;

    const x = new Float32Array(L * EMB);
    for (let i = 0; i < L; i++) {
      const row = X[i] * EMB;
      for (let j = 0; j < EMB; j++) x[i * EMB + j] = model.E[row + j];
    }

    const h1 = new Float32Array(H1);
    for (let j = 0; j < H1; j++) {
      let s = model.b1[j];
      for (let k = 0; k < L * EMB; k++) s += x[k] * model.W1[k * H1 + j];
      h1[j] = s > 0 ? s : 0;
    }

    const h2 = new Float32Array(H2);
    for (let j = 0; j < H2; j++) {
      let s = model.b2[j];
      for (let k = 0; k < H1; k++) s += h1[k] * model.W2[k * H2 + j];
      h2[j] = s > 0 ? s : 0;
    }

    let best = 0;
    let bestV = -Infinity;
    for (let j = 0; j < 5; j++) {
      let s = model.b3[j];
      for (let k = 0; k < H2; k++) s += h2[k] * model.W3[k * 5 + j];
      if (s > bestV) { bestV = s; best = j; }
    }
    return best;
  }

  /**
   * Predice i toni (0=neutro, 1-4) per ogni sillaba BARE della sequenza.
   * @param {object} model
   * @param {string[]} syllables sillabe senza tono
   * @returns {Int8Array} toni, lunghezza == syllables.length
   */
  function predictTones(model, syllables) {
    const N = model.N;
    const L = 2 * N + 1;
    const idx = new Int32Array(syllables.length);
    for (let i = 0; i < syllables.length; i++) {
      const v = model.vocabIndex.get(syllables[i]);
      idx[i] = v == null ? 0 : v; // 0 = pad/unknown
    }
    const tones = new Int8Array(syllables.length);
    const X = new Int32Array(L);
    for (let p = 0; p < syllables.length; p++) {
      for (let k = -N; k <= N; k++) {
        const q = p + k;
        X[k + N] = (q >= 0 && q < syllables.length) ? idx[q] : 0;
      }
      tones[p] = forwardOne(model, X);
    }
    return tones;
  }

  return { loadToneNet, predictTones, forwardOne, build };
});
