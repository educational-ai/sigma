"""
pca_scree.py — Scree plot для PCA на датасете Olivetti Faces (64×64).
Левая панель: индивидуальная объяснённая дисперсия (log-scale).
Правая панель: накопленная дисперсия + вертикальная линия при k где 95%.
Sigma-стиль: serif, #1F4E79/#C0392B, no top/right spines, frameon=False.
"""
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from sklearn.datasets import fetch_olivetti_faces
from sklearn.decomposition import PCA

plt.rcParams.update({
    'font.family': 'serif',
    'font.serif': ['DejaVu Serif', 'Times New Roman'],
    'mathtext.fontset': 'dejavuserif',
})

BLUE = '#1F4E79'
RED  = '#C0392B'
GREEN = '#2E7D5B'

# --- данные ---
data = fetch_olivetti_faces(shuffle=True, random_state=42)
X = data.data  # (400, 4096)

# Полный PCA — только по числу сэмплов
n_samples, n_features = X.shape  # 400, 4096
pca = PCA(n_components=n_samples, svd_solver='full')
pca.fit(X)

evr = pca.explained_variance_ratio_
cumulative = np.cumsum(evr)

# Найти реальное k для 95%
k95 = int(np.searchsorted(cumulative, 0.95)) + 1  # 1-based index

# --- рисуем ---
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4.2))

ks = np.arange(1, len(evr) + 1)

# --- Левая панель: индивидуальная дисперсия ---
ax1.plot(ks, evr, color=BLUE, linewidth=1.5, alpha=0.85)
ax1.set_yscale('log')
ax1.set_xlabel('Номер компоненты $k$', fontsize=10, fontfamily='serif')
ax1.set_ylabel('Доля объяснённой дисперсии', fontsize=10, fontfamily='serif')
ax1.set_title('Дисперсия каждой компоненты', fontsize=12, fontfamily='serif')
ax1.tick_params(labelsize=9)
ax1.spines[['top', 'right']].set_visible(False)
ax1.grid(True, which='major', linewidth=0.4, alpha=0.25, color='gray')
ax1.grid(True, which='minor', linewidth=0.2, alpha=0.12, color='gray')
ax1.set_xlim(1, min(200, len(evr)))

# --- Правая панель: накопленная дисперсия ---
ax2.plot(ks, cumulative, color=BLUE, linewidth=2.0)
# горизонтальная пунктирная линия на 95%
ax2.axhline(y=0.95, color=RED, linewidth=1.0, linestyle='--', alpha=0.7)
# вертикальная линия при k95
ax2.axvline(x=k95, color=RED, linewidth=1.5, linestyle='-', alpha=0.85)
# точка пересечения
ax2.scatter([k95], [cumulative[k95 - 1]], color=RED, zorder=5, s=40)
# аннотация
ax2.annotate(
    f'$k={k95}$: 95% дисперсии',
    xy=(k95, cumulative[k95 - 1]),
    xytext=(k95 - 70, 0.72),
    fontsize=9, fontfamily='serif', color=RED,
    arrowprops=dict(arrowstyle='->', color=RED, lw=1.0),
)
ax2.set_xlabel('Число компонент $k$', fontsize=10, fontfamily='serif')
ax2.set_ylabel('Накопленная доля дисперсии', fontsize=10, fontfamily='serif')
ax2.set_title(f'~{k95} компонент объясняют 95% дисперсии', fontsize=12, fontfamily='serif')
ax2.tick_params(labelsize=9)
ax2.spines[['top', 'right']].set_visible(False)
ax2.grid(True, linewidth=0.4, alpha=0.25, color='gray')
ax2.set_xlim(1, min(200, len(evr)))
ax2.set_ylim(0, 1.02)
ax2.yaxis.set_major_formatter(matplotlib.ticker.PercentFormatter(xmax=1.0))

fig.tight_layout()
fig.savefig(
    '/var/www/sigma/book/figures/stories/pca_scree.svg',
    bbox_inches='tight'
)
print(f"pca_scree.svg saved. k95={k95}")
