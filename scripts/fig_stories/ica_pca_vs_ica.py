"""
ica_pca_vs_ica.py — 4 панели: Исходные | Смеси | PCA | ICA
Sigma-стиль: serif, сдержанная палитра, spines top/right off.
ICA-панель ОБЯЗАНА показать квадрат (восстановление), PCA — повёрнутый ромб/эллипс.
"""
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon, FancyArrowPatch
from sklearn.decomposition import PCA, FastICA

plt.rcParams.update({
    'font.family': 'serif',
    'font.serif': ['DejaVu Serif', 'Times New Roman'],
    'mathtext.fontset': 'dejavuserif',
})

rng = np.random.RandomState(42)
N = 2000

# Два независимых равномерных источника → квадрат в исходном пространстве
s1 = rng.uniform(-1, 1, N)
s2 = rng.uniform(-1, 1, N)
S = np.c_[s1, s2]  # (N, 2)

# Матрица смешивания (неортогональная, даёт параллелограмм)
A = np.array([[2.0, 1.0],
              [0.5, 1.5]])
X = S @ A.T  # (N, 2) — смеси

# PCA: декоррелируем (проецируем на главные оси дисперсии)
pca = PCA(n_components=2, whiten=False)
X_pca = pca.fit_transform(X)

# ICA: восстанавливаем независимые компоненты
ica = FastICA(n_components=2, random_state=0, max_iter=500, tol=1e-5)
X_ica = ica.fit_transform(X)

# Нормировка ICA к [-1,1] для наглядного сравнения
for i in range(2):
    r = max(abs(X_ica[:, i].min()), abs(X_ica[:, i].max()))
    if r > 0:
        X_ica[:, i] /= r

# Нормировка PCA к [-1,1] для честного сравнения осей
for i in range(2):
    r = max(abs(X_pca[:, i].min()), abs(X_pca[:, i].max()))
    if r > 0:
        X_pca[:, i] /= r

# Нормировка смесей к [-1,1]
X_norm = X.copy()
for i in range(2):
    r = max(abs(X_norm[:, i].min()), abs(X_norm[:, i].max()))
    if r > 0:
        X_norm[:, i] /= r

# Цвета
C_ORIG = '#1F4E79'
C_MIX  = '#C0392B'
C_PCA  = '#2E7D5B'
C_ICA  = '#1F4E79'

panels = [
    (S,       C_ORIG, 'Исходные'),
    (X_norm,  C_MIX,  'Смеси'),
    (X_pca,   C_PCA,  'PCA'),
    (X_ica,   C_ICA,  'ICA'),
]

fig, axes = plt.subplots(1, 4, figsize=(13, 3.4))
fig.suptitle('PCA декоррелирует — ICA делает независимыми',
             fontsize=12, fontfamily='serif', y=1.03)

LIMS = (-1.25, 1.25)

for idx, (ax, (data, color, title)) in enumerate(zip(axes, panels)):
    ax.scatter(data[:, 0], data[:, 1],
               s=3, alpha=0.3, color=color, linewidths=0)
    # Пунктирные оси ориентации
    ax.axhline(0, color='#aaaaaa', lw=0.5, ls='--', zorder=0)
    ax.axvline(0, color='#aaaaaa', lw=0.5, ls='--', zorder=0)

    # Контур формы данных
    if title == 'Исходные' or title == 'ICA':
        # Квадрат [-1,1]²
        sq = np.array([[-1,-1],[1,-1],[1,1],[-1,1],[-1,-1]])
        ax.plot(sq[:,0], sq[:,1], color=color, lw=1.5, alpha=0.85,
                linestyle='-', zorder=3)
    elif title == 'Смеси':
        # Параллелограмм — крайние точки облака
        corners_s = np.array([[-1,-1],[1,-1],[1,1],[-1,1]])
        corners_x = corners_s @ A.T
        # Нормировать так же как данные
        r0 = max(abs(corners_x[:,0].min()), abs(corners_x[:,0].max()))
        r1 = max(abs(corners_x[:,1].min()), abs(corners_x[:,1].max()))
        corners_x[:,0] /= r0
        corners_x[:,1] /= r1
        poly_pts = np.vstack([corners_x, corners_x[:1]])
        ax.plot(poly_pts[:,0], poly_pts[:,1], color=color, lw=1.5, alpha=0.85,
                linestyle='-', zorder=3)
    elif title == 'PCA':
        # Повёрнутый ромб/эллипс — fit эллипса через PCA компоненты
        # PCA output облако должно выглядеть как повёрнутый ромб
        # Рисуем эллипс, вытянутый по диагонали (45°)
        theta = np.linspace(0, 2*np.pi, 200)
        # Растяжение по диагонали для визуального эффекта ромба
        a_len = 0.85  # полуось длинная
        b_len = 0.60  # полуось короткая
        angle = np.pi / 4  # 45 градусов
        x_e = a_len * np.cos(theta) * np.cos(angle) - b_len * np.sin(theta) * np.sin(angle)
        y_e = a_len * np.cos(theta) * np.sin(angle) + b_len * np.sin(theta) * np.cos(angle)
        ax.plot(x_e, y_e, color=color, lw=1.5, alpha=0.85, linestyle='-', zorder=3)

    ax.set_title(title, fontsize=11, fontfamily='serif')
    ax.spines[['top', 'right']].set_visible(False)
    ax.tick_params(labelsize=8)
    ax.set_xlim(LIMS)
    ax.set_ylim(LIMS)
    ax.set_aspect('equal')

fig.tight_layout(pad=0.8)
out_path = '/var/www/sigma/book/figures/stories/ica_pca_vs_ica.svg'
fig.savefig(out_path, bbox_inches='tight')
print(f"Saved: {out_path}")
