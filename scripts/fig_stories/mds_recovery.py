"""
Генератор фигуры mds_recovery.svg
MDS: три панели — истинные координаты, восстановленные, сходимость стресса.
Стиль: Sigma/Tufte (serif, #1F4E79, spines off).
"""
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

plt.rcParams['font.family'] = 'serif'
plt.rcParams['font.serif'] = ['DejaVu Serif', 'Times New Roman', 'serif']
plt.rcParams['mathtext.fontset'] = 'dejavuserif'

# ─── Данные ───────────────────────────────────────────────────────────────────

np.random.seed(42)
n_cities = 10
true_coords = np.random.rand(n_cities, 2) * 100
city_names = [f'Город {i}' for i in range(n_cities)]

D = np.zeros((n_cities, n_cities))
for i in range(n_cities):
    for j in range(n_cities):
        D[i, j] = np.linalg.norm(true_coords[i] - true_coords[j])


def stress(W_flat, d=2):
    n = D.shape[0]
    W = W_flat.reshape(n, d)
    s = 0.0
    for i in range(n):
        for j in range(i + 1, n):
            s += (np.linalg.norm(W[i] - W[j]) - D[i, j]) ** 2
    return s


def stress_gradient(W_flat, d=2):
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


# ─── Оптимизация с историей стресса ──────────────────────────────────────────

np.random.seed(7)
W = np.random.randn(n_cities * 2) * 10
lr = 0.001
stress_history = []
n_steps = 2000

for step in range(n_steps):
    g = stress_gradient(W)
    W -= lr * g
    stress_history.append(stress(W))

W_recovered = W.reshape(n_cities, 2)

# Прокрустово выравнивание
W_recovered -= W_recovered.mean(axis=0)
true_centered = true_coords - true_coords.mean(axis=0)
U, _, Vt = np.linalg.svd(true_centered.T @ W_recovered)
R = U @ Vt
W_aligned = W_recovered @ R.T

# ─── Фигура: три панели ───────────────────────────────────────────────────────

fig, axes = plt.subplots(1, 3, figsize=(13, 4.4))
fig.patch.set_facecolor('#fffff8')

COLOR_CITY = '#1F4E79'
COLOR_STRESS = '#C0392B'

# Смещения подписей (в единицах данных ~80 диапазон)
# true_centered: 0=(0.5,40), 1=(36,5), 2=(-21,-39), 3=(-31,32),
#                4=(23,16),  5=(-35,42), 6=(46,-33), 7=(-19,-36),
#                8=(-7,-2),  9=(6,-25)
# Конфликт: Город 2 и Город 7 — разница всего 3-4 ед → разводим
label_offsets = {
    0: (1.5, 1.5),
    1: (1.5, 1.5),
    2: (-14, -5),    # Город 2 — левее и ниже
    3: (-14, 1.5),
    4: (1.5, 1.5),
    5: (1.5, 1.5),
    6: (1.5, 1.5),
    7: (2.5, 1.5),   # Город 7 — правее и чуть выше
    8: (1.5, 1.5),
    9: (1.5, -4),
}

for ax_idx, (ax, data, title) in enumerate(zip(
        axes[:2],
        [true_centered, W_aligned],
        ['Истинные координаты', 'Восстановленные (GD)'])):
    ax.set_facecolor('#fffff8')
    ax.scatter(data[:, 0], data[:, 1], s=70, color=COLOR_CITY, zorder=3)
    for i in range(n_cities):
        dx, dy = label_offsets.get(i, (1.5, 1.5))
        ax.annotate(city_names[i], (data[i, 0], data[i, 1]),
                    xytext=(data[i, 0] + dx, data[i, 1] + dy),
                    fontsize=8.5, color='#333333')
    ax.set_aspect('equal')
    ax.set_title(title, fontsize=12)
    ax.spines[['top', 'right']].set_visible(False)
    ax.grid(True, alpha=0.2, linewidth=0.5)
    ax.tick_params(labelsize=9)

# Третья панель: сходимость стресса
ax3 = axes[2]
ax3.set_facecolor('#fffff8')
iters = np.arange(1, n_steps + 1)
ax3.semilogy(iters, stress_history, color=COLOR_STRESS, linewidth=1.5)
ax3.set_xlabel('Итерация', fontsize=10)
ax3.set_ylabel('Стресс (лог. шкала)', fontsize=10)
ax3.set_title('Сходимость стресса', fontsize=12)
ax3.spines[['top', 'right']].set_visible(False)
ax3.grid(True, alpha=0.25, linewidth=0.5)
ax3.tick_params(labelsize=9)

fig.tight_layout(pad=1.5)
fig.savefig('/var/www/sigma/book/figures/stories/mds_recovery.svg',
            bbox_inches='tight', format='svg')
print(f"Saved mds_recovery.svg  |  final stress: {stress_history[-1]:.2f}")
