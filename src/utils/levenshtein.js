/**
 * Levenshtein — distanza di edit con costi opzionali.
 * Costo di default per scambio di lettere adiacenti = 1 (più realistico per
 * errori di tastiera rispetto a un inserimento+omissione = 2).
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.PinynLevenshtein = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function distance(a, b, options) {
    options = options || {};
    const swapCost = options.swapCost == null ? 1 : options.swapCost;
    const insertCost = options.insertCost == null ? 1 : options.insertCost;
    const deleteCost = options.deleteCost == null ? 1 : options.deleteCost;
    const substituteCost = options.substituteCost == null ? 1 : options.substituteCost;

    const n = a.length;
    const m = b.length;
    if (n === 0) return m * insertCost;
    if (m === 0) return n * deleteCost;

    // dp[i][j]
    const dp = new Array(n + 1);
    for (let i = 0; i <= n; i++) {
      dp[i] = new Array(m + 1);
      dp[i][0] = i * deleteCost;
    }
    for (let j = 0; j <= m; j++) dp[0][j] = j * insertCost;

    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : substituteCost;
        dp[i][j] = Math.min(
          dp[i - 1][j] + deleteCost,
          dp[i][j - 1] + insertCost,
          dp[i - 1][j - 1] + cost
        );
        // scambio di caratteri adiacenti
        if (
          i > 1 && j > 1 &&
          a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]
        ) {
          dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + swapCost);
        }
      }
    }
    return dp[n][m];
  }

  return { distance };
});
