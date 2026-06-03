"""
optim_pso.svg — PSO на функции Растригина (2D).
4 субграфика: it=1, 6, 21, 100.
Фон: пастельный контурный plot функции Растригина.
Частицы: синие точки (#1F4E79).
Стрелки скоростей: тонкие серые.
Глобальный минимум: жёлтая звезда (#FFD700).
Personal best: пустые кружки.
"""
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap

plt.rcParams['font.family'] = 'serif'
plt.rcParams['font.serif'] = ['DejaVu Serif', 'Times New Roman']
plt.rcParams['mathtext.fontset'] = 'dejavuserif'

np.random.seed(42)

def rastrigin_2d(x, y):
    return 20 + x**2 - 10 * np.cos(2 * np.pi * x) + y**2 - 10 * np.cos(2 * np.pi * y)

# Фоновая сетка для контурного графика
xx = np.linspace(-5.12, 5.12, 300)
yy = np.linspace(-5.12, 5.12, 300)
X, Y = np.meshgrid(xx, yy)
Z = rastrigin_2d(X, Y)

# Пастельная цветовая карта от светло-синего до белого
cmap_bg = LinearSegmentedColormap.from_list(
    'sigma_bg',
    ['#d0e4f0', '#eaf3f8', '#f5f9fc', '#ffffff'],
    N=256
)

# PSO параметры
n_particles = 30
bounds = (-5.12, 5.12)
w = 0.7
c1 = 1.5
c2 = 1.5

x = np.random.uniform(bounds[0], bounds[1], (n_particles, 2))
v = np.random.uniform(-0.5, 0.5, (n_particles, 2))
p_best = x.copy()
p_best_val = np.array([rastrigin_2d(xi[0], xi[1]) for xi in x])
g_best_idx = np.argmin(p_best_val)
g_best = p_best[g_best_idx].copy()
g_best_val = p_best_val[g_best_idx]

snapshots = {}
target_iters = {1, 6, 21, 100}

for t in range(1, 101):
    r1 = np.random.rand(n_particles, 2)
    r2 = np.random.rand(n_particles, 2)
    v = w * v + c1 * r1 * (p_best - x) + c2 * r2 * (g_best - x)
    x = np.clip(x + v, bounds[0], bounds[1])

    vals = np.array([rastrigin_2d(xi[0], xi[1]) for xi in x])
    improved = vals < p_best_val
    p_best[improved] = x[improved]
    p_best_val[improved] = vals[improved]

    best_idx = np.argmin(p_best_val)
    if p_best_val[best_idx] < g_best_val:
        g_best = p_best[best_idx].copy()
        g_best_val = p_best_val[best_idx]

    if t in target_iters:
        snapshots[t] = {
            'x': x.copy(),
            'v': v.copy(),
            'p_best': p_best.copy(),
            'g_best': g_best.copy(),
        }

fig, axes = plt.subplots(1, 4, figsize=(11, 3.2))
fig.patch.set_facecolor('#fffff8')

for ax, it in zip(axes, sorted(target_iters)):
    snap = snapshots[it]

    # Растеризуем всё с zorder < 1.5 (тяжёлый контурный фон — десятки тысяч
    # полигонов раздували SVG до ~19 МБ). Точки/стрелки/звезда/текст (zorder>=2)
    # остаются вектором и резкими. dpi в savefig задаёт чёткость растра.
    ax.set_rasterization_zorder(1.5)

    # Фон
    ax.contourf(X, Y, Z, levels=30, cmap=cmap_bg, alpha=0.9, zorder=0)
    ax.contour(X, Y, Z, levels=12, colors='#cccccc', linewidths=0.4,
               alpha=0.6, zorder=1)

    # Personal best: пустые кружки
    pb = snap['p_best']
    ax.scatter(pb[:, 0], pb[:, 1], s=18, facecolors='none',
               edgecolors='#1F4E79', linewidths=0.7, alpha=0.55, zorder=3)

    # Стрелки скоростей
    pos = snap['x']
    vel = snap['v']
    speed = np.sqrt((vel**2).sum(axis=1, keepdims=True))
    speed_max = speed.max() + 1e-9
    vel_norm = vel / speed_max * 0.5  # масштаб стрелок
    for i in range(n_particles):
        if speed[i, 0] > 1e-4:
            ax.annotate('', xy=(pos[i, 0] + vel_norm[i, 0],
                                pos[i, 1] + vel_norm[i, 1]),
                        xytext=(pos[i, 0], pos[i, 1]),
                        arrowprops=dict(arrowstyle='->', color='#888888',
                                        lw=0.6), zorder=2)

    # Частицы
    ax.scatter(pos[:, 0], pos[:, 1], s=22, color='#1F4E79',
               alpha=0.75, zorder=4)

    # Глобальный минимум (0,0)
    ax.plot(0, 0, marker='*', markersize=13, color='#FFD700',
            markeredgecolor='#B8860B', markeredgewidth=0.7, zorder=6)

    ax.set_xlim(-5.5, 5.5)
    ax.set_ylim(-5.5, 5.5)
    ax.set_title(f'Ит. {it}', fontsize=10.5, fontweight='bold', pad=4)
    ax.set_xticks([-4, 0, 4])
    ax.set_yticks([-4, 0, 4])
    ax.tick_params(labelsize=8.5)
    ax.spines[['top', 'right']].set_visible(False)
    ax.set_facecolor('#f5f9fc')

# Убрать лишние ytick labels у правых осей
for ax in axes[1:]:
    ax.set_yticklabels([])

# Подписи осей
axes[0].set_xlabel('$x_1$', fontsize=9.5)
axes[0].set_ylabel('$x_2$', fontsize=9.5)

# Легенда
from matplotlib.lines import Line2D
legend_elements = [
    Line2D([0], [0], marker='o', color='w', markerfacecolor='#1F4E79',
           markersize=7, label='частица'),
    Line2D([0], [0], marker='o', color='#1F4E79', markerfacecolor='none',
           markersize=7, label='personal best'),
    Line2D([0], [0], marker='*', color='w', markerfacecolor='#FFD700',
           markersize=10, markeredgecolor='#B8860B', label='глоб. минимум'),
]
axes[-1].legend(handles=legend_elements, fontsize=7.5,
                frameon=False, loc='lower right')

plt.suptitle('PSO: 30 частиц на функции Растригина — глобальный минимум (0,0)',
             fontsize=11, fontweight='bold', y=1.01)
plt.tight_layout()
plt.savefig('/var/www/sigma/book/figures/stories/optim_pso.svg',
            format='svg', bbox_inches='tight', facecolor="#fffff8", dpi=150)
print("Saved optim_pso.svg")
