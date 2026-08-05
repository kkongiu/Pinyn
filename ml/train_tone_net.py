#!/usr/bin/env python3
"""
Addestra la rete dei toni (MLP a finestra di contesto) in puro NumPy.

Modello:
  input   : finestra di 2N+1 indici di sillaba (senza tono)
  embedding: vocab x d
  FC1(relu), FC2(relu), out(5 classi: neutro,1,2,3,4)

Output: ml/export/tone-net.json (pesi, formati per il runtime JS)
"""
import json
import os
import sys
import time

import numpy as np

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(PROJECT, 'ml', 'data', 'tone-data.json')
OUT = os.path.join(PROJECT, 'ml', 'export', 'tone-net.json')

# --- iperparametri (da CLI) ---
import argparse
ap = argparse.ArgumentParser()
ap.add_argument('--epochs', type=int, default=6)
ap.add_argument('--batch', type=int, default=1024)
ap.add_argument('--h1', type=int, default=128)
ap.add_argument('--h2', type=int, default=64)
ap.add_argument('--emb', type=int, default=32)
ap.add_argument('--cap', type=int, default=100000, help='campione max esempi di training')
ap.add_argument('--lr', type=float, default=1e-3)
ARGS = ap.parse_args()

EMB_DIM = ARGS.emb
H1 = ARGS.h1
H2 = ARGS.h2
BATCH = ARGS.batch
EPOCHS = ARGS.epochs
LR = ARGS.lr
CAP = ARGS.cap

RNG = np.random.default_rng(0)


def relu(x):
    return np.maximum(x, 0.0)


