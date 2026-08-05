# Checklist: pubblicazione sul Chrome Web Store

Stato del progetto: funzionalità complete, test verdi, versione 0.11.0.
La pubblicazione su Google richiede i passi seguenti.

## 1. Account e pannello
- [ ] Registrarsi al [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) (una tantum, 5$).

## 2. Icone (mancano)
- [ ] Creare le icone `16`, `32`, `48`, `128` (es. `src/icons/icon16.png` … `icon128.png`).
- [ ] Dichiararle nel `manifest.json` (`icons` + `action.default_icon`).

## 3. Package / zip
- [ ] Creare uno **zip dei contenuti di `src/`** (il manifest deve essere alla radice dello zip).
- [ ] Escludere da `src/`: `README`, `tests/`, `scripts/`, `ml/`, `.git*`, eventuali file privati.
- [ ] Verificare che lo zip non contenga segreti/token.
- [ ] Testare lo zip **da pulito** (non dalla cartella già caricata in sviluppo).

## 4. Scheda pubblica (dev console)
- [ ] Nome, descrizione (inglese consigliato), categoria, età target.
- [ ] Screenshot (1280×800 o 640×400).
- [ ] Immagine promozionale.
- [ ] Link: sito di supporto.
- [ ] **Privacy policy**: anche minima — "tutto on-device, nessun dato inviato" — pubblicata e linkata.

## 5. Privacy & dati (dichiarazioni nel form)
- [ ] Dichiarare le pratiche di raccolta: i dati (testo digitato, statistiche) restano **locali** (IndexedDB); nessun trasferimento.
- [ ] Dichiarare **single purpose** ("correzione pinyin e conversione in caratteri cinesi"); reverse/lookup/stats sono coerenti.

## 6. Licenze e attribuzioni
- [ ] CC-CEDICT (CC-BY-SA 4.0) e Tatoeba (CC-BY): attribuzione visibile nella scheda/README pubblico.

## 7. Verifiche tecniche pre-submit
- [ ] `version` in `manifest.json` semver valido (ok: 0.11.0).
- [ ] Permessi minimi (solo `storage`) — ok.
- [ ] Nessun codice remoto / eval — ok (CSP MV3).
- [ ] (Raccomandato) `_locales/` + `default_locale` per localizzare nome/descrizione.

## 8. Dopo la submission
- [ ] Inviare e attendere la review di Google (giorni/settimane).
- [ ] Rispondere a eventuali richieste della review.
