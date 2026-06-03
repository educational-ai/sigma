"""
pca_eigenfaces.py — Среднее лицо и первые 15 eigenfaces (Olivetti Faces).
Sigma-стиль: serif, grayscale eigenfaces, среднее лицо отделено рамкой,
читаемые подписи, достаточная высота панели.
"""
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from sklearn.datasets import fetch_olivetti_faces
from sklearn.decomposition import PCA

plt.rcParams.update({
    'font.family': 'serif',
    'font.serif': ['DejaVu Serif', 'Times New Roman'],
    'mathtext.fontset': 'dejavuserif',
})

# --- данные ---
data = fetch_olivetti_faces(shuffle=True, random_state=42)
X = data.data     # (400, 4096)
img_shape = (64, 64)

# --- PCA ---
n_components = 15
pca = PCA(n_components=n_components, svd_solver='randomized', random_state=42)
pca.fit(X)

mean_face = pca.mean_.reshape(img_shape)
eigenfaces = pca.components_.reshape((n_components,) + img_shape)

# Нормировка eigenfaces для отображения: симметричный диапазон → coolwarm
def sym_norm(img):
    mx = max(abs(img.min()), abs(img.max())) + 1e-8
    return (img + mx) / (2 * mx)  # → [0,1] с нулём в центре

# --- компоновка: 1 + 15 = 16 картинок, 2 строки ---
# Строка 1: среднее лицо + 8 eigenfaces
# Строка 2: пустая + 7 eigenfaces
n_cols = 8
n_rows = 2
fig, axes = plt.subplots(n_rows, n_cols, figsize=(14, 4.2))

for ax in axes.flat:
    ax.axis('off')

# Среднее лицо (верхний левый, отдельное выделение)
ax_mean = axes[0, 0]
ax_mean.imshow(mean_face, cmap='gray', interpolation='nearest')
ax_mean.set_title('Среднее\nлицо', fontsize=9, fontfamily='serif', color='#555555')
# рамка для визуального отделения
for spine in ax_mean.spines.values():
    spine.set_visible(True)
    spine.set_linewidth(1.5)
    spine.set_edgecolor('#C0392B')
ax_mean.axis('on')
ax_mean.set_xticks([])
ax_mean.set_yticks([])

# Eigenfaces: первые 7 в строке 1 (позиции 1..7), следующие 8 в строке 2 (позиции 0..7)
positions = []
for col in range(1, 8):   # строка 0, столбцы 1–7 → PC 1–7
    positions.append((0, col))
for col in range(0, 8):   # строка 1, столбцы 0–7 → PC 8–15
    positions.append((1, col))

for idx, (row, col) in enumerate(positions):
    if idx >= n_components:
        break
    ax = axes[row, col]
    ef = sym_norm(eigenfaces[idx])
    ax.imshow(ef, cmap='gray', interpolation='nearest', vmin=0, vmax=1)
    ax.set_title(f'PC {idx+1}', fontsize=9, fontfamily='serif', color='#1F4E79')
    ax.axis('on')
    ax.set_xticks([])
    ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_visible(False)

fig.suptitle('Eigenfaces: среднее лицо и первые 15 главных компонент (Olivetti Faces 64×64)',
             fontsize=12, fontfamily='serif', y=1.01)
fig.tight_layout(pad=0.4)
fig.savefig(
    '/var/www/sigma/book/figures/stories/pca_eigenfaces.svg',
    bbox_inches='tight'
)
print("pca_eigenfaces.svg saved.")
