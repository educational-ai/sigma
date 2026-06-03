"""
Генератор: dd_fits.svg
Три режима подгонки.

ЧЕСТНАЯ демонстрация: используем kernel ridge regression (KRR)
с RBF ядром k(x,x') = exp(-||x-x'||²/(2σ²)).

Все три панели — одна и та же задача, n=30, f(x)=sin(πx).
Разница — только гиперпараметр λ (regularization):

  λ=10   (много рег.): гладкое UNDERFITTING — не проходит через точки
  λ=1e-8 (мало рег.):  INTERPOLATION — проходит, но шпиль на пике DD
  λ=0.01 (оптимальный): SMOOTH INTERPOLATION — проходит И гладкое

ЧЕСТНОСТЬ: три λ с одной и той же моделью (KRR).
Это иллюстрирует continuous interpolation threshold.
Связь с DD: λ→0 соответствует переходу через порог P≈n.
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

BLUE  = '#1F4E79'
RED   = '#C0392B'
GREEN = '#2E7D5B'

# ── данные ─────────────────────────────────────────────────────────────────
np.random.seed(7)
n = 30
sigma_data = 0.3

x_train = np.sort(np.random.uniform(-1, 1, n))
y_train = np.sin(np.pi * x_train) + sigma_data * np.random.randn(n)
x_grid  = np.linspace(-1.2, 1.2, 600)
y_true  = np.sin(np.pi * x_grid)

# ── KRR с RBF ядром ────────────────────────────────────────────────────────
sigma_rbf = 0.2  # bandwidth (уже → более локальная → более дикие осцилляции)

def rbf_matrix(x1, x2, sigma):
    """K[i,j] = exp(-(x1[i]-x2[j])²/(2σ²))"""
    diff = x1[:, None] - x2[None, :]
    return np.exp(-diff**2 / (2 * sigma**2))

def krr_predict(x_train, y_train, x_grid, lam, sigma_rbf):
    K_tr = rbf_matrix(x_train, x_train, sigma_rbf)  # (n,n)
    K_te = rbf_matrix(x_grid,  x_train, sigma_rbf)  # (m,n)
    alpha = np.linalg.solve(K_tr + lam * np.eye(n), y_train)
    y_pred_tr = K_tr @ alpha
    y_pred_gr = K_te @ alpha
    tr_mse = float(np.mean((y_pred_tr - y_train)**2))
    te_mse = float(np.mean((y_pred_gr - y_true)**2))
    return y_pred_gr, tr_mse, te_mse

# Проверить числа
print("=== Числа (KRR, RBF kernel) ===")
for lam, name in [(10.0, 'λ=10 (ундерфит)'), (1e-9, 'λ=1e-9 (шпиль)'), (0.05, 'λ=0.05 (опт)')]:
    yp, tr, te = krr_predict(x_train, y_train, x_grid, lam, sigma_rbf)
    print(f"  {name}: train={tr:.4f}, test={te:.4f}, max|y|={np.abs(yp).max():.2f}")

# ── фигура ──────────────────────────────────────────────────────────────────
scenarios = [
    dict(lam=10.0, label='Сильная регуляризация\n(недообучение)',         color=BLUE),
    dict(lam=1e-9, label='Слабая регуляризация\n(шпиль интерполяции)',    color=RED),
    dict(lam=0.05,  label='Оптимальная регуляризация\n(гладкое решение)', color=GREEN),
]

fig, axes = plt.subplots(1, 3, figsize=(11, 3.9))
fig.subplots_adjust(wspace=0.30)

for ax, sc in zip(axes, scenarios):
    yp, tr_mse, te_mse = krr_predict(x_train, y_train, x_grid, sc['lam'], sigma_rbf)
    yp_clipped = np.clip(yp, -3.5, 3.5)

    ax.plot(x_grid, y_true,     color='#BBBBBB', lw=1.8, ls='--', zorder=2)
    ax.plot(x_grid, yp_clipped, color=sc['color'], lw=2.0, zorder=3)
    ax.scatter(x_train, y_train, color='#333333', s=22, zorder=5, alpha=0.85)

    ax.set_title(sc['label'], fontsize=9.5, color=sc['color'], fontweight='bold')
    ax.set_xlabel('$x$', fontsize=9)
    ax.set_ylabel('$y$', fontsize=9)
    ax.tick_params(labelsize=8)
    ax.set_xlim(-1.2, 1.2)
    ax.set_ylim(-3.2, 3.2)
    ax.grid(True, alpha=0.2, lw=0.5)

    note = f'train = {tr_mse:.3f}\ntest = {te_mse:.3f}'
    ax.text(0.97, 0.97, note, transform=ax.transAxes,
            fontsize=7.5, va='top', ha='right', color='#555555')

fig.suptitle(
    'Регуляризация управляет переходом от недообучения к переобучению и обратно',
    fontsize=10.0, y=1.02,
)

from matplotlib.lines import Line2D
fig.legend(handles=[
    Line2D([0], [0], color='#BBBBBB', ls='--', lw=1.8),
    Line2D([0], [0], color='#777777', lw=2.0),
    Line2D([0], [0], marker='o', color='w', markerfacecolor='#333333', markersize=6),
], labels=['истинная $f(x) = \\sin(\\pi x)$', 'модель', 'обучающие точки'],
   loc='lower center', ncol=3, fontsize=8.5, frameon=False,
   bbox_to_anchor=(0.5, -0.08))

plt.tight_layout()
out_path = '/var/www/sigma/book/figures/stories/dd_fits.svg'
fig.savefig(out_path, bbox_inches='tight')
print(f'Saved: {out_path}')
