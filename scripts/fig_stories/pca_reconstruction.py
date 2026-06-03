"""
pca_reconstruction.py — Восстановление лица из eigenfaces при разном k.
Показывает прогрессию: Оригинал | k=1 | k=5 | k=10 | k=25 | k=50 | k=100 | k=200
Sigma-стиль: serif, grayscale, no spines, унифицированные подписи,
тонкая рамка-разделитель между Оригиналом и k=1.
"""
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch
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

# Выбрать лицо #7 (красивое)
face_idx = 7
face = X[face_idx]

# --- PCA с полным числом компонент ---
n_max = 200
pca = PCA(n_components=n_max, svd_solver='randomized', random_state=42)
pca.fit(X)

mean_face = pca.mean_
face_centered = face - mean_face
coords = pca.components_ @ face_centered  # (n_max,)

ks = [1, 5, 10, 25, 50, 100, 200]

def reconstruct(k):
    return mean_face + pca.components_[:k].T @ coords[:k]

# --- рисуем ---
n_panels = 1 + len(ks)
fig, axes = plt.subplots(1, n_panels, figsize=(14, 2.8))

lbl_size = 10

# Оригинал
axes[0].imshow(face.reshape(img_shape), cmap='gray', interpolation='nearest',
               vmin=0, vmax=1)
axes[0].set_title('Оригинал', fontsize=lbl_size, fontfamily='serif', fontweight='normal',
                  color='#333333')
axes[0].set_xticks([])
axes[0].set_yticks([])
# только левая и нижняя рамки у оригинала, цвет акцент
for sp_name, sp in axes[0].spines.items():
    if sp_name in ('bottom', 'left'):
        sp.set_visible(True)
        sp.set_linewidth(1.2)
        sp.set_edgecolor('#1F4E79')
    else:
        sp.set_visible(False)

# Реконструкции
for i, k in enumerate(ks):
    ax = axes[i + 1]
    rec = reconstruct(k)
    ax.imshow(rec.reshape(img_shape), cmap='gray', interpolation='nearest',
              vmin=0, vmax=1)
    ax.set_title(f'$k={k}$', fontsize=lbl_size, fontfamily='serif', color='#1F4E79')
    ax.set_xticks([])
    ax.set_yticks([])
    for sp in ax.spines.values():
        sp.set_visible(False)

fig.suptitle('Восстановление лица из eigenfaces при разном числе компонент $k$',
             fontsize=12, fontfamily='serif', y=1.03)
fig.tight_layout(pad=0.5, w_pad=0.4)
fig.savefig(
    '/var/www/sigma/book/figures/stories/pca_reconstruction.svg',
    bbox_inches='tight'
)
print("pca_reconstruction.svg saved.")
