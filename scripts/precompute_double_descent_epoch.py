#!/usr/bin/env python3
"""Epoch-wise double descent on a real MLP (Nakkiran et al.).

Fixed architecture near the interpolation threshold, train for many epochs,
record test error per epoch. With label noise the test error often descends,
bumps up as the net memorizes noise, then descends again with long training —
epoch-wise double descent. Output JSON for the widget + PNG to eyeball first.
"""
import json
import numpy as np
from pathlib import Path
from sklearn.datasets import load_digits
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler

OUT_JSON = Path("/var/www/sigma/docs/assistant/data/double_descent_epoch.json")
OUT_PNG = Path("/tmp/dd_epoch_curve.png")
rng = np.random.default_rng(0)

X, y = load_digits(return_X_y=True)
X = StandardScaler().fit_transform(X)
idx = rng.permutation(len(X)); ntr = 1000
tr, te = idx[:ntr], idx[ntr:]
Xtr, ytr = X[tr], y[tr].copy(); Xte, yte = X[te], y[te]
NOISE = 0.18
flip = rng.choice(ntr, int(NOISE * ntr), replace=False)
ytr[flip] = rng.integers(0, 10, len(flip))

H = 24  # чуть выше порога интерполяции (model-wise пик был ~13) — память шума идёт по эпохам
clf = MLPClassifier(hidden_layer_sizes=(H,), activation="relu", solver="adam",
                    alpha=1e-6, learning_rate_init=2e-3, warm_start=True, max_iter=1,
                    random_state=0)
classes = np.arange(10)
EPOCHS = 400
rows = []
for ep in range(1, EPOCHS + 1):
    clf.partial_fit(Xtr, ytr, classes=classes)
    if ep <= 20 or ep % 4 == 0:
        tr_err = 1.0 - clf.score(Xtr, ytr)
        te_err = 1.0 - clf.score(Xte, yte)
        rows.append({"epoch": ep, "train_err": round(float(tr_err), 4), "test_err": round(float(te_err), 4)})
        print(f"ep={ep:4d}  train_err={tr_err:.3f}  test_err={te_err:.3f}", flush=True)

meta = {"dataset": "sklearn load_digits", "n_train": ntr, "n_test": len(te), "label_noise": NOISE,
        "width": H, "model": "MLP (1 hidden, ReLU, Adam)", "rows": rows}
OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
OUT_JSON.write_text(json.dumps(meta, ensure_ascii=False, indent=2))
print("wrote", OUT_JSON)
try:
    import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
    e = [r["epoch"] for r in rows]
    plt.figure(figsize=(7, 4))
    plt.semilogx(e, [r["test_err"] for r in rows], "r.-", label="test")
    plt.semilogx(e, [r["train_err"] for r in rows], "b.-", label="train")
    plt.xlabel("epoch"); plt.ylabel("error"); plt.legend(); plt.grid(True, alpha=0.3)
    plt.title(f"Epoch-wise double descent (MLP width={H}, 18% noise)")
    plt.tight_layout(); plt.savefig(OUT_PNG, dpi=110); print("wrote", OUT_PNG)
except Exception as ex:
    print("plot skipped:", ex)
