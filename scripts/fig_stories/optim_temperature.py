"""
optim_temperature.svg — температура в softmax LLM.
Пять панелей (T = 0.1, 0.5, 1, 2, 5) показывают одно распределение токенов
при разных температурах. Градиент холодный→горячий: #1F4E79 → #C0392B.
"""
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.colors as mcolors

plt.rcParams['font.family'] = 'serif'
plt.rcParams['font.serif'] = ['DejaVu Serif', 'Times New Roman']
plt.rcParams['mathtext.fontset'] = 'dejavuserif'

# Фиксированные логиты для небольшого словаря из 5 токенов
tokens = ['the', 'a', 'one', 'some', 'any']
logits = np.array([3.0, 1.5, 0.8, 0.3, 0.1])  # "the" явно доминирует при низкой T

temps = [0.1, 0.5, 1.0, 2.0, 5.0]

# Градиент от холодного (#1F4E79) к горячему (#C0392B)
cold = np.array(mcolors.to_rgb('#1F4E79'))
warm = np.array(mcolors.to_rgb('#C0392B'))
n = len(temps)
bar_colors = [tuple(cold + (warm - cold) * i / (n - 1)) for i in range(n)]

fig, axes = plt.subplots(1, n, figsize=(9, 3.2), sharey=True)
fig.patch.set_facecolor('#fffff8')

for ax, T, color in zip(axes, temps, bar_colors):
    scaled = logits / T
    probs = np.exp(scaled - scaled.max())
    probs /= probs.sum()

    bars = ax.bar(tokens, probs, color=color, alpha=0.88,
                  edgecolor='white', linewidth=1.2)

    ax.set_title(f'$T = {T}$', fontsize=11, fontweight='bold', pad=6)
    ax.tick_params(axis='x', labelsize=9, rotation=45)
    ax.tick_params(axis='y', labelsize=9)
    ax.spines[['top', 'right']].set_visible(False)
    ax.set_facecolor('#fffff8')
    ax.yaxis.grid(True, alpha=0.25, linewidth=0.5, color='#888888')
    ax.set_axisbelow(True)

axes[0].set_ylabel('P(токен)', fontsize=10)
axes[0].set_ylim(0, 1.05)

# Горизонтальная надпись под фигурой
fig.text(0.5, 0.0, 'холодный кристалл                                                                              раскалённый металл',
         ha='center', va='bottom', fontsize=8.5, color='#555555', style='italic')

plt.tight_layout(rect=[0, 0.05, 1, 1])
plt.savefig('/var/www/sigma/book/figures/stories/optim_temperature.svg',
            format='svg', bbox_inches='tight', facecolor='#fffff8')
print("Saved optim_temperature.svg")
