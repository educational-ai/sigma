"""
Генератор: loss_volume.svg
Объём единичного шара V_d = π^(d/2) / Γ(d/2 + 1) как функция d.
- Линия V=1 подписана честно на уровне y=1
- Дополнительная метка: максимум при d=2, V_2=π≈3.14 (и d≈5 где V≈5.26)
- Стиль: serif, #1F4E79, spines top/right off, тонкая сетка
"""
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from scipy.special import gamma

plt.rcParams.update({
    'font.family': 'serif',
    'font.serif': ['DejaVu Serif', 'Times New Roman', 'serif'],
    'mathtext.fontset': 'dejavuserif',
    'axes.facecolor': '#fffff8',
    'figure.facecolor': '#fffff8',
})

BASE = '#1F4E79'
RED  = '#C0392B'

# Вычислим объём V_d для d от 1 до 25
d_arr = np.arange(1, 26)
V_arr = np.array([np.pi**(d/2) / gamma(d/2 + 1) for d in d_arr])

# Для плавной кривой
d_cont = np.linspace(1, 25, 300)
V_cont = np.array([np.pi**(d/2) / gamma(d/2 + 1) for d in d_cont])

fig, ax = plt.subplots(figsize=(8, 4.5))
fig.patch.set_facecolor('#fffff8')
ax.set_facecolor('#fffff8')

ax.fill_between(d_cont, V_cont, alpha=0.07, color=BASE)
ax.plot(d_cont, V_cont, color=BASE, lw=2.0, label=r'$V_d$')

# Отметить максимум при d=5 (V≈5.26)
d_max_idx = np.argmax(V_cont)
d_max = d_cont[d_max_idx]
V_max = V_cont[d_max_idx]
ax.scatter([d_max], [V_max], color=RED, s=55, zorder=5)
ax.annotate(f'максимум при $d \\approx 5$\n$V_5 \\approx 5.26$',
            xy=(d_max, V_max), xytext=(8.5, 5.2),
            fontsize=9, color=RED,
            arrowprops=dict(arrowstyle='->', color=RED, lw=1.0),
            ha='left')

# Горизонтальная линия V=1 на правильном уровне y=1
ax.axhline(1.0, color=RED, lw=1.2, ls='--', alpha=0.7, label='$V = 1$')
# Найдём первое пересечение V=1 (при убывании)
idx_cross = np.where(np.diff(np.sign(V_cont - 1.0)))[0]
if len(idx_cross) > 1:
    d_cross = d_cont[idx_cross[1]]  # второй переход (убывание)
    ax.annotate(f'$V_d = 1$',
                xy=(d_cross, 1.0), xytext=(d_cross + 2, 1.8),
                fontsize=9, color=RED,
                arrowprops=dict(arrowstyle='->', color=RED, lw=0.9),
                ha='left')

ax.set_xlabel('Размерность $d$', fontsize=11)
ax.set_ylabel('Объём $V_d$', fontsize=11)
ax.set_title('Объём единичного шара стремится к нулю с ростом размерности',
             fontsize=12)
ax.tick_params(labelsize=9)
ax.set_xlim(1, 25)
ax.set_ylim(-0.2, 5.8)
ax.spines[['top', 'right']].set_visible(False)
ax.grid(True, alpha=0.2, lw=0.5, color='gray')
ax.legend(fontsize=9, frameon=False, loc='upper right')

plt.tight_layout(pad=0.8)
out_path = '/var/www/sigma/book/figures/stories/loss_volume.svg'
plt.savefig(out_path, format='svg', bbox_inches='tight', facecolor='#fffff8')
print(f"Saved: {out_path}")
