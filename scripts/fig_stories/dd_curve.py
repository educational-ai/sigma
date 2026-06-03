"""
Генератор: dd_curve.svg
Двойной спуск — model-wise на гауссовом дизайне.

Точная копия схемы из виджета (который диагноз подтвердил корректным):
  - Истинный сигнал задан через те же признаки что и модель
  - beta ~ N(0, 1/D), истинные метки y = X @ beta + noise
  - МНК/min-norm sweep по P

Усредняем по N_reps запускам для сглаживания.
"""

import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

plt.rcParams.update({
    'font.family': 'serif',
    'font.serif': ['DejaVu Serif', 'Times New Roman', 'serif'],
    'mathtext.fontset': 'dejavuserif',
    'axes.spines.top': False,
    'axes.spines.right': False,
})

BLUE = '#1F4E79'
RED  = '#C0392B'
GRAY = '#888888'

# ── параметры ─────────────────────────────────────────────────────────────
n     = 100       # число обучающих точек (больше → чётче U-shape до пика)
noise = 0.50      # относительный шум
D     = 400       # макс. число признаков
n_reps = 60       # усреднение по запускам

P_vals = sorted(set(list(range(1, D + 1, 2)) + [n - 1, n, n + 1]))
P_vals = [p for p in P_vals if 1 <= p <= D]
P_arr  = np.array(P_vals)

tr_all = np.zeros((n_reps, len(P_vals)))
te_all = np.zeros((n_reps, len(P_vals)))

for rep in range(n_reps):
    rng = np.random.default_rng(rep * 97 + 13)

    beta = rng.standard_normal(D) / np.sqrt(D)

    X_tr = rng.standard_normal((n,     D))
    X_te = rng.standard_normal((1000,  D))

    y_tr = X_tr @ beta + noise * rng.standard_normal(n)
    y_te = X_te @ beta  + noise * rng.standard_normal(1000)  # шум и на тесте

    for i, P in enumerate(P_vals):
        A   = X_tr[:, :P]
        w, _, _, _ = np.linalg.lstsq(A, y_tr, rcond=None)
        tr_all[rep, i] = np.mean((A @ w - y_tr) ** 2)
        te_all[rep, i] = np.mean((X_te[:, :P] @ w - y_te) ** 2)

train_mse = tr_all.mean(axis=0)
test_mse  = te_all.mean(axis=0)

# clip как в виджете — но мягче, чтобы кривая читалась
test_plot  = np.clip(test_mse,  1e-3, 1e2)
train_plot = np.clip(train_mse, 1e-6, 1e2)

# ── статистика ─────────────────────────────────────────────────────────────
peak_idx   = np.argmax(test_plot)
pre_min_i  = np.argmin(test_plot[:peak_idx]) if peak_idx > 0 else 0
post_min_i = peak_idx + np.argmin(test_plot[peak_idx:])

pre_val  = test_mse[:peak_idx].min() if peak_idx > 0 else float('inf')
peak_val = test_mse[peak_idx]
post_val = test_mse[peak_idx:].min()

print(f'n={n}, D={D}, noise={noise}, reps={n_reps}')
print(f'Pre-peak min  MSE = {pre_val:.4f}  at P = {P_arr[pre_min_i]}')
print(f'Peak          MSE = {peak_val:.4f}  at P = {P_arr[peak_idx]}')
print(f'Post-peak min MSE = {post_val:.4f}  at P = {P_arr[post_min_i]}')
print(f'Post < Pre: {post_val < pre_val}')

# ── фигура ──────────────────────────────────────────────────────────────────
fig, ax = plt.subplots(figsize=(8.5, 4.2))

ax.semilogy(P_arr, train_plot, color=BLUE, lw=1.4,
            label='Train MSE', alpha=0.85, zorder=3)
ax.semilogy(P_arr, test_plot,  color=RED,  lw=2.0,
            label='Test MSE',  zorder=4)

# Порог интерполяции
ax.axvline(n, color=GRAY, ls='--', lw=1.2, alpha=0.8, zorder=2)
ylims = ax.get_ylim()
mid_y = 10 ** (0.65 * np.log10(ylims[1]) + 0.35 * np.log10(ylims[0]))
ax.text(n + 4, mid_y, f'$P = n = {n}$\n(порог)', fontsize=8.5,
        color=GRAY, va='center')

# Аннотация «Второй спуск» — показать убывающий участок
anno_i = peak_idx + max(1, int((post_min_i - peak_idx) * 0.45))
anno_i = min(anno_i, len(P_vals) - 1)

ax.annotate(
    'Второй спуск',
    xy=(P_arr[anno_i], test_plot[anno_i]),
    xytext=(P_arr[anno_i] + 30, test_plot[anno_i] * 4.0),
    fontsize=9.5, color=RED, fontweight='bold',
    arrowprops=dict(arrowstyle='->', color=RED, lw=1.3),
    zorder=5,
)

# Аннотация «Классический минимум» — указать на середину U-образного участка
# где кривая делает реальное дно до подъёма к пику
# Найдём истинный минимум в пред-пиковой зоне (исключая первые 3 точки)
start_search = min(3, peak_idx)
local_min_i = start_search + np.argmin(test_plot[start_search:peak_idx]) if peak_idx > start_search else 0

ax.annotate(
    'Классический\nминимум',
    xy=(P_arr[local_min_i], test_plot[local_min_i]),
    xytext=(P_arr[local_min_i] + 12, test_plot[local_min_i] * 5.0),
    fontsize=8.5, color='#444444',
    arrowprops=dict(arrowstyle='->', color='#444444', lw=1.0),
)

ax.set_xlabel('Число признаков $P$', fontsize=10)
ax.set_ylabel('MSE', fontsize=10)
ax.set_title(
    f'Двойной спуск: кривая ошибки $W$-образна\n'
    f'(гауссов дизайн, $n = {n}$, среднее по {n_reps} запускам)',
    fontsize=11,
)
ax.spines[['top', 'right']].set_visible(False)
ax.legend(fontsize=9, frameon=False, loc='upper right')
ax.grid(True, alpha=0.22, lw=0.5, zorder=1)
ax.tick_params(labelsize=9)
ax.set_xlim(0, D)

plt.tight_layout()
out_path = '/var/www/sigma/book/figures/stories/dd_curve.svg'
fig.savefig(out_path, bbox_inches='tight')
print(f'Saved: {out_path}')
