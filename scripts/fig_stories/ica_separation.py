"""
ica_separation.py — 3x3 сетка: источники / смеси / восстановленные.
Sigma-стиль: 3 цвета (синий/красный/зелёный), spines top/right off,
серые смеси, визуальное соответствие восстановленных источникам.
"""
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from sklearn.decomposition import FastICA

plt.rcParams.update({
    'font.family': 'serif',
    'font.serif': ['DejaVu Serif', 'Times New Roman'],
    'mathtext.fontset': 'dejavuserif',
})

# --- генерация сигналов ---
np.random.seed(42)
n_samples = 3000
t = np.linspace(0, 12, n_samples)

s1 = np.sin(2 * t)                         # синусоида
s2 = np.sign(np.sin(3 * t))                # меандр
s3 = (t % 1.5) / 1.5 - 0.5                # пила

S = np.c_[s1, s2, s3].T  # (3, n_samples)

# Нормировка источников к [-1,1]
for i in range(3):
    S[i] /= np.max(np.abs(S[i]))

A = np.array([[1.0, 0.5, 0.2],
              [0.3, 1.0, 0.7],
              [0.6, 0.4, 1.0]])
X = A @ S  # (3, n_samples)

ica = FastICA(n_components=3, random_state=0, max_iter=2000, tol=1e-10)
S_hat = ica.fit_transform(X.T).T  # (3, n_samples)

# Нормировка восстановленных к [-1,1]
for i in range(3):
    mx = np.max(np.abs(S_hat[i]))
    if mx > 0:
        S_hat[i] /= mx

# Сопоставление восстановленных с источниками по корреляции
SRC_COLORS = ['#1F4E79', '#C0392B', '#2E7D5B']
MIX_COLOR  = '#666666'

corr_matrix = np.abs(np.corrcoef(S, S_hat)[:3, 3:])  # (3 src, 3 hat)
perm = np.argmax(corr_matrix, axis=1)  # src i → hat perm[i]

# Показываем только первые 8 секунд для наглядности
show_mask = t <= 8.0
t_show = t[show_mask]

# --- рисуем ---
fig, axes = plt.subplots(3, 3, figsize=(11, 5.5), sharex=True)

row_labels = ['Источники', 'Смеси', 'Восстановлено']
src_labels  = ['Синусоида', 'Меандр', 'Пила']
mix_labels  = ['Микрофон 1', 'Микрофон 2', 'Микрофон 3']

for col in range(3):
    # --- ряд 0: источники ---
    ax = axes[0, col]
    ax.plot(t_show, S[col][show_mask], color=SRC_COLORS[col], lw=0.9)
    ax.set_title(f'Источник {col+1} ({src_labels[col]})', fontsize=9, fontfamily='serif')
    ax.spines[['top', 'right']].set_visible(False)
    ax.tick_params(labelsize=7)
    ax.set_ylim(-1.4, 1.4)

    # --- ряд 1: смеси ---
    ax = axes[1, col]
    ax.plot(t_show, X[col][show_mask], color=MIX_COLOR, lw=0.7, alpha=0.85)
    ax.set_title(f'{mix_labels[col]}', fontsize=9, fontfamily='serif')
    ax.spines[['top', 'right']].set_visible(False)
    ax.tick_params(labelsize=7)

    # --- ряд 2: восстановленные (цвет = цвет соответствующего источника) ---
    ax = axes[2, col]
    src_idx = int(np.argmax(corr_matrix[:, col]))
    hat_sig = S_hat[col].copy()
    # Исправляем знак если нужно
    if np.corrcoef(S[src_idx], hat_sig)[0, 1] < 0:
        hat_sig = -hat_sig
    ax.plot(t_show, hat_sig[show_mask], color=SRC_COLORS[src_idx], lw=0.9, alpha=0.9)
    ax.set_title(f'ICA: ≈ источник {src_idx+1}', fontsize=9, fontfamily='serif',
                 color=SRC_COLORS[src_idx])
    ax.spines[['top', 'right']].set_visible(False)
    ax.tick_params(labelsize=7)
    ax.set_ylim(-1.4, 1.4)

# Метки рядов слева
for row, label in enumerate(row_labels):
    axes[row, 0].set_ylabel(label, fontsize=9, fontfamily='serif', rotation=90,
                            labelpad=4)

# Метка оси X только снизу
for col in range(3):
    axes[2, col].set_xlabel('Время (с)', fontsize=8, fontfamily='serif')

fig.suptitle('ICA: разделение трёх сигналов (cocktail party problem)',
             fontsize=12, fontfamily='serif', y=1.01)

fig.tight_layout(pad=0.6, h_pad=0.8, w_pad=0.7)

out_path = '/var/www/sigma/book/figures/stories/ica_separation.svg'
fig.savefig(out_path, bbox_inches='tight')
print(f"Saved: {out_path}")
