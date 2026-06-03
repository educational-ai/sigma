"""
Генератор: eigen_modes.svg
Четыре моды однородной балки (аналогия мосту).
- Единый цвет #1F4E79, разный alpha для визуальной дифференциации
- Заголовок честный: «аналогия», не «Такома»
- Частоты мод подписаны (f₁, 2f₁, 3f₁, 4f₁)
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

BASE   = '#1F4E79'

L = 853.0         # длина (м), Такома = 853 м
f1 = 0.2          # первая мода ≈ 0.2 Гц (приближение для Такомы)
n_x = 300
x = np.linspace(0, L, n_x)

alphas = [1.0, 0.78, 0.58, 0.42]

fig, axes = plt.subplots(4, 1, figsize=(9, 7), sharex=True)
fig.patch.set_facecolor('#fffff8')

for k_mode in range(4):
    k = k_mode + 1
    mode = np.sin(k * np.pi * x / L)
    freq = k * f1

    ax = axes[k_mode]
    ax.set_facecolor('#fffff8')
    ax.plot(x, mode, color=BASE, lw=1.6, alpha=alphas[k_mode])
    ax.fill_between(x, mode, alpha=0.08 + 0.04 * k_mode, color=BASE)
    ax.axhline(0, color='#888888', lw=0.6, ls='-')

    # узловые точки
    nodes = [i * L / k for i in range(1, k)]
    for nx in nodes:
        ax.axvline(nx, color='#888888', lw=0.5, ls=':')

    ax.set_ylabel(f'Мода {k}\n$f \\approx {freq:.1f}$ Гц', fontsize=9, labelpad=4)
    ax.set_ylim(-1.45, 1.45)
    ax.set_xlim(0, L)
    ax.tick_params(labelsize=8)
    ax.spines[['top', 'right']].set_visible(False)
    ax.grid(True, alpha=0.2, lw=0.4, color='gray')

axes[3].set_xlabel('Расстояние вдоль моста (м)', fontsize=10)
axes[0].set_title(
    'Изгибные моды однородной балки (аналогия Такоме)\n'
    '$f_1 \\approx 0.2$ Гц; крутильная мода Такомы — аналогичная, вокруг продольной оси',
    fontsize=11
)

plt.tight_layout(pad=0.8)
out_path = '/var/www/sigma/book/figures/stories/eigen_modes.svg'
plt.savefig(out_path, format='svg', bbox_inches='tight', facecolor='#fffff8')
print(f"Saved: {out_path}")
