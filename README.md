# Pinyn — Correzione pinyin contestuale

Estensione per browser (Chrome/Edge, Manifest V3) che **corregge il pinyin** cinese mentre scrivi e lo **converte in caratteri cinesi**. Pensata per chi studia il cinese (HSK 1–9).

## Funzionalità

- **Rilevamento e correzione errori**: sottolineatura rossa sui pinyin non validi, suggerimenti contestuali (distanza di edit, bigrammi, match a livello di parola).
- **Suggeritore IME-like**: mentre scrivi compare un menu sotto il cursore con varianti di tono, hanzi e traduzione; accetti con i tasti **1-9**, Enter/Tab, Esc.
- **Accenti automatici**: opzione per aggiungere i toni da solo (con pausa di digitazione); rete neurale on-device per i toni ambigui.
- **Reverse dizionario**: scrivi una parola inglese (`water`, `*want`) → propone l'equivalente cinese con pinyin e traduzione.
- **Conversione pinyin → caratteri**: opzione per inserire hanzi invece di pinyin all'accettazione, più azione batch "Converti in caratteri" sull'intero campo.
- **Verifica forma della frase**: regole grammaticali precise (很+nome, 是+verbo, 吗 non finale) + LM probabilistico che segnala le frasi dalla forma insolita; attivabile dal gadget e dalle opzioni.
- **Termini personalizzati**: aggiungi parole mancanti dal dizionario dal popup (hanzi, pinyin anche compatto es. `moka`, traduzione, inglese opzionale per il reverse `*parola`); vengono riconosciute in pagina, ricercabili e sincronizzate (local + mirror in sync).
- **Spazio dopo suggerimento**: opzione attivabile (gadget e opzioni) che aggiunge uno spazio dopo il pinyin/hanzi accettato dal menu.
- **Dizionario nel popup**: cerca per hanzi, pinyin o inglese.
- **Lookup su selezione**: selezioni una parola nella pagina → tooltip con hanzi, pinyin, livello e traduzione.
- **Traduzione su selezione**: il testo selezionato viene tradotto via Google (endpoint opzionale, disattivabile). Se è **pinyin**, viene prima convertito in hanzi ("ni hao" → 你好 → "ciao") così la traduzione funziona anche senza caratteri.
- **Siti esclusi / usa solo qui**: dal popup "Non usare in questa pagina" o "Usa solo in questa pagina" (gestibili anche dalle opzioni) controlli su quali siti l'estensione è attiva, per non disturbare quando non studi. Vale **a livello di dominio** (es. "example.com" copre anche `www.` e i sottodomini), quindi resta valido cambiando pagina. L'interruttore "Abilitato" resta il master switch globale.
- **Statistiche**: correzioni/ignorati/accenti per livello HSK.

## Architettura

```
src/
├── manifest.json            # MV3
├── background/              # service worker (stato, traduzione)
├── content/
│   ├── content-script.js    # orchestrazione (attach, osservatore, opzioni, statistiche)
│   ├── error-detector.js    # rilevamento errori/toni sospetti
│   └── ui-renderer.js       # overlay + popup UNICO (suggerimenti/errori/lookup)
├── popup/                   # gadget: abilitato, hanzi, dizionario, statistiche
├── options/                 # impostazioni (auto-accenti, rete toni, hanzi, HSK)
├── database/                # IndexedDB (vocabolario; statistiche in chrome.storage.local)
├── llm/
│   ├── tone-net.js          # runtime JS della rete dei toni (int8)
│   └── sentence-net.js      # runtime JS del LM di forma (int8, lazy)
├── utils/
│   ├── pinyin-utils.js      # tokenizer, toni (numeri<->diacritici)
│   ├── levenshtein.js       # distanza di edit con transposizione
│   ├── correction-engine.js # ranking contestuale, segmentazione, accenti, HSK
│   ├── grammar-rules.js     # regole grammaticali (POS, conservative)
│   ├── custom-terms.js      # dizionario utente (convalida + applicazione)
│   ├── stats.js             # aggregazione statistiche (chrome.storage.local)
│   └── dict-search.js       # ricerca dizionario
└── data/
    ├── pinyin-syllables.js  # 444 sillabe valide
    ├── hsk-3.0.js           # vocabolario HSK 3.0 compatto (~11k parole)
    ├── hsk-defs.js          # traduzioni per lookup
    ├── hsk-reverse.js       # indice inverso inglese -> pinyin (lazy)
    ├── hsk-pos.js           # POS (regole grammaticali) (lazy)
    ├── tone-net.json        # pesi della rete dei toni (int8, ~215KB, lazy)
    └── sentence-net.json    # pesi del LM di forma (int8, ~1.4MB, lazy)
```

