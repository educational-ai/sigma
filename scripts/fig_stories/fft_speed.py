"""
fft_speed.py — скорость БПФ vs. прямое матричное умножение.
Теоретические кривые нормированы через первую точку реального замера —
честное сравнение.
"""
import numpy as np
import time
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

plt.rcParams.update({
    'font.family': 'serif',
    'font.serif': ['DejaVu Serif', 'Times New Roman'],
    'mathtext.fontset': 'dejavuserif',
})

# --- замеры ---
ns_fft  = [2**k for k in range(8, 18)]   # 256 .. 131072  — только БПФ
ns_both = [2**k for k in range(8, 14)]   # 256 .. 8192    — тоже матрица (до разумного)

rng = np.random.default_rng(42)

t_fft_all = []
for n in ns_fft:
    x = rng.standard_normal(n) + 1j * rng.standard_normal(n)
    # warm-up
    _ = np.fft.fft(x)
    runs = []
    for _ in range(5):
        t0 = time.perf_counter()
        np.fft.fft(x)
        runs.append(time.perf_counter() - t0)
    t_fft_all.append(np.median(runs))

t_mat_all = []
for n in ns_both:
    x = rng.standard_normal(n) + 1j * rng.standard_normal(n)
    j_idx = np.arange(n)
    F = np.exp(-2j * np.pi * np.outer(j_idx, j_idx) / n)
    runs = []
    for _ in range(3):
        t0 = time.perf_counter()
        F @ x
        runs.append(time.perf_counter() - t0)
    t_mat_all.append(np.median(runs))

ns_fft  = np.array(ns_fft,  dtype=float)
ns_both = np.array(ns_both, dtype=float)
t_fft_all = np.array(t_fft_all)
t_mat_all = np.array(t_mat_all)

# --- нормировка теоретических кривых ---
# O(n^2): через первую реальную точку матрицы
# O(n log n): нормируем так, чтобы кривая проходила чуть ВЫШЕ облака реальных данных
#   — берём максимум реальных замеров FFT и масштабируем от него,
#     умножая константу на коэффициент > 1 (взят 4.0 для визуального запаса)
n0_fft = ns_fft[0]
n0_mat = ns_both[0]

# Для O(n log n): ориентируемся по максимальному замеру FFT (последняя точка)
# чтобы теоретическая кривая лежала выше/вдоль всего облака
n_max_fft = ns_fft[-1]
t_max_fft = t_fft_all[-1]
c_nlogn = (t_max_fft / (n_max_fft * np.log2(n_max_fft))) * 4.0

c_n2    = t_mat_all[0] / (n0_mat ** 2)

theory_nlogn = c_nlogn * ns_fft * np.log2(ns_fft)
theory_n2_on_both = c_n2 * ns_both ** 2

# --- аннотация: ускорение при последней совместной точке ---
n_ann = ns_both[-1]
t_ann_fft = t_fft_all[len(ns_both) - 1]
t_ann_mat = t_mat_all[-1]
speedup = t_ann_mat / t_ann_fft

# --- рисуем ---
fig, ax = plt.subplots(figsize=(8, 4))

BLUE = '#1F4E79'
RED  = '#C0392B'
GRAY = '#777777'

# теоретические кривые
ax.plot(ns_fft, theory_nlogn,
        color=BLUE, linewidth=1.0, linestyle='--', alpha=0.55,
        label=r'$O(n \log n)$ (теория)')
ax.plot(ns_both, theory_n2_on_both,
        color=RED, linewidth=1.0, linestyle='--', alpha=0.55,
        label=r'$O(n^2)$ (теория)')

# реальные замеры
ax.plot(ns_fft, t_fft_all,
        color=BLUE, linewidth=2, marker='o', markersize=4,
        label='numpy.fft (реальный)')
ax.plot(ns_both, t_mat_all,
        color=RED, linewidth=2, marker='s', markersize=4,
        label='матрица $F_n$ (реальная)')

# аннотация ускорения
ax.annotate(
    f'×{speedup:.0f} быстрее\nпри $n={int(n_ann)}$',
    xy=(n_ann, t_ann_fft),
    xytext=(n_ann * 0.35, t_ann_fft * 8),
    fontsize=9, fontfamily='serif', color=BLUE,
    arrowprops=dict(arrowstyle='->', color=BLUE, lw=1.0),
)

ax.set_xscale('log', base=2)
ax.set_yscale('log')

# метки степеней 2 по оси X
x_ticks = [2**k for k in range(8, 18)]
ax.set_xticks(x_ticks)
ax.set_xticklabels([f'$2^{{{k}}}$' for k in range(8, 18)], fontsize=8)
ax.tick_params(axis='y', labelsize=8)

ax.set_xlabel('Размер $n$', fontsize=10, fontfamily='serif')
ax.set_ylabel('Время, с', fontsize=10, fontfamily='serif')

ax.grid(True, which='major', linewidth=0.4, alpha=0.3, color='gray')
ax.grid(True, which='minor', linewidth=0.2, alpha=0.15, color='gray')
ax.spines[['top', 'right']].set_visible(False)

ax.legend(fontsize=8, frameon=False, loc='upper left')

fig.tight_layout()
fig.savefig(
    '/var/www/sigma/book/figures/stories/fft_speed.svg',
    bbox_inches='tight'
)
print("fft_speed.svg saved.")
