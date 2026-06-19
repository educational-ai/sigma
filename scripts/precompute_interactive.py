#!/usr/bin/env python3
"""
precompute_interactive.py — готовит компактные JSON-данные для нативных
живых виджетов (docs/assistant/data/*.json). Считается ОДИН раз; в браузере
реконструкция/проекция идут мгновенно на этих данных, без Pyodide.

Запуск:  /root/.venv/bin/python scripts/precompute_interactive.py
"""
import base64
import json
import os

import numpy as np

OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "assistant", "data")
os.makedirs(OUT, exist_ok=True)


def b64_u8(arr):
    return base64.b64encode(np.asarray(arr, dtype=np.uint8).tobytes()).decode("ascii")


def b64_i8(arr):
    return base64.b64encode(np.asarray(arr, dtype=np.int8).tobytes()).decode("ascii")


def precompute_eigenfaces():
    """Реальные Olivetti faces → среднее, базис eigenfaces (int8), несколько
    образцов с их проекциями, кривая накопленной дисперсии."""
    from sklearn.datasets import fetch_olivetti_faces

    H = W = 50  # даунсэмпл 64→50 ради веса; лицо остаётся узнаваемым
    K = 60      # компонент в базисе для реконструкции
    SCREE = 200 # длина кривой дисперсии

    data = fetch_olivetti_faces(shuffle=True, random_state=42)
    X64 = data.data.reshape(-1, 64, 64)

    # даунсэмпл усреднением блоков 64→50 через интерполяцию по сетке
    yi = (np.linspace(0, 63, H)).round().astype(int)
    xi = (np.linspace(0, 63, W)).round().astype(int)
    X = X64[:, yi][:, :, xi].reshape(len(X64), H * W)  # (n, 2500) в [0,1]

    mean = X.mean(axis=0)
    Xc = X - mean
    # SVD центрированных данных = PCA
    U, s, Vt = np.linalg.svd(Xc, full_matrices=False)
    evr = (s ** 2) / (s ** 2).sum()
    cumvar = np.cumsum(evr)

    comps = Vt[:K]                       # (K, N) единичные собственные лица
    # знак собственного вектора произволен — зафиксируем по макс. |элементу| > 0
    for i in range(K):
        j = np.argmax(np.abs(comps[i]))
        if comps[i, j] < 0:
            comps[i] = -comps[i]

    # int8-квантование базиса с per-component scale
    scales = np.abs(comps).max(axis=1) + 1e-12
    q = np.round(comps / scales[:, None] * 127).astype(np.int8)

    # образцы лиц (берём визуально разные индексы)
    sample_idx = [0, 7, 13, 24, 31, 42]
    faces = []
    for idx in sample_idx:
        coords = (comps @ (X[idx] - mean)).tolist()
        faces.append({
            "img": b64_u8(np.clip(X[idx] * 255, 0, 255)),
            "coords": [round(c, 5) for c in coords],
        })

    out = {
        "h": H, "w": W, "K": K,
        "mean": [round(float(v), 4) for v in mean],   # [0,1]
        "scales": [round(float(v), 6) for v in scales],
        "basis_i8": b64_i8(q),                          # K*N int8, value = q/127*scale
        "cumvar": [round(float(v), 5) for v in cumvar[:SCREE]],
        "faces": faces,
        "var_at_k": round(float(cumvar[K - 1]), 4),
    }
    path = os.path.join(OUT, "pca_eigenfaces.json")
    with open(path, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"✓ pca_eigenfaces.json: {H}x{W}, K={K}, {len(faces)} faces, "
          f"{os.path.getsize(path)//1024} KB, var@K={out['var_at_k']:.1%}")


def precompute_ica_audio():
    """Два голоса (клипы StarCraft) → 8 кГц моно, общая длина, нормировка,
    int8. Виджет ica-cocktail смешивает их матрицей A и разделяет FastICA
    в браузере; здесь готовим только исходные источники."""
    from math import gcd
    from scipy.io import wavfile
    from scipy.signal import resample_poly

    SRC = "/root/optim_repo/assets/files"
    TARGET = 8000

    def load(name):
        rate, x = wavfile.read(os.path.join(SRC, name))
        if x.ndim > 1:
            x = x.mean(axis=1)
        x = x.astype(np.float64) / 32768.0
        g = gcd(TARGET, rate)
        return resample_poly(x, TARGET // g, rate // g)

    s_a, s_b = load("starcraft2.wav"), load("starcraft3.wav")
    L = min(len(s_a), len(s_b))

    def norm(x):
        x = x[:L] - x[:L].mean()
        return x / (x.std() + 1e-9)

    s_a, s_b = norm(s_a), norm(s_b)

    def enc(x):
        m = float(np.max(np.abs(x))) or 1.0
        q = np.clip(np.round(x / m * 127), -127, 127).astype(np.int8)
        return {"b64": b64_i8(q), "scale": round(m, 5)}

    out = {"rate": TARGET, "n": int(L), "sources": [enc(s_a), enc(s_b)],
           "labels": ["Голос A", "Голос B"]}
    path = os.path.join(OUT, "ica_cocktail_audio.json")
    with open(path, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"✓ ica_cocktail_audio.json: {L/TARGET:.2f}s @ {TARGET}Hz, "
          f"{os.path.getsize(path)//1024} KB")


if __name__ == "__main__":
    precompute_eigenfaces()
    precompute_ica_audio()
