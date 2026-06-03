"""
Генератор: loss_shell.svg
Доля объёма шара, сосредоточенная в тонкой корке толщиной εR:
  P(d, ε) = 1 - (1-ε)^d

- Кривые для d = 2, 10, 50, 100 в градиенте от светло-синего до тёмно-синего
- d=100 выделен красным #C0392B
- Аннотация точки (ε=0.05, d=100) ≈ 99.4%
- Стиль: serif, spines top/right off, тонкая сетка, легенда без рамки
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

BASE_LIGHT  = '#A8C8E8'
BASE_MID1   = '#6FA8D0'
BASE_MID2   = '#4A7DAE'
BASE_DARK   = '#1F4E79'
RED         = '#C0392B'

dims = [2, 10, 50, 100]
colors = [BASE_LIGHT, BASE_MID1, BASE_MID2, BASE_DARK]
eps_arr = np.linspace(0, 0.3, 300)

fig, ax = plt.subplots(figsize=(8, 4.5))
fig.patch.set_facecolor('#fffff8')
ax.set_facecolor('#fffff8')

for d, c in zip(dims[:-1], colors[:-1]):
    P = 1 - (1 - eps_arr)**d
    ax.plot(eps_arr, P, color=c, lw=2.0, label=f'$d = {d}$')

# d=100 — особая линия, красным
d100 = 100
P100 = 1 - (1 - eps_arr)**d100
ax.plot(eps_arr, P100, color=RED, lw=2.5, label=f'$d = {d100}$')

# Аннотация: ε=0.05, d=100 → P≈99.4%
eps_mark = 0.05
P_mark = 1 - (1 - eps_mark)**d100
ax.scatter([eps_mark], [P_mark], color=RED, s=70, zorder=6)
ax.annotate(f'$\\varepsilon=0.05,\\ d=100$\n$\\approx 99.4\\%$ объёма в корке',
            xy=(eps_mark, P_mark),
            xytext=(0.10, 0.72),
            fontsize=9, color=RED,
            arrowprops=dict(arrowstyle='->', color=RED, lw=1.0),
            ha='left')

ax.set_xlabel(r'Относительная толщина корки $\varepsilon$', fontsize=11)
ax.set_ylabel(r'Доля объёма в корке', fontsize=11)
ax.set_title('Почти весь объём шара — в тонкой оболочке у поверхности', fontsize=12)
ax.set_xlim(0, 0.30)
ax.set_ylim(-0.02, 1.05)
ax.yaxis.set_major_formatter(matplotlib.ticker.PercentFormatter(xmax=1, decimals=0))
ax.tick_params(labelsize=9)
ax.spines[['top', 'right']].set_visible(False)
ax.grid(True, alpha=0.2, lw=0.5, color='gray')
ax.legend(fontsize=9, frameon=False, loc='lower right')

plt.tight_layout(pad=0.8)
out_path = '/var/www/sigma/book/figures/stories/loss_shell.svg'
plt.savefig(out_path, format='svg', bbox_inches='tight', facecolor='#fffff8')
print(f"Saved: {out_path}")