## Il popup unico

Una sola superficie flottante con **stati mutualmente esclusivi** (mai sovrapposti):
1. **suggerimenti** (mentre scrivi, tasti 1-9)
2. **errori + azioni** (Ignora/Ok, Converti toni, Aggiungi accenti, Converti in caratteri)
3. **lookup** (selezione di testo nella pagina)

Priorità: suggerimenti > errori > lookup.

Quando la **verifica forma della frase** è attiva (gadget e opzioni), il popup mostra un blocco **Forma**: alcune regole grammaticali precise (很+nome, 是+verbo, 吗 a fine frase) e, per le frasi lunghe, un avviso probabilistico (LM di forma) quando la sequenza di parole è insolita.

## Verifica forma della frase

Due segnali indipendenti (attivabili insieme):
- **Regole grammaticali** (molto conservative): solo POS non ambiguo del dataset HSK, coprono gli errori più comuni con messaggi specifici.
- **LM di forma**: MLP a finestra (embedding + hidden + softmax su ~3k parole) che predice la parola successiva; addestrato in NumPy su ~500k finestre da Tatoeba. Esegue in JS puro (pesi int8, ~1.4MB), carico lazy. Media di `-log P` alta = frase insolita (segnalata solo per frasi ≥5 parole, soglia conservativa).

## Rete neurale dei toni (on-device)

Piccolo MLP a finestra di contesto (±5 sillabe) che predice i **toni** del pinyin, addestrato in **NumPy** (senza torch) su ~200k esempi da Tatoeba + CC-CEDICT. Esegue in **JS puro** (pesi int8, ~215KB), carico lazy con fallback all'euristica. Documentazione in `ml/README.md`.

## Dati

- **Vocabolario HSK 3.0**: ~11.000 parole (livelli 1–6 e 7–9) da `ivankra/hsk30` + supplemento (paesi, città, parole comuni mancanti).
- **Traduzioni**: CC-CEDICT (MDBG, licenza CC-BY-SA 4.0).
- **Frasi**: Tatoeba cinese (CC-BY) per l'addestramento.

I file dati di uso frequente sono **iniettati** nei content script (caricamento completo e offline); reverse, POS e i modelli ML vengono caricati **lazy** (risorse dell'estensione) dopo il caricamento della pagina.

## Installazione

1. `chrome://extensions` → attiva **Modalità sviluppatore**
2. **Carica estensione non pacchettizzata** → seleziona `src/`
3. Testa su `tests/e2e/test-page.html` (o un server locale)

## Test

```bash
npm test               # unit (node:test)
npm run test:extended  # batteria + autotest sul corpus pinyin per livello
```

- **135 test unit** (tokenizer, toni, engine, reverse, defs, tone-net, regole grammaticali, LM di forma, termini personalizzati, statistiche)
- **batteria** di robustezza (fuzz, performance, dataset)
- **autotest pinyin**: corpus per livello HSK (1–7/9) — 0 errori rossi, diagnostica dei toni sospetti

## Limiti noti

- La conversione **batch** pinyin→hanzi è basata su parole del dizionario: le frasi possono segmentarsi diversamente (es. `wo shi` → `卧室`, non `我是`). La via precisa è il menu candidati.
- I toni di una sillaba singola possono essere ambigui; la rete/euristica scelgono il più probabile, il menu permette di correggere.
- La verifica di forma è **soft**: le regole coprono solo i 3 errori più comuni e il LM segnala la probabilità bassa (non un errore certo); su frasi corte il LM non viene valutato.

## Supporto

Pinyn è gratuito e open-source. Se ti è utile e vuoi sostenere lo sviluppo, puoi offrirmi un caffè (3€): [paypal.me/kkongiu/3](https://paypal.me/kkongiu/3).

## Licenza

Codice: MIT (vedi `LICENSE`). Dati di terze parti soggetti alle rispettive licenze (CC-CEDICT CC-BY-SA, Tatoeba CC-BY, ivankra/hsk30 MIT). Il repository diventa pubblico al lancio sul Web Store; il codice client è comunque già distribuibile, mentre i servizi a pagamento (cloud, dashboard) restano server-side e privati.
