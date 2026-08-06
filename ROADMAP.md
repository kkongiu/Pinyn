# Roadmap — idee future (non implementate)

Priorità e idee non ancora sviluppate. La pubblicazione sul Chrome Web Store è
in `PUBLISHING.md` (checklist).

## 1. Contributi democratici al database

Gli utenti suggeriscono correzioni al dizionario; se il punteggio è alto e la
validazione passa, la modifica diventa automaticamente disponibile per tutti.

> **Stato**: solo spec. Non implementata (cambia architettura: da on-device a client-server).

### Flusso
1. Popup: bottone **"Suggerisci alla community"** accanto ad "Aggiungi/Correggi" (stessi campi: hanzi/pinyin/gloss/en).
2. Il suggerimento va al backend come `pending`.
3. Voti ▲/▼ nel popup, **con account Google (OAuth)** — un voto per utente (anti voti fake).
4. **Soglia**: `up >= 10 AND ratio >= 80%` → status `candidate` (finestra di moderazione ~48h).
5. **Validazione finale con LLM** (chiamata API lato backend, es. OpenAI/Claude): sillabe/toni coerenti, gloss sensata, contenuto non offensivo → `approved`/`rejected`. Costo ~centesimi per voce.
6. **Auto-merge totale**: approvata → inclusa in `community-data.json`.
7. **Rollout per tutti**: il content script scarica periodicamente `community-data.json` (pochi KB) e lo fonde nel runtime (engine/defs/reverse) — stesso meccanismo di `custom-terms.js`, in sola lettura.

### Architettura
- **Backend**: Supabase/Firebase (free tier) + API.
- **Modello dati**:
  ```
  suggestions: { id, hanzi, pinyin, gloss, en, pos,
                 status: pending|candidate|approved|rejected|merged,
                 up, down, score, llm_verdict, created_at }
  votes:       { id, suggestion_id, user_id(google), value: ±1 }
  ```

### Impatto sull'estensione (quando si farà)
- `host_permissions: ["https://api-….supabase.co/*"]` + fetch → **cambio privacy**: va dichiarato al CWS ("suggerimenti inviati al server, voti con account Google").
- Nuove azioni popup: suggerisci / vota / lista community.
- `custom-terms.js` esteso: merge runtime dei termini community in sola lettura.

### Bloccanti / rischi da risolvere all'implementazione
- Privacy policy aggiornata + disclosure CWS (la review può rallentare).
- Budget e rate-limit dell'LLM.
- Moderazione residua: l'LLM è il safety valve; serve un fallback umano per i contenuti abusivi.
- I termini approvati vanno anche "cotti" in `hsk-3.0.js` a ogni release.

### Alternative scartate
- **GitHub-driven** (issue/PR + reazioni): niente backend ma non automatico.
- **Anonimo per dispositivo**: semplice ma vulnerabile ai voti fake.
- **VPS self-hosted**: pieno controllo ma manutenzione (deploy, backup, sicurezza).

## 2. Altre idee minori

- **Formato array compatto** per i dati iniettati (`{w,p,l}` → `[w,p,l]`): −~22% sul payload (~290KB totali). Rifattorizzazione meccanica del codice che legge `w.w/p/l`.
- **Icone dell'estensione** (16/32/48/128) + dichiarazione nel manifest (bloccante per la pubblicazione, vedi `PUBLISHING.md`).
- **Accentuazione dei termini personali senza toni**: inferire i toni automaticamente all'aggiunta (oggi richiedono i toni nel form, es. `la1 mian4`).
