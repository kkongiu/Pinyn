# Pinyn Desktop — Correzione pinyin in qualsiasi applicazione (idea)

Stato: idea / ragionamento — nessun impegno di pianificazione.
Scopo: correggere il pinyin scritto in qualunque app desktop (Word, email,
chat, terminali, editor non-browser), estendendo ciò che già fa l'estensione
solo nel browser. NON è un IME live.

## Concetto
Selezioni il testo → hotkey globale → anteprima della correzione → Applica/Annulla.

## Flusso utente (con conferma)
1. Premi la hotkey globale (es. Ctrl+Shift+P) con del pinyin selezionato.
2. L'app legge la selezione (accessibilità, con fallback clipboard).
3. Una piccola finestra mostra l'anteprima: accenti aggiunti, errori corretti,
   diff evidenziato, con azioni "Solo accenti / Accenti+fix / Converti in hanzi".
4. "Applica" → sostituisce la selezione; "Annulla" → non tocca nulla.

## Architettura
- Tauri (Rust): tray + finestra WebView + moduli nativi (hotkey, accessibilità,
  clipboard). Logica motore eseguita nel WebView (JS puro già pronto).
- Riuso del codice esistente (verificato):
  - src/utils/pinyin-utils.js, levenshtein.js, correction-engine.js
  - src/data/* (sillabe, HSK 3.0, defs, reverse, POS, reti toni/forma)
  - error-detector.js: scan/accentable su stringa
  - convertTonesIn/applyAccentsIn/applyHanziIn: accettano { value } → adattatore
- Non riusabile: tutta la UI browser (overlay/popup) → la sostituisce la UI Tauri.

## Seam: API pura fixText
Adattatore che espone, dal motore esistente:
  fixText(text, options) -> { accented, hanzi, corrections:[{start,end,from,to,level}] }
Unica refactor del codice attuale (piccola e a rischio minimo).

## Piattaforme e ordine
1. Linux (prototipo rapido; ambiente di sviluppo attuale)
2. macOS (accessibilità AX + notarizzazione)
3. Windows (UI Automation + code-signing)

## Accessi e permessi
- Hotkey globale: registrazione di sistema.
- Accessibilità: permesso richiesto dal sistema al primo avvio (macOS/Linux);
  va dichiarato nella scheda dell'app.
- Simulazione tasti (per il fallback clipboard).
- Nessun keylogging: l'app agisce solo a trigger esplicito.

## Fallback clipboard (semplice)
App che bloccano l'accessibilità: l'app simula Copia (Ctrl+C) → legge la
clipboard → corregge → reinserisce → simula Incolla (Ctrl+V). Universale ma
"sporca" la clipboard (mitigazione: salva/ripristina il contenuto precedente,
best-effort). Primaria = accessibilità; clipboard = piano B.

## Sforzo stimato
- Adattatore fixText + shell Tauri + tray + hotkey: giorni.
- Selezione/inserimento nativi per-OS: qualche giorno-settimana ciascuno.
- Packaging/firma (notarizzazione, code-signing): giorni + costi certificati.
- Totale MVP realistico: settimane, non mesi.

## Monetizzazione (accenno)
Prodotto desktop a pagamento naturale (una tantum/subscription); aggancia il
B2B universitario (laboratori). Non cannibalizza l'estensione (browser vs resto).

## Rischi / limiti
- Alcune app bloccano l'automazione (giochi, campi protetti) → clipboard aiuta ma non sempre.
- Il motore non è perfetto ("wo shi"→"卧室") → l'anteprima con conferma mitiga.
- Firma/distribuzione per-OS: tempo e certificati a pagamento.

## Fuori scope per ora
- IME live di sistema (Tier A) e integrazione librime: progetto pluriennale, solo se richiesto.
- Safari, mobile.

## Domande aperte (da riprendere)
- Hotkey di default e personalizzabile?
- Persistenza delle preferenze di azione predefinita?
- Tracciamento statistiche locale riusando stats.js?
- Vendita diretta vs open-source con tier a pagamento?
