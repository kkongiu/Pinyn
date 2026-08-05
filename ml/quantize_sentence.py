#!/usr/bin/env python3
"""
Quantizza i pesi del LM di frasi in int8 e verifica l'accuratezza prima
di esportare per il runtime JS (src/data/sentence-net.json).
"""
import json
import os

import numpy as np

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(PROJECT, 'ml', 'export', 'sentence-net.json')
DATA = os.path.join(PROJECT, 'ml', 'data', 'sentence-data.json')
DST = os.path.join(PROJECT, 'src', 'data', 'sentence-net.json')

with open(SRC) as f:
    M = json.load(f)
with open(DATA) as f:
    data = json.load(f)

V = M['V']
K = M['K']
D = M['d']
H1 = M['h1']
VOCAB_CAP = V  # il modello usa già vocab cap 3000


def tens(p):
    return np.asarray(p, dtype=np.float32)


def relu(x):
    return np.maximum(x, 0.0)


def forward(X, params):
    E, W1, b1, W2, b2 = params
    xe = E[X]
    x = xe.reshape(X.shape[0], K * D)
    h1 = relu(x @ W1 + b1)
    logits = h1 @ W2 + b2
    return logits.argmax(1)


def acc(params):
    X = data['valSeqs']
    xs, ys = [], []
    for s in X:
        for t in range(K, len(s)):
            xs.append(s[t - K:t])
            ys.append(s[t])
        if len(xs) >= 20000:
            break
    xs = np.clip(np.asarray(xs, dtype=np.int32), 0, V - 1)
    ys = np.clip(np.asarray(ys, dtype=np.int32), 0, V - 1)
    return float((forward(xs[:20000], params) == ys[:20000]).mean())


E = tens(M['E']).reshape(V, D)
W1 = tens(M['W1']).reshape(K * D, H1)
b1 = tens(M['b1'])
W2 = tens(M['W2']).reshape(H1, V)
b2 = tens(M['b2'])

acc_fp = acc((E, W1, b1, W2, b2))
print('acc fp32:', f'{acc_fp:.4f}')


def q_tensor(t, per_row=False):
    if per_row:
        mx = np.max(np.abs(t), axis=1, keepdims=True)
        mx[mx == 0] = 1e-9
        s = (mx / 127.0).astype(np.float32)
        v = np.clip(np.round(t / s), -127, 127).astype(np.int8)
        return v, s.reshape(-1)
    mx = np.max(np.abs(t))
    s = (mx / 127.0) if mx > 0 else 1.0
    v = np.clip(np.round(t / s), -127, 127).astype(np.int8)
    return v, float(s)


def deq(v, s, per_row=False):
    if per_row:
        return v.astype(np.float32) * s[:, None]
    return v.astype(np.float32) * s


E_v, E_s = q_tensor(E, per_row=True)
W1_v, W1_s = q_tensor(W1)
W2_v, W2_s = q_tensor(W2, per_row=True)  # output: per-riga per preservare la distribuzione

E_q = deq(E_v, E_s, per_row=True)
W1_q = deq(W1_v, W1_s)
W2_q = deq(W2_v, W2_s, per_row=True)

acc_q = acc((E_q, W1_q, b1, W2_q, b2))
print('acc int8 :', f'{acc_q:.4f}', f'(-{(acc_fp - acc_q) * 100:.2f} punti)')

out = {
    'K': K, 'V': V, 'd': D, 'h1': H1,
    'vocab': M['vocab'],
    'E': {'v': E_v.reshape(-1).tolist(), 's': E_s.tolist()},
    'W1': {'v': W1_v.reshape(-1).tolist(), 's': W1_s},
    'W2': {'v': W2_v.reshape(-1).tolist(), 's': W2_s.tolist()},
    'b1': b1.tolist(),
    'b2': b2.tolist(),
}
os.makedirs(os.path.dirname(DST), exist_ok=True)
with open(DST, 'w') as f:
    json.dump(out, f, separators=(',', ':'))

print('esportato', os.path.relpath(DST, PROJECT), f'({os.path.getsize(DST)/1e3:.0f} KB)')
