import numpy as np, io
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from PIL import Image
plt.rcParams['font.family'] = 'serif'
plt.rcParams['font.serif'] = ['DejaVu Serif', 'Times New Roman']

n_cities = int(__n_cities__)
seed = int(__seed__)
alpha = float(__alpha__)

np.random.seed(seed)
coords = np.random.rand(n_cities, 2) * 100
n = n_cities
D = np.sqrt(((coords[:, None] - coords[None, :]) ** 2).sum(2))
def tl(t):
    return sum(D[t[i], t[(i + 1) % n]] for i in range(n))

T0 = 10.0
max_iter = min(60000, int(np.log(2e-3 / T0) / np.log(alpha)) + 1500)
FRAMES = 30
snaps = set(int(round(x)) for x in np.geomspace(1, max_iter, FRAMES))

np.random.seed(seed)
tour = np.random.permutation(n)
cur = tl(tour)
best = tour.copy(); bl = cur; init_len = cur
hist_s = []; hist_b = []
frames = []
T = T0

def render(cur_tour, cur_len, blen, Tv):
    phase = 'exploration (горячо)' if Tv > 0.5 else ('exploitation (холодно)' if Tv < 0.08 else 'переход')
    col = '#C0392B' if Tv > 0.5 else ('#1F4E79' if Tv < 0.08 else '#B8860B')
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(9.2, 4.2)); fig.patch.set_facecolor('#fffff8')
    for ax in (ax1, ax2):
        ax.set_facecolor('#fffff8')
    r = list(cur_tour) + [cur_tour[0]]
    ax1.plot(coords[r, 0], coords[r, 1], '-', color=col, lw=1.3, alpha=0.85)
    ax1.scatter(coords[:, 0], coords[:, 1], color='#333333', s=34, zorder=3)
    ax1.set_title(f'Текущий тур: {cur_len:.0f}', fontsize=11)
    ax1.text(0.5, -0.06, f'T = {Tv:.2f} — {phase}', transform=ax1.transAxes,
             ha='center', va='top', fontsize=9.5, color=col)
    ax1.set_xticks([]); ax1.set_yticks([])
    ax1.spines[['top', 'right', 'left', 'bottom']].set_visible(False)
    if hist_s:
        ax2.plot(hist_s, hist_b, color='#1F4E79', lw=1.7)
        ax2.scatter([hist_s[-1]], [hist_b[-1]], color='#1F4E79', s=26, zorder=5)
    ax2.set_xlim(1, max_iter); ax2.set_xscale('log')
    ax2.set_ylim(bl * 0.9, init_len * 1.05)
    ax2.set_xlabel('Шаг отжига (лог)', fontsize=9)
    ax2.set_ylabel('Длина лучшего тура', fontsize=9)
    ax2.set_title(f'Лучший: {blen:.0f}', fontsize=11)
    ax2.spines[['top', 'right']].set_visible(False)
    ax2.grid(True, alpha=0.18, lw=0.5)
    plt.tight_layout()
    buf = io.BytesIO(); fig.savefig(buf, format='png', dpi=85); plt.close(fig); buf.seek(0)
    return Image.open(buf).convert('RGB')

for step in range(max_iter + 1):
    if step in snaps:
        hist_s.append(max(step, 1)); hist_b.append(bl)
        frames.append(render(tour, cur, bl, T))
    i, j = sorted(np.random.choice(n, 2, replace=False))
    nt = tour.copy(); nt[i:j + 1] = nt[i:j + 1][::-1]
    nl = tl(nt); dE = nl - cur
    if dE < 0 or np.random.rand() < np.exp(-dE / max(T, 1e-10)):
        tour = nt; cur = nl
        if cur < bl:
            best = tour.copy(); bl = cur
    T *= alpha
frames += [frames[-1]] * 5

print(f'SA TSP (n={n_cities}, alpha={alpha}): {init_len:.0f} -> {bl:.0f}  (улучшение x{init_len/bl:.2f})')
print(f'Горячая фаза «распутывает» клубок (принимая ухудшения), холодная — только улучшает. Это и есть exploration -> exploitation.')

import os
os.makedirs('/tmp/figs', exist_ok=True)
pal = [f.convert('P', palette=Image.ADAPTIVE, colors=64) for f in frames]
pal[0].save('/tmp/figs/tsp_anneal.gif', save_all=True, append_images=pal[1:], duration=170, loop=0)
