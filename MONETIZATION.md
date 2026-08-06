# MONETIZATION — Piani di monetizzazione

Stato: v0.15.0, gratuito, in preparazione per il Chrome Web Store.
Principio guida: **mai paywalling del core** (correzione, menu candidati,
lookup, accenti) e **nessuna pubblicità** — la privacy locale è l'asset di
fiducia del prodotto.

## Roadmap in fasi

| Fase | Modello | Quando | ROI atteso |
|---|---|---|---|
| 0 | Donazioni / Sponsorware (Ko-fi, GitHub Sponsors) | Subito (pubblicazione store) | Basso, zero rischio |
| 1 | Freemium "Pro" (pagamento unico, chiave licenza) | ~1k utenti attivi | Medio |
| 2 | Abbonamento "Cloud" (ricorrente) | Trazione consolidata | Medio-alto |
| 3 | Licenze B2B / università | Esperimento con 1 pilota | Alto ma lento |

## Fase 0 — Donazioni (implementata)

Nessun feature gating. Solo rimuovere la frizione per chi vuole sostenere:

- Bottone in evidenza "☕ qǐng wǒ hē kāfēi 请我喝咖啡" in cima al popup (subito
  sotto l'intestazione) → **PayPal** con importo suggerito 3€
  (`paypal.me/kkongiu/3`, modificabile dall'utente), chiudibile (dismiss
  persistito in `storage.local`, chiave `supportDismissed`).
- Sezione "Supporto" nelle opzioni con il link PayPal.
- Paragrafo "Supporto" nel README.

## Fase 1 — Freemium Pro

Vendita **fuori dal CWS** (Gumroad / Lemon Squeezy + chiave licenza incollata
nelle opzioni): Google non offre trial in-store, prende il 5% e ha limiti per
paese; le estensioni "free" girano meglio. La chiave va validata (HMAC o
servizio esterno), lo stato salvato in `storage.local`, feature flag locali
(niente codice remoto, MV3-safe). La verifica della licenza non deve mai
bloccare le funzioni gratuite se offline.

- **Free:** correzione, menu suggeritori, lookup, accenti, reverse base,
  termini personalizzati (limite ~50).
- **Pro (~€10–15 una tantum):** LM verifica forma frase, conversione batch,
  termini illimitati, dizionario completo offline, export statistiche (JSON),
  reverse avanzato con frasi d'esempio.

## Fase 2 — Abbonamento Cloud (~€2–3/mese)

Servizi con costo reale che giustificano il ricorrente:

- Sync multi-dispositivo di termini e statistiche.
- Quota di **traduzione via API ufficiale** (oggi l'endpoint gtx non ufficiale
  è gratuito e a rischio stabilità).
- Spiegazioni grammaticali AI sulla selezione (costo per chiamata).

Richiede un piccolo backend; MV3 consente chiamate a API esterne senza violare
il "no remote code".

## Fase 3 — B2B / università (analisi dei rischi)

### La proposta: "build scolastica + dashboard docente"

Un correttore pinyin non è un motivo per cui un'istituzione paga. La value
proposition istituzionale è la **dashboard docente**: un pannello web separato
(non il popup) dove il professore vede l'attività di apprendimento dei suoi
studenti.

**Cosa mostra** (derivato dai dati che l'estensione già registra localmente):
- Attività per classe: correzioni/ignorati/accenti per livello HSK nel tempo.
- Per studente (pseudonimizzato): chi pratica, quante parole corregge,
  progressione.
- **Analisi degli errori** (il vero valore): "la classe confonde `si`→`shi`",
  "confusione di tono sulle parole livello 2". I dati `token`+`suggestion`
  registrati per evento rendono possibile aggregare i refusi più comuni.
- Export CSV/PDF dei report.

**Cosa richiede** (cambiamento di architettura, non un toggle):
- Attribuzione per studente (codice classe → attivazione della build scolastica).
- **Consenso esplicito + opt-in** (GDPR): minimizzazione dati, mai testo
  intero, solo token/errori pseudonimizzati.
- Sync a un backend e aggregazione server.
- La versione consumer resta 100% locale: la build scolastica è un artefatto
  separato e documentato.

### Matrice dei rischi

| # | Rischio | Gravità | Prob. | Mitigazione |
|---|---|---|---|---|
| 1 | Le università comprano corsi, non estensioni | Alta | Alta | Vendere il pacchetto "dashboard + build scolastica", non il correttore |
| 2 | Ciclo di vendita universitario = mesi; costo opportunità per un solo sviluppatore | Alta | Alta | Non inseguirla subito; un **pilota pro-bono** con 1 università prima di vendere |
| 3 | Endpoint non ufficiale `translate.googleapis.com` = red flag in procurement | Alta | Alta | Build scolastica **strict local-only**: traduzione rimossa/irreversibilmente disattivata, con attestazione |
| 4 | Licenze dati commerciali: CC-CEDICT (CC-BY-SA) e Tatoeba (CC-BY) permettono redistribuzione commerciale con attribuzione e obblighi share-alike | Alta | Media | Verifica dei termini Tatoeba; attribuzione nella build commerciale; in caso di dubbio escludere contenuti dal tier |
| 5 | Enforcement licenza: MV3 on-device, campus offline, chiave condivisibile | Media | Alta | **Licenza per sede** (annuale), non per-seat; validazione server con periodo di grazia offline; il cracking determinato non si ferma → prezzo commisurato |
| 6 | Fatturazione/procurement: PO, e-invoice, IVA intra-UE | Media | Media | Payment processor come **merchant of record** (Lemon Squeezy/Paddle) |
| 7 | Supporto/SLA: onboarding, formazione docenti, ticket garantiti | Media | Media | Solo supporto best-effort documentato, niente SLA contrattuali (specificarlo) |
| 8 | Dipartimenti di cinese piccoli, budget limitato | Alta | Alta | Prezzo contenuto (€300–600/anno per sede), volume ≠ ma margine per l'ateneo |

### Verdetto
Redditizio ma lento e costoso in tempo. Consigliato come **esperimento** dopo
la trazione consumer, con un solo pilota, e solo se si è disposti a gestire
un minimo di supporto istituzionale. La dashboard docente è ciò che si vende;
la correzione pinyin è solo il veicolo.

## Affiliate (opzionale, non prioritario)

Link a dizionari online / Anki / materiali nel tooltip di lookup, **opzionale e
disattivabile** (default off), per non tradire la promessa "no ads". ROI basso.

## Regole trasversali

- Il core resta gratuito: le recensioni del CWS sono l'asset di crescita.
- Ogni tier a pagamento deve preservare la privacy locale o dichiararla
  chiaramente (es. trasmissione dati nel Cloud).
- Donazione/link mai invasivi: banner dismissibile, niente interstitial.
- Prezzi in EUR/USD, fatture gestite dal merchant of record.
