# PROGETTO: Correzione Pinyin Contestuale e Conversione in Caratteri Cinesi

## 1. DESCRIZIONE GENERALE
Sviluppare un'estensione per browser (Chrome/Edge) che funzioni come un correttore ortografico intelligente per il pinyin (sistema di romanizzazione del cinese mandarino). L'estensione deve:
- Rilevare errori di battitura nel pinyin (es. "ni ao" → "nǐ hǎo")
- Evidenziare toni sbagliati (es. "ni3 hao3" invece di "ni3 hao3" con i toni corretti)
- Permettere la conversione del pinyin corretto in caratteri cinesi (hanzi) su richiesta
- Essere modulare per livelli HSK (1-9), adattando il vocabolario al livello dello studente

## 2. ARCHITETTURA TECNICA
### 2.1 Struttura dell'Estensione
- Manifest V3 per Chrome/Edge
- Content script per interagire con le pagine web (textarea, input, contenteditable)
- Background service worker per la logica di correzione
- Options page per le impostazioni utente (selezione livello HSK, attivazione/disattivazione)

### 2.2 Componenti Principali
#### A. Modulo di Rilevamento Errori
- Scannerizza il testo mentre l'utente digita
- Rileva sillabe pinyin non valide (es. "ao" non è una sillaba completa)
- Rileva errori di battitura comuni:
  - Inversioni di lettere (es. "hkao" → "hao")
  - Sostituzioni (es. "ni" → "nei" in contesto errato)
  - Inserzioni/omissioni (es. "nihao" → "ni hao")
- Utilizza un dizionario di sillabe pinyin valide e relative combinazioni

#### B. Modulo di Correzione Contestuale (CUORE DEL SISTEMA)
Questo è il componente più importante. Deve essere in grado di:
- Correggere "ni ao" → "nǐ hǎo" capendo il contesto della frase
- Suggerire la correzione basandosi sul livello HSK selezionato
- Offrire 3 modalità di funzionamento:

**Modalità 1: Tradizionale (Dizionario + Regole)**
- Usa un dizionario locale di sillabe pinyin valide
- Implementa regole scritte a mano per errori comuni
- Veloce, offline, privacy totale
- Limite: meno efficace su errori complessi

**Modalità 2: LLM Locale (Proofreader API di Chrome)**
- Usa Gemini Nano integrato in Chrome (se disponibile)
- Correzione contestuale avanzata
- Offline (dopo il download del modello)
- Requisiti: 16+ GB RAM, 22+ GB spazio libero

**Modalità 3: LLM Esterno (API)**
- Supporta OpenAI (GPT-4), Anthropic (Claude), Google (Gemini)
- Massima qualità di correzione
- Richiede chiave API e connessione internet
- Opzionale, per utenti avanzati

#### C. Modulo HSK (Gestione del Vocabolario)
- Database del vocabolario HSK 3.0 (livelli 1-9)
- Ogni parola deve avere: caratteri cinesi, pinyin (con toni), livello HSK, definizione
- Filtra le correzioni in base al livello selezionato
- Opzione "Mostra parole fuori livello" (avvisa ma non corregge automaticamente)
- Funzione di suggerimento graduale: suggerisce la parola corretta solo se il livello è ≤ livello selezionato + 1 (per permettere apprendimento)

#### D. Modulo di Conversione Pinyin → Caratteri
- Converte il pinyin corretto in caratteri cinesi
- Gestisce le ambiguità (es. "shi" → 是/时/事) mostrando un menu di selezione
- Implementa un dizionario di conversione con le parole più comuni per livello
- Include eccezioni e parole polisemiche (es. 行 → háng/xíng)

#### E. Modulo UI/UX
- Evidenziazione degli errori in tempo reale (sottolineatura rossa per errori, gialla per toni)
- Tooltip con suggerimenti al passaggio del mouse
- Pulsanti contestuali: "Correggi", "Converti in caratteri", "Ignora"
- Barra laterale o popup con statistiche: errori commessi, livello di competenza

### 3. FLUSSO DI LAVORO DETTAGLIATO
