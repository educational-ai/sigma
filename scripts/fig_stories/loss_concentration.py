"""
Генератор: loss_concentration.svg
Концентрация попарных расстояний в высоких измерениях.
N=500 точек равномерно в [0,1]^d, выборка попарных расстояний.
- Общая (зафиксированная) ось X для всех 4 панелей — sharex=True
  → видно, как распределение сужается от d=2 до d=1000
- Единый цвет #1F4E79 для всех баров
- Красная вертикаль = теоретическое среднее sqrt(d/6)
- CV (коэффициент вариации) — мелкая подпись отдельно от d
- Стиль: serif, spines top/right off, тонкая сетка
"""
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

plt.rcParams.update({
    'font.family': 'serif',
    'font.serif': ['DejaVu Serif', 'Times New Roman', 'serif'],
    'mathtext.fontset': 'dejavuserif',
    'axes.facecolor': '#fffff8',
    'figure.facecolor': '#fffff8',
})

BASE = '#1F4E79'
RED  = '#C0392B'

rng = np.random.default_rng(42)
N = 400  # число точек
N_PAIRS = 3000  # случайная выборка пар

dims = [2, 10, 100, 1000]

# Сначала вычислим все расстояния, чтобы найти общий xlim
all_dists = []
for d in dims:
    pts = rng.uniform(0, 1, size=(N, d))
    idx = rng.choice(N, size=(N_PAIRS, 2), replace=True)
    mask = idx[:, 0] != idx[:, 1]
    idx = idx[mask][:N_PAIRS]
    diffs = pts[idx[:, 0]] - pts[idx[:, 1]]
    dists = np.linalg.norm(diffs, axis=1)
    all_dists.append(dists)

# Общий диапазон оси X
x_min = 0.0
x_max = max(d.max() for d in all_dists) * 1.05

fig, axes = plt.subplots(1, 4, figsize=(12, 3.5), sharey=False)
fig.patch.set_facecolor('#fffff8')

for i, (d, dists) in enumerate(zip(dims, all_dists)):
    ax = axes[i]
    ax.set_facecolor('#fffff8')

    mu = dists.mean()
    sigma = dists.std()
    cv = sigma / mu

    n_bins = 35
    ax.hist(dists, bins=n_bins, range=(x_min, x_max),
            color=BASE, alpha=0.78, density=True)

    # Теоретическое среднее sqrt(d/6)
    mu_theory = np.sqrt(d / 6)
    ax.axvline(mu_theory, color=RED, lw=1.4, ls='--', alpha=0.85)

    ax.set_xlim(x_min, x_max)
    ax.spines[['top', 'right']].set_visible(False)
    ax.grid(True, axis='y', alpha=0.2, lw=0.5, color='gray')
    ax.tick_params(labelsize=8)

    # Заголовок: d крупно, CV мелко
    ax.set_title(f'$d = {d}$', fontsize=11, pad=3)
    ax.text(0.97, 0.95, f'CV={cv:.3f}', transform=ax.transAxes,
            fontsize=8, color='#555555', ha='right', va='top')

    if i == 0:
        ax.set_ylabel('Плотность', fontsize=10)
    ax.set_xlabel('Расстояние', fontsize=9)

fig.suptitle(
    'При росте размерности все попарные расстояния сходятся к одному значению',
    fontsize=11, y=1.01
)

plt.tight_layout(pad=0.6, w_pad=1.2)
out_path = '/var/www/sigma/book/figures/stories/loss_concentration.svg'
plt.savefig(out_path, format='svg', bbox_inches='tight', facecolor='#fffff8')
print(f"Saved: {out_path}")
print(f"x_max={x_max:.3f}, dims means: {[f'd={d}:{np.sqrt(d/6):.2f}' for d in dims]}")
