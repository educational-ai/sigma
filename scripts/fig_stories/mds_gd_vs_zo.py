"""
Генератор фигуры mds_gd_vs_zo.svg
GD vs Zero-Order GD на задаче MDS: разрыв растёт пропорционально d.
Стиль: Sigma/Tufte (serif, #1F4E79/#C0392B, spines off, frameon=False).
"""
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

plt.rcParams['font.family'] = 'serif'
plt.rcParams['font.serif'] = ['DejaVu Serif', 'Times New Roman', 'serif']
plt.rcParams['mathtext.fontset'] = 'dejavuserif'

# ─── Функции MDS ──────────────────────────────────────────────────────────────

def stress(W_flat, D, d):
    n = D.shape[0]
    W = W_flat.reshape(n, d)
    s = 0.0
    for i in range(n):
        for j in range(i + 1, n):
            s += (np.linalg.norm(W[i] - W[j]) - D[i, j]) ** 2
    return s


def stress_gradient(W_flat, D, d):
    n = D.shape[0]
    W = W_flat.reshape(n, d)
    grad = np.zeros_like(W)
    for i in range(n):
        for j in range(i + 1, n):
            diff = W[i] - W[j]
            dist_ij = np.linalg.norm(diff) + 1e-10
            factor = 2.0 * (dist_ij - D[i, j]) / dist_ij
            grad[i] += factor * diff
            grad[j] -= factor * diff
    return grad.flatten()


def zero_order_gd(f, x0, eps=1e-4, lr=1e-5, max_iter=500):
    x = x0.copy()
    d = len(x)
    hist = []
    rng = np.random.default_rng(7)
    for _ in range(max_iter):
        v = rng.standard_normal(d)
        v /= np.linalg.norm(v) + 1e-10
        g_est = d * (f(x + eps * v) - f(x - eps * v)) / (2.0 * eps) * v
        x -= lr * g_est
        hist.append(f(x))
    return hist


def first_order_gd(f, grad_f, x0, lr=1e-4, max_iter=500):
    x = x0.copy()
    hist = []
    for _ in range(max_iter):
        x -= lr * grad_f(x)
        hist.append(f(x))
    return hist


# ─── Эксперимент ──────────────────────────────────────────────────────────────

n = 30
d_values = [2, 5, 10, 20, 50]
gd_finals = []
zo_finals = []

rng_main = np.random.default_rng(42)

for d_embed in d_values:
    true_W = rng_main.standard_normal((n, d_embed))
    D = np.zeros((n, n))
    for i in range(n):
        for j in range(n):
            D[i, j] = np.linalg.norm(true_W[i] - true_W[j])

    x0 = rng_main.standard_normal(n * d_embed) * 5

    f = lambda w, _d=d_embed, _D=D: stress(w, _D, _d)
    gf = lambda w, _d=d_embed, _D=D: stress_gradient(w, _D, _d)

    hist_gd = first_order_gd(f, gf, x0.copy(), lr=1e-4, max_iter=500)
    hist_zo = zero_order_gd(f, x0.copy(), lr=1e-5, max_iter=500)

    gd_finals.append(hist_gd[-1])
    zo_finals.append(hist_zo[-1])

# ─── Фигура ───────────────────────────────────────────────────────────────────

x = np.arange(len(d_values))
width = 0.38

fig, ax = plt.subplots(figsize=(8, 4.2))
fig.patch.set_facecolor('#fffff8')
ax.set_facecolor('#fffff8')

bars_gd = ax.bar(x - width / 2, gd_finals, width, label='GD (градиентный)',
                 color='#1F4E79', alpha=0.92)
bars_zo = ax.bar(x + width / 2, zo_finals, width, label='ZO-GD (безградиентный)',
                 color='#C0392B', alpha=0.85)

ax.set_yscale('log')
ax.set_xticks(x)
ax.set_xticklabels([f'd = {d}' for d in d_values], fontsize=10)
ax.set_ylabel('Стресс (лог. шкала)', fontsize=11)
ax.set_title('GD vs безградиентный: разрыв усиливается с ростом d\n'
             r'($d$ — размерность вложения; $p = n \cdot d$ — полное число переменных)', fontsize=11)

ax.spines[['top', 'right']].set_visible(False)
ax.grid(True, axis='y', alpha=0.25, linewidth=0.5)
ax.legend(frameon=False, fontsize=10)

# Аннотация разрыва — внутри баров ZO (чтобы не вылезать за пределы)
y_lim_top = ax.get_ylim()[1]
for i, (gd_v, zo_v) in enumerate(zip(gd_finals, zo_finals)):
    if gd_v > 0 and zo_v > 0:
        ratio = zo_v / gd_v
        # Размещаем текст чуть ниже верхушки ZO-бара
        pos = zo_v * 0.55
        ax.text(i + width / 2, pos, f'×{ratio:.0f}', ha='center', va='center',
                fontsize=8.5, color='white', fontweight='bold')

fig.tight_layout()
fig.savefig('/var/www/sigma/book/figures/stories/mds_gd_vs_zo.svg',
            bbox_inches='tight', format='svg')
print("Saved mds_gd_vs_zo.svg")
