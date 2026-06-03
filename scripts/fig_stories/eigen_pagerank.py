"""
Генератор: eigen_pagerank.svg
Левый panel: сходимость PageRank (степенной метод, 6 страниц)
Правый panel: финальные рейтинги страниц (bar chart)
Стиль: книжный (serif, #1F4E79-palette, spines top/right off)
"""
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

# --- параметры стиля ---
plt.rcParams.update({
    'font.family': 'serif',
    'font.serif': ['DejaVu Serif', 'Times New Roman', 'serif'],
    'mathtext.fontset': 'dejavuserif',
    'axes.facecolor': '#fffff8',
    'figure.facecolor': '#fffff8',
})

BASE   = '#1F4E79'
SHADES = ['#1F4E79', '#2E6FA3', '#3D8FCC', '#C0392B', '#82C4EE', '#2E7D5B']
ACCENT = '#C0392B'

# --- данные: маленький веб 6 страниц ---
edges = {0: [1, 2], 1: [2], 2: [0], 3: [2, 5], 4: [5], 5: [0, 4]}
n = 6
M = np.zeros((n, n))
for j, targets in edges.items():
    for i in targets:
        M[i, j] = 1.0 / len(targets)

alpha = 0.85
M_damped = alpha * M + (1 - alpha) / n * np.ones((n, n))

# Степенной метод — сохраняем историю
pi = np.ones(n) / n
history = [pi.copy()]
for _ in range(60):
    pi = M_damped @ pi
    pi /= pi.sum()
    history.append(pi.copy())

history = np.array(history)   # (61, 6)
final_pi = history[-1]

# --- фигура ---
fig, (ax_left, ax_right) = plt.subplots(1, 2, figsize=(10, 4))
fig.patch.set_facecolor('#fffff8')

# LEFT: сходимость
for i in range(n):
    ax_left.plot(history[:, i], color=SHADES[i], lw=1.5, label=f'Страница {i}')

ax_left.set_xlabel('Итерация', fontsize=10)
ax_left.set_ylabel('Рейтинг PageRank', fontsize=10)
ax_left.set_title('Сходимость степенного метода', fontsize=12)
ax_left.tick_params(labelsize=9)
ax_left.spines[['top', 'right']].set_visible(False)
ax_left.grid(True, alpha=0.25, lw=0.5, color='gray')
ax_left.legend(fontsize=8, frameon=False, ncol=2)
ax_left.set_facecolor('#fffff8')
ax_left.set_xlim(0, 60)

# RIGHT: финальные рейтинги
bars = ax_right.bar(
    [f'{i}' for i in range(n)],
    final_pi,
    color=SHADES,
    edgecolor='none',
    width=0.6,
)
ax_right.set_xlabel('Страница', fontsize=10)
ax_right.set_ylabel('PageRank', fontsize=10)
ax_right.set_title('Финальные рейтинги (100 итераций)', fontsize=12)
ax_right.tick_params(labelsize=9)
ax_right.spines[['top', 'right']].set_visible(False)
ax_right.grid(True, alpha=0.25, lw=0.5, color='gray', axis='y')
ax_right.set_facecolor('#fffff8')

# подписи значений над столбцами
for bar, val in zip(bars, final_pi):
    ax_right.text(
        bar.get_x() + bar.get_width() / 2,
        val + 0.002,
        f'{val:.3f}',
        ha='center', va='bottom', fontsize=8, color='#333333'
    )

plt.tight_layout(pad=1.2)
out_path = '/var/www/sigma/book/figures/stories/eigen_pagerank.svg'
plt.savefig(out_path, format='svg', bbox_inches='tight', facecolor='#fffff8')
print(f"Saved: {out_path}")
