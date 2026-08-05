# Rete neurale dei toni (on-device)

Piccola rete che predice i **toni** del pinyin usando il **contesto di frase**.
Risolve l'ambiguità dei toni (es. `wo` → `wǒ` vs `wò`, `xi huan` → `xǐhuan`)
dove l'euristica per-sillaba fallisce.

## Architettura

- **Ingresso**: finestra di ±5 sillabe **senza tono** (indici su vocabolario di ~450 sillabe)
- **Modello**: embedding (32) → FC 352→128 (ReLU) → FC 128→64 (ReLU) → 5 classi (neutro, 1-4)
- **Parametri**: ~70k
- **Runtime**: JS puro (forward ~30 righe) — nessuna dipendenza, nessun WASM

## Dati

- **Frasi**: Tatoeba cinese (CC-BY, ~88k frasi) → segmentazione longest-match su **CC-CEDICT**
- **Parole**: vocabolario HSK come sequenze brevi aggiuntive
- **Esempi**: ~200k (finestre con tono target), split 90/10

## Pipeline

```bash
# 1. dataset (Node, riusa CC-CEDICT in /tmp/opencode/cedict e Tatoeba in /tmp/opencode/cmn.tsv)
node scripts/build-tone-dataset.cjs      # -> ml/data/tone-data.json (gitignored)

# 2. addestramento (Python + NumPy)
python3 ml/train_tone_net.py --epochs 12 --batch 1024 --h1 128 --h2 64 --emb 32 --cap 180000
                                          # -> ml/export/tone-net.json (gitignored)

# 3. quantizzazione int8 + export finale
python3 ml/quantize_export.py             # -> src/data/tone-net.json (committato)
```

## Risultati

| Metodo | Accuratezza toni per sillaba |
|---|---|
| Euristica (frequenza pesata per livello) | ~19-73% (dipende dal dominio) |
| **Rete (int8)** | **~82%** |

Su frasi reali la rete segna **~88%** contro **~73%** dell'euristica.

## Integrazione

`src/llm/tone-net.js` carica `src/data/tone-net.json` (int8, ~215KB) **on demand** nel
content script. Il motore usa un **ibrido**: l'euristica se il tono dominante è affidabile
(share ≥ 65%), la rete se la sillaba è ambigua. Se il modello non si carica → fallback
completo all'euristica. Impostazione: "Rete neurale dei toni" (opzioni, default attivo).

## Note

- CC-CEDICT e Tatoeba sono sotto licenza CC-BY-SA / CC-BY (attribuzione richiesta).
- I dataset e i pesi fp32 intermedi sono rigenerabili e gitignored; il modello int8
  finale è committato in `src/data/tone-net.json`.
