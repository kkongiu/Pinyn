#!/usr/bin/env python3
"""
Quantizza i pesi della rete dei toni in int8 e verifica l'accuratezza
prima di esportare per il runtime JS (src/data/tone-net.json).
"""
import json
import os

import numpy as np

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(PROJECT, 'ml', 'export', 'tone-net.json')
DATA = os.path.join(PROJECT, 'ml', 'data', 'tone-data.json')
DST = os.path.join(PROJECT, 'src', 'data', 'tone-net.json')

with open(SRC) as f:
    M = json.load(f)
with open(DATA) as f:
    data = json.load(f)

V = len(M['vocab'])
L = 2 * M['N'] + 1
EMB = M['emb_dim']
H1 = M['h1']
H2 = M['h2']


def tens(p):
    return np.asarray(p, dtype=np.float32)


def relu(x):
    return np.maximum(x, 0.0)


def forward(X, params):
    E, W1, b1, W2, b2, W3, b3 = params
    xe = E[X]
    x = xe.reshape(X.shape[0], L * EMB)
    h1 = relu(x @ W1 + b1)
    h2 = relu(h1 @ W2 + b2)
    logits = h2 @ W3 + b3
    return logits.argmax(1)


def acc(params):
    X = np.asarray(data['val']['X'], dtype=np.int32)
    y = np.asarray(data['val']['y'], dtype=np.int32)
    return float((forward(X[:10000], params) == y[:10000]).mean())


E = tens(M['E']).reshape(V, EMB)
W1 = tens(M['W1']).reshape(L * EMB, H1)
b1 = tens(M['b1'])
W2 = tens(M['W2']).reshape(H1, H2)
b2 = tens(M['b2'])
W3 = tens(M['W3']).reshape(H2, 5)
b3 = tens(M['b3'])

acc_fp = acc((E, W1, b1, W2, b2, W3, b3))
print('acc fp32:', f'{acc_fp:.4f}')


def q_tensor(t, per_row=False):
    """int8 per-tensor (o per-riga) -> (v int, scale)."""
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


# E: per-riga (le embedding hanno magnitudini diverse); matrici: per-tensor
E_v, E_s = q_tensor(E, per_row=True)
W1_v, W1_s = q_tensor(W1)
W2_v, W2_s = q_tensor(W2)
W3_v, W3_s = q_tensor(W3)

E_q = deq(E_v, E_s, per_row=True)
W1_q = deq(W1_v, W1_s)
W2_q = deq(W2_v, W2_s)
W3_q = deq(W3_v, W3_s)

acc_q = acc((E_q, W1_q, b1, W2_q, b2, W3_q, b3))
print('acc int8 :', f'{acc_q:.4f}', f'(-{(acc_fp - acc_q) * 100:.2f} punti)')

out = {
    'N': M['N'],
    'vocab': M['vocab'],
    'emb_dim': EMB,
    'h1': H1,
    'h2': H2,
    'E': {'v': E_v.reshape(-1).tolist(), 's': E_s.tolist()},
    'W1': {'v': W1_v.reshape(-1).tolist(), 's': W1_s},
    'W2': {'v': W2_v.reshape(-1).tolist(), 's': W2_s},
    'W3': {'v': W3_v.reshape(-1).tolist(), 's': W3_s},
    'b1': b1.tolist(),
    'b2': b2.tolist(),
    'b3': b3.tolist(),
}
os.makedirs(os.path.dirname(DST), exist_ok=True)
with open(DST, 'w') as f:
    json.dump(out, f, separators=(',', ':'))

size = os.path.getsize(DST)
print('esportato', os.path.relpath(DST, PROJECT), f'({size/1e3:.0f} KB)')
