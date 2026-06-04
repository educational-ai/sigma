#!/usr/bin/env python3
"""Precompute model-wise double descent on a REAL neural network (MLP).

Belkin/Nakkiran recipe: small noisy classification set, sweep hidden width
from under- to over-parameterized, train each to (near) interpolation, record
train/test error vs capacity. The interpolation-threshold peak + second descent
is the double-descent phenomenon — on a genuine NN, not a polynomial toy.

Uses sklearn MLPClassifier (real NN) + load_digits (8x8, offline, fast).
Outputs JSON for the Sigma widget + a PNG curve to eyeball before shipping.
"""
import json
import numpy as np
from pathlib import Path
from sklearn.datasets import load_digits
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler

OUT_JSON = Path("/var/www/sigma/docs/assistant/data/double_descent_nn.json")
OUT_PNG = Path("/tmp/dd_nn_curve.png")

rng = np.random.default_rng(0)

X, y = load_digits(return_X_y=True)
X = StandardScaler().fit_transform(X)
# split
idx = rng.permutation(len(X))
ntr = 1000
tr, te = idx[:ntr], idx[ntr:]
Xtr, ytr = X[tr], y[tr].copy()
Xte, yte = X[te], y[te]

# label noise — KEY for a visible double-descent peak
NOISE = 0.18
nflip = int(NOISE * len(ytr))
flip = rng.choice(len(ytr), nflip, replace=False)
ytr[flip] = rng.integers(0, 10, nflip)

# hidden widths spanning under- → over-parameterized (params ~ 74*H for 64->H->10)
WIDTHS = [1, 2, 3, 4, 6, 8, 10, 13, 16, 20, 25, 32, 40, 55, 75, 100, 140, 200, 300, 500]

rows = []
for H in WIDTHS:
    clf = MLPClassifier(
        hidden_layer_sizes=(H,), activation="relu", solver="adam",
        alpha=1e-6, learning_rate_init=3e-3, max_iter=3000, n_iter_no_change=3000,
        tol=0, batch_size=min(128, ntr), random_state=0,
    )
    clf.fit(Xtr, ytr)
    n_params = sum(c.size for c in clf.coefs_) + sum(b.size for b in clf.intercepts_)
    tr_err = 1.0 - clf.score(Xtr, ytr)
    te_err = 1.0 - clf.score(Xte, yte)
    rows.append({"width": H, "n_params": int(n_params),
                 "train_err": round(float(tr_err), 4), "test_err": round(float(te_err), 4)})
    print(f"H={H:4d}  params={n_params:7d}  train_err={tr_err:.3f}  test_err={te_err:.3f}", flush=True)

meta = {"dataset": "sklearn load_digits", "n_train": ntr, "n_test": len(te),
        "label_noise": NOISE, "classes": 10, "model": "MLP (1 hidden layer, ReLU, Adam)",
        "interp_threshold_note": "params ~ n_train*classes near peak", "rows": rows}
OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
OUT_JSON.write_text(json.dumps(meta, ensure_ascii=False, indent=2))
print("wrote", OUT_JSON)

# eyeball plot
try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    w = [r["width"] for r in rows]
    plt.figure(figsize=(7, 4))
    plt.semilogx(w, [r["test_err"] for r in rows], "r.-", label="test")
    plt.semilogx(w, [r["train_err"] for r in rows], "b.-", label="train")
    plt.xlabel("hidden width (capacity)"); plt.ylabel("error"); plt.legend()
    plt.title("MLP double descent (load_digits, 18% label noise)")
    plt.grid(True, alpha=0.3); plt.tight_layout(); plt.savefig(OUT_PNG, dpi=110)
    print("wrote", OUT_PNG)
except Exception as e:
    print("plot skipped:", e)
