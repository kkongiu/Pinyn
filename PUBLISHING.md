# Checklist: pubblicazione sul Chrome Web Store

Stato del progetto: funzionalità complete, test verdi, versione 0.15.0.
La pubblicazione su Google richiede i passi seguenti.

## 1. Account e pannello
- [ ] Registrarsi al [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) (una tantum, 5$).

## 2. Icone
- [x] Create le icone `16`, `32`, `48`, `128` in `src/icons/` e dichiarate nel `manifest.json` (`icons` + `action.default_icon`).
- [ ] Rigenerarle con un design definitivo se si vuole un'immagine custom.

## 3. Package / zip
- [x] `npm run package` → crea `dist/pinyin-corrector-<version>.zip` (contenuti di `src/`, manifest alla radice).
- [ ] Verificare che lo zip non contenga segreti/token.
- [ ] Testare lo zip **da pulito** (non dalla cartella già caricata in sviluppo).

## 4. Scheda pubblica (dev console)
- [ ] Nome, descrizione (inglese consigliato), categoria, età target.
- [ ] Descrizione (manifest, max 132 caratteri): *"Correzione pinyin contestuale e conversione in caratteri cinesi, per chi studia il cinese (HSK 1-9)."* — specifica il target (studenti di cinese) e i limiti HSK (1–9).
- [ ] Descrizione lunga della scheda: pubblico (studenti di cinese, livelli HSK 1–9) + funzioni principali (correzione toni/errori, conversione pinyin→hanzi, reverse dizionario, verifica forma frase, tutto locale) + gratuita/open-source con supporto.
- [ ] Screenshot (1280×800 o 640×400).
- [ ] Immagine promozionale.
- [ ] Link: sito di supporto.
- [ ] **Privacy policy**: pubblicata e linkata. Deve dichiarare:
  - i dati di digitazione/statistiche restano **locali** (IndexedDB/storage), nessun trasferimento;
  - la **traduzione su selezione** (opzionale, disattivabile) invia il testo selezionato (max 2000 caratteri, default 500) all'endpoint non ufficiale `translate.googleapis.com` (Google Translate).

## 5. Privacy & dati (dichiarazioni nel form)
- [ ] Correzione pinyin, conversione, reverse e statistiche: tutto **locale**, nessun trasferimento.
- [ ] Traduzione: **solo se abilitata**, il testo selezionato viene inviato a Google Translate.
- [ ] Dichiarare **single purpose** ("correzione pinyin e conversione in caratteri cinesi"); la traduzione è una funzione accessoria coerente.

## 6. Licenze e attribuzioni
- [ ] CC-CEDICT (CC-BY-SA 4.0) e Tatoeba (CC-BY): attribuzione visibile nella scheda/README pubblico.

## 7. Verifiche tecniche pre-submit
- [ ] `version` in `manifest.json` semver valido (ok: 0.15.0).
- [ ] Permessi minimi: `storage` + `host_permissions` solo per `https://translate.googleapis.com/*` (traduzione) — motivare nella scheda.
- [ ] Nessun codice remoto / eval — ok (CSP MV3).
- [ ] (Raccomandato) `_locales/` + `default_locale` per localizzare nome/descrizione.

## 8. Dopo la submission
- [ ] Inviare e attendere la review di Google (giorni/settimane).
- [ ] Rispondere a eventuali richieste della review.
