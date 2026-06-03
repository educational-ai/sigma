"""
fft_matrix.py — матрица Фурье F_32 + разреженный butterfly-слой для n=8.
Три сабплота:
  1. Re(F_32) — тепловая карта
  2. Im(F_32) — тепловая карта
  3. Разреженная butterfly-матрица одного уровня БПФ (n=8) — контраст плотная/разреженная
Дом-стиль Сигма.
"""
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import TwoSlopeNorm

plt.rcParams.update({
    'font.family': 'serif',
    'font.serif': ['DejaVu Serif', 'Times New Roman'],
    'mathtext.fontset': 'dejavuserif',
})

# --- матрица Фурье F_32 ---
n32 = 32
j32 = np.arange(n32)
F32 = np.exp(-2j * np.pi * np.outer(j32, j32) / n32)

# --- butterfly-матрица первого уровня для n=8 ---
# Уровень 1 алгоритма Кули-Тьюки (Decimation-In-Time):
# объединяет пары (k, k+n/2) через twiddle-факторы.
# Для наглядности строим явную матрицу.
def butterfly_matrix_level1(n):
    """Первый butterfly-уровень DIT-FFT для размера n (step=1)."""
    M = np.zeros((n, n), dtype=complex)
    half = n // 2
    for k in range(half):
        w = np.exp(-2j * np.pi * k / n)
        # X_k     = E_k + w * O_k  (E=even, O=odd indices)
        # E_k -> столбец 2k, O_k -> столбец 2k+1 (bit-reversal не применяем — хотим видеть спарсность)
        M[k,      2 * k]     = 1.0
        M[k,      2 * k + 1] = w
        M[k + half, 2 * k]   = 1.0
        M[k + half, 2 * k + 1] = -w
    return M

n8 = 8
B8 = butterfly_matrix_level1(n8)

# --- рисуем ---
fig, axes = plt.subplots(1, 3, figsize=(9.5, 3.4))

norm_re = TwoSlopeNorm(vmin=-1, vcenter=0, vmax=1)
norm_im = TwoSlopeNorm(vmin=-1, vcenter=0, vmax=1)

cmap_div = 'RdBu_r'

# --- Re(F32) ---
im0 = axes[0].imshow(
    F32.real, cmap=cmap_div, norm=norm_re,
    interpolation='nearest', aspect='equal'
)
axes[0].set_title(r'$\mathrm{Re}(F_{32})$', fontsize=11, pad=6)
axes[0].set_xlabel('столбец $j$', fontsize=9)
axes[0].set_ylabel('строка $k$', fontsize=9)
axes[0].tick_params(labelsize=7)
# убрать сетку между ячейками — не рисуем её
plt.colorbar(im0, ax=axes[0], fraction=0.046, pad=0.04).ax.tick_params(labelsize=7)

# --- Im(F32) ---
im1 = axes[1].imshow(
    F32.imag, cmap=cmap_div, norm=norm_im,
    interpolation='nearest', aspect='equal'
)
axes[1].set_title(r'$\mathrm{Im}(F_{32})$', fontsize=11, pad=6)
axes[1].set_xlabel('столбец $j$', fontsize=9)
axes[1].tick_params(labelsize=7)
plt.colorbar(im1, ax=axes[1], fraction=0.046, pad=0.04).ax.tick_params(labelsize=7)

# --- butterfly для n=8 ---
# показываем |B8| — разреженность: большинство нулей, только 2 ненулевых в строке
B8_abs = np.abs(B8)

# 0 → белый, ненулевые → синие оттенки
cmap_sparse = matplotlib.colors.LinearSegmentedColormap.from_list(
    'sparse', ['#FFFFFF', '#1F4E79']
)
im2 = axes[2].imshow(
    B8_abs, cmap=cmap_sparse, vmin=0, vmax=1.05,
    interpolation='nearest', aspect='equal'
)
axes[2].set_title(r'Butterfly-слой $B_8$ (уровень 1)', fontsize=10, pad=6)
axes[2].set_xlabel('столбец $j$', fontsize=9)
axes[2].tick_params(labelsize=7)

# пометить тики по 8 значениям
axes[2].set_xticks(range(n8))
axes[2].set_yticks(range(n8))
axes[2].set_xticklabels(range(n8), fontsize=7)
axes[2].set_yticklabels(range(n8), fontsize=7)

# добавить аннотацию "2 ненуля в строке"
axes[2].text(
    0.5, -0.22,
    r'$\leq 2$ ненулевых в строке',
    transform=axes[2].transAxes,
    fontsize=8, ha='center', color='#1F4E79', fontstyle='italic'
)

plt.colorbar(im2, ax=axes[2], fraction=0.046, pad=0.04).ax.tick_params(labelsize=7)

# спрятать рамки
for ax in axes:
    ax.spines[['top', 'right']].set_visible(False)

fig.tight_layout(pad=1.2)
fig.savefig(
    '/var/www/sigma/book/figures/stories/fft_matrix.svg',
    bbox_inches='tight'
)
print("fft_matrix.svg saved.")