def main():
    print('caricamento dataset...')
    t0 = time.time()
    with open(DATA) as f:
        data = json.load(f)
    N = data['N']
    vocab = data['vocab']
    V = len(vocab)
    L = 2 * N + 1

    Xtr = np.asarray(data['train']['X'], dtype=np.int32)
    ytr = np.asarray(data['train']['y'], dtype=np.int32)
    Xva = np.asarray(data['val']['X'], dtype=np.int32)
    yva = np.asarray(data['val']['y'], dtype=np.int32)
    # campiona il training se serve
    if len(Xtr) > CAP:
        perm = RNG.permutation(len(Xtr))[:CAP]
        Xtr, ytr = Xtr[perm], ytr[perm]
    print(f'  train {Xtr.shape[0]} | val {Xva.shape[0]} | vocab {V} | finestra {L}  ({time.time()-t0:.1f}s)')

    # --- parametri ---
    E = RNG.normal(0, 0.1, (V, EMB_DIM)).astype(np.float32)
    W1 = RNG.normal(0, 0.05, (L * EMB_DIM, H1)).astype(np.float32)
    b1 = np.zeros(H1, dtype=np.float32)
    W2 = RNG.normal(0, 0.05, (H1, H2)).astype(np.float32)
    b2 = np.zeros(H2, dtype=np.float32)
    W3 = RNG.normal(0, 0.05, (H2, 5)).astype(np.float32)
    b3 = np.zeros(5, dtype=np.float32)

    # Adam
    m = {}
    v = {}
    for k, p in [('E', E), ('W1', W1), ('b1', b1), ('W2', W2), ('b2', b2), ('W3', W3), ('b3', b3)]:
        m[k] = np.zeros_like(p)
        v[k] = np.zeros_like(p)
    beta1, beta2, eps = 0.9, 0.999, 1e-8
    tstep = 0

    def forward(X):
        xe = E[X]                       # B,L,d
        x = xe.reshape(X.shape[0], L * EMB_DIM)
        h1 = relu(x @ W1 + b1)
        h2 = relu(h1 @ W2 + b2)
        logits = h2 @ W3 + b3
        return xe, x, h1, h2, logits

    def predict(X):
        _, _, _, _, logits = forward(X)
        return logits.argmax(1)

    def accuracy(X, y):
        return float((predict(X) == y).mean())

    def baseline_acc():
        # euristica attuale: tono più frequente pesato per livello
        freq = {}
        with open(os.path.join(PROJECT, 'src/data/hsk-3.0.json')) as f:
            hsk = json.load(f)['words']
        for w in hsk:
            weight = 0.5 ** (min(w['level'], 8) - 1)
            for seg in w['pinyin_numbers'].lower().replace('v', 'ü').split():
                mm = __import__('re').match(r'^([a-zü]+)([0-5])$', seg)
                if not mm:
                    continue
                bare, t = mm.group(1), mm.group(2)
                tone = 0 if t in ('0', '5') else int(t)
                d = freq.setdefault(bare, {})
                d[tone] = d.get(tone, 0) + weight
        def majority(bare):
            d = freq.get(bare)
            if not d:
                return 0
            return max(d, key=d.get)
        return float(sum(majority(vocab[x[1 + N]]) == y for x, y in zip(Xva, yva)) / len(yva))

    print('baseline (euristica frequenza):', f'{baseline_acc():.4f}')

    for ep in range(EPOCHS):
        perm = RNG.permutation(len(Xtr))
        tot_loss = 0.0
        nbatch = 0
        tb = time.time()
        for s in range(0, len(Xtr), BATCH):
            idx = perm[s:s + BATCH]
            X, y = Xtr[idx], ytr[idx]
            B = X.shape[0]

            xe, x, h1, h2, logits = forward(X)

            # softmax + CE
            ex = np.exp(logits - logits.max(1, keepdims=True))
            probs = ex / ex.sum(1, keepdims=True)
            onehot = np.zeros((B, 5), dtype=np.float32)
            onehot[np.arange(B), y] = 1.0
            dlogits = (probs - onehot) / B
            loss = -np.log(probs[np.arange(B), y] + 1e-9).mean()

            # backprop
            dW3 = h2.T @ dlogits
            db3 = dlogits.sum(0)
            dh2 = dlogits @ W3.T
            dh2 = dh2 * (h2 > 0)
            dW2 = h1.T @ dh2
            db2 = dh2.sum(0)
            dx = dh2 @ W2.T
            dx = dx * (h1 > 0)
            dW1 = x.T @ dx
            db1 = dx.sum(0)
            dxe = (dx @ W1.T).reshape(B, L, EMB_DIM)

            dE = np.zeros_like(E)
            np.add.at(dE, X, dxe)

            # Adam
            tstep += 1
            grads = {'E': dE, 'W1': dW1, 'b1': db1, 'W2': dW2, 'b2': db2, 'W3': dW3, 'b3': db3}
            params = {'E': E, 'W1': W1, 'b1': b1, 'W2': W2, 'b2': b2, 'W3': W3, 'b3': b3}
            for k in grads:
                m[k] = beta1 * m[k] + (1 - beta1) * grads[k]
                v[k] = beta2 * v[k] + (1 - beta2) * grads[k] ** 2
                mhat = m[k] / (1 - beta1 ** tstep)
                vhat = v[k] / (1 - beta2 ** tstep)
                params[k] -= LR * mhat / (np.sqrt(vhat) + eps)

            tot_loss += loss
            nbatch += 1

        acc_tr = accuracy(Xtr[:20000], ytr[:20000])
        acc_va = accuracy(Xva, yva)
        print(f'epoca {ep+1}/{EPOCHS}  loss={tot_loss/nbatch:.4f}  acc_train={acc_tr:.4f}  acc_val={acc_va:.4f}  ({time.time()-tb:.0f}s)')

    # per-classe
    preds = predict(Xva)
    print('\naccuratezza per classe (neutro,1,2,3,4):')
    for c in range(5):
        sel = yva == c
        if sel.sum():
            print(f'  classe {c}: {(preds[sel] == c).mean():.3f} (n={sel.sum()})')

    # --- export ---
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    exp = {
        'N': N,
        'vocab': vocab,
        'emb_dim': EMB_DIM,
        'h1': H1,
        'h2': H2,
        'E': E.reshape(-1).tolist(),
        'W1': W1.reshape(-1).tolist(),
        'b1': b1.tolist(),
        'W2': W2.reshape(-1).tolist(),
        'b2': b2.tolist(),
        'W3': W3.reshape(-1).tolist(),
        'b3': b3.tolist(),
    }
    with open(OUT, 'w') as f:
        json.dump(exp, f, separators=(',', ':'))
    print('\nesportato', os.path.relpath(OUT, PROJECT), f'({os.path.getsize(OUT)/1e6:.2f} MB)')
    print('acc_val finale:', f'{acc_va:.4f}', '| baseline:', f'{baseline_acc():.4f}')


if __name__ == '__main__':
    main()
