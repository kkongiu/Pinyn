# Pinyn — Correzione pinyin contestuale

Estensione per browser (Chrome/Edge, Manifest V3) che **corregge il pinyin** cinese mentre scrivi e lo **converte in caratteri cinesi**. Pensata per chi studia il cinese (HSK 1–9).

## Funzionalità

- **Rilevamento e correzione errori**: sottolineatura rossa sui pinyin non validi, suggerimenti contestuali (distanza di edit, bigrammi, match a livello di parola).
- **Suggeritore IME-like**: mentre scrivi compare un menu sotto il cursore con varianti di tono, hanzi e traduzione; accetti con i tasti **1-9**, Enter/Tab, Esc.
- **Accenti automatici**: opzione per aggiungere i toni da solo (con pausa di digitazione); rete neurale on-device per i toni ambigui.
- **Reverse dizionario**: scrivi una parola inglese (`water`, `*want`) → propone l'equivalente cinese con pinyin e traduzione.
- **Conversione pinyin → caratteri**: opzione per inserire hanzi invece di pinyin all'accettazione, più azione batch "Converti in caratteri" sull'intero campo.
- **Dizionario nel popup**: cerca per hanzi, pinyin o inglese.
- **Lookup su selezione**: selezioni una parola nella pagina → tooltip con hanzi, pinyin, livello e traduzione.
- **Statistiche**: correzioni/ignorati/accenti per livello HSK.

## Architettura

```
src/
├── manifest.json            # MV3
├── background/              # service worker (stato, statistiche)
├── content/
│   ├── content-script.js    # orchestrazione (attach, osservatore, opzioni)
│   ├── error-detector.js    # rilevamento errori/toni sospetti
│   └── ui-renderer.js       # overlay + popup UNICO (suggerimenti/errori/lookup)
├── popup/                   # gadget: abilitato, hanzi, dizionario, statistiche
├── options/                 # impostazioni (auto-accenti, rete toni, hanzi, HSK)
├── database/                # IndexedDB (vocabolario, statistiche)
├── llm/
│   └── tone-net.js          # runtime JS della rete dei toni (int8)
├── utils/
│   ├── pinyin-utils.js      # tokenizer, toni (numeri<->diacritici)
│   ├── levenshtein.js       # distanza di edit con transposizione
│   ├── correction-engine.js # ranking contestuale, segmentazione, accenti, HSK
│   └── dict-search.js       # ricerca dizionario
└── data/
    ├── pinyin-syllables.js  # 444 sillabe valide
    ├── hsk-3.0.js           # vocabolario HSK 3.0 compatto (~11k parole)
    ├── hsk-defs.js          # traduzioni per lookup
    ├── hsk-reverse.js       # indice inverso inglese -> pinyin
    └── tone-net.json        # pesi della rete dei toni (int8, ~215KB)
```

## Il popup unico

Una sola superficie flottante con **stati mutualmente esclusivi** (mai sovrapposti):
1. **suggerimenti** (mentre scrivi, tasti 1-9)
2. **errori + azioni** (Ignora/Ok, Converti toni, Aggiungi accenti, Converti in caratteri)
3. **lookup** (selezione di testo nella pagina)

Priorità: suggerimenti > errori > lookup.

## Rete neurale dei toni (on-device)

Piccolo MLP a finestra di contesto (±5 sillabe) che predice i **toni** del pinyin, addestrato in **NumPy** (senza torch) su ~200k esempi da Tatoeba + CC-CEDICT. Esegue in **JS puro** (pesi int8, ~215KB), carico lazy con fallback all'euristica. Documentazione in `ml/README.md`.

## Dati

- **Vocabolario HSK 3.0**: ~11.000 parole (livelli 1–6 e 7–9) da `ivankra/hsk30` + supplemento (paesi, città, parole comuni mancanti).
- **Traduzioni**: CC-CEDICT (MDBG, licenza CC-BY-SA 4.0).
- **Frasi**: Tatoeba cinese (CC-BY) per l'addestramento.

I file dati sono **iniettati** nei content script (nessun fetch): caricamento completo e offline.

## Installazione

1. `chrome://extensions` → attiva **Modalità sviluppatore**
2. **Carica estensione non pacchettizzata** → seleziona `src/`
3. Testa su `tests/e2e/test-page.html` (o un server locale)

## Test

```bash
npm test               # unit (node:test)
npm run test:extended  # batteria + autotest sul corpus pinyin per livello
```

- **95 test unit** (tokenizer, toni, engine, reverse, defs, tone-net)
- **batteria** di robustezza (fuzz, performance, dataset)
- **autotest pinyin**: corpus per livello HSK (1–7/9) — 0 errori rossi, diagnostica dei toni sospetti

## Limiti noti

- La conversione **batch** pinyin→hanzi è basata su parole del dizionario: le frasi possono segmentarsi diversamente (es. `wo shi` → `卧室`, non `我是`). La via precisa è il menu candidati.
- I toni di una sillaba singola possono essere ambigui; la rete/euristica scelgono il più probabile, il menu permette di correggere.

## Licenza

Codice: uso personale/didattico. Dati di terze parti soggetti alle rispettive licenze (CC-CEDICT CC-BY-SA, Tatoeba CC-BY, ivankra/hsk30 MIT).
