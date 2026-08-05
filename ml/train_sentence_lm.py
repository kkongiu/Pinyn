#!/usr/bin/env python3
"""
Addestra il LM di frasi (verifica forma): predice la parola successiva.
Modello: embedding (V x d) + finestra di K parole precedenti -> hidden -> softmax(V).
Pura NumPy (nessuna dipendenza). Output: ml/export/sentence-net.json (fp32).
"""
import json
import os
import time

import numpy as np

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(PROJECT, 'ml', 'data', 'sentence-data.json')
OUT = os.path.join(PROJECT, 'ml', 'export', 'sentence-net.json')

# iperparametri (da CLI)
import argparse
ap = argparse.ArgumentParser()
ap.add_argument('--epochs', type=int, default=4)
ap.add_argument('--batch', type=int, default=512)
ap.add_argument('--d', type=int, default=32, help='dimensione embedding')
ap.add_argument('--h1', type=int, default=96)
ap.add_argument('--window', type=int, default=3, help='parole precedenti di contesto')
ap.add_argument('--cap', type=int, default=120000, help='max esempi di training')
ap.add_argument('--lr', type=float, default=3e-3)
ARGS = ap.parse_args()

VOCAB_CAP = 3000  # usa solo le prime N parole (il resto -> <unk>)

RNG = np.random.default_rng(0)


def relu(x):
    return np.maximum(x, 0.0)


def main():
    with open(DATA) as f:
        data = json.load(f)
    vocab = data['vocab'][:VOCAB_CAP]
    V = len(vocab)
    E_D = ARGS.d
    K = ARGS.window
    H1 = ARGS.h1

    def to_windows(seqs, cap=None):
        X, y = [], []
        for s in seqs:
            sidx = [min(i, V - 1) for i in s]  # clamp oltre vocab -> <unk>/ultimo
            for t in range(K, len(sidx)):
                ctx = sidx[t - K:t]
                if ctx == [V - 1] * K and cap and len(X) > cap:
                    break
                X.append(ctx)
                y.append(sidx[t])
            if cap and len(X) >= cap:
                break
        return np.asarray(X, dtype=np.int32), np.asarray(y, dtype=np.int32)

    Xtr, ytr = to_windows(data['seqs'], ARGS.cap)
    Xva, yva = to_windows(data['valSeqs'])
    print(f'window dim {K} | vocab {V} | train {Xtr.shape[0]} | val {Xva.shape[0]}')

    # parametri
    E = RNG.normal(0, 0.1, (V, E_D)).astype(np.float32)
    W1 = RNG.normal(0, 0.05, (K * E_D, H1)).astype(np.float32)
    b1 = np.zeros(H1, dtype=np.float32)
    W2 = RNG.normal(0, 0.05, (H1, V)).astype(np.float32)
    b2 = np.zeros(V, dtype=np.float32)

    m = {k: np.zeros_like(p) for k, p in [('E', E), ('W1', W1), ('b1', b1), ('W2', W2), ('b2', b2)]}
    v = {k: np.zeros_like(p) for k, p in m.items()}
    beta1, beta2, eps = 0.9, 0.999, 1e-8
    tstep = 0

    def forward(X):
        xe = E[X]                     # B,K,d
        x = xe.reshape(X.shape[0], K * E_D)
        h1 = relu(x @ W1 + b1)        # B,H1
        logits = h1 @ W2 + b2         # B,V
        return xe, x, h1, logits

    def predict(X):
        _, _, _, logits = forward(X)
        return logits.argmax(1)

    def acc(X, y):
        return float((predict(X) == y).mean())

    for ep in range(ARGS.epochs):
        perm = RNG.permutation(len(Xtr))
        tot = 0.0
        tb = time.time()
        for s in range(0, len(Xtr), ARGS.batch):
            idx = perm[s:s + ARGS.batch]
            X, y = Xtr[idx], ytr[idx]
            B = X.shape[0]

            xe, x, h1, logits = forward(X)

            ex = np.exp(logits - logits.max(1, keepdims=True))
            probs = ex / ex.sum(1, keepdims=True)
            onehot = np.zeros((B, V), dtype=np.float32)
            onehot[np.arange(B), y] = 1.0
            dlogits = (probs - onehot) / B
            loss = -np.log(probs[np.arange(B), y] + 1e-9).mean()

            dW2 = h1.T @ dlogits
            db2 = dlogits.sum(0)
            dh1 = (dlogits @ W2.T) * (h1 > 0)
            dW1 = x.T @ dh1
            db1 = dh1.sum(0)
            dxe = (dh1 @ W1.T).reshape(B, K, E_D)
            dE = np.zeros_like(E)
            np.add.at(dE, X, dxe)

            tstep += 1
            for k in ['E', 'W1', 'b1', 'W2', 'b2']:
                g = {'E': dE, 'W1': dW1, 'b1': db1, 'W2': dW2, 'b2': db2}[k]
                p = {'E': E, 'W1': W1, 'b1': b1, 'W2': W2, 'b2': b2}[k]
                m[k] = beta1 * m[k] + (1 - beta1) * g
                v[k] = beta2 * v[k] + (1 - beta2) * g ** 2
                mhat = m[k] / (1 - beta1 ** tstep)
                vhat = v[k] / (1 - beta2 ** tstep)
                p -= ARGS.lr * mhat / (np.sqrt(vhat) + eps)

            tot += loss

        a_tr = acc(Xtr[:20000], ytr[:20000])
        a_va = acc(Xva[:20000], yva[:20000])
        print(f'epoca {ep+1}  loss={tot/(len(Xtr)//ARGS.batch):.4f}  acc_train={a_tr:.4f}  acc_val={a_va:.4f}  ({time.time()-tb:.0f}s)')

    # export fp32
    os.makedirs(os.path.dirname(OUT), exist_ok=True)

    # ---- valutazione reale vs sintetica (shuffle del target) ----
    def avg_neglog(X, y):
        tot = 0.0
        cnt = 0
        for s in range(0, min(len(X), 20000), 256):
            xx, yy = X[s:s + 256], y[s:s + 256]
            _, _, h1, logits = forward(xx)
            logits -= logits.max(1, keepdims=True)
            z = logits - logits.max(1, keepdims=True)
            den = np.exp(z).sum(1, keepdims=True)
            p = np.exp(z[np.arange(len(xx)), yy]) / den.reshape(-1)
            tot += -np.log(np.maximum(p, 1e-12)).sum()
            cnt += len(xx)
        return float(tot / cnt)

    real = avg_neglog(Xva, yva)
    y_shuf = RNG.choice(V, size=len(yva))
    garb = avg_neglog(Xva[:len(yva)], y_shuf[:len(yva)])
    print(f'[eval] -logP medio val reale={real:.3f} vs shuffle={garb:.3f}  (gap={garb - real:+.3f})')

    exp = {
        'K': K, 'V': V, 'd': E_D, 'h1': H1, 'vocab': vocab,
        'E': E.reshape(-1).tolist(),
        'W1': W1.reshape(-1).tolist(), 'b1': b1.tolist(),
        'W2': W2.reshape(-1).tolist(), 'b2': b2.tolist(),
    }
    with open(OUT, 'w') as f:
        json.dump(exp, f, separators=(',', ':'))
    print('esportato', os.path.relpath(OUT, PROJECT), f'({os.path.getsize(OUT)/1e6:.2f} MB)')
    print('acc_val:', f'{a_va:.4f}')


if __name__ == '__main__':
    main()
