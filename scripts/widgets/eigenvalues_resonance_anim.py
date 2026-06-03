import numpy as np, io
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from PIL import Image
plt.rcParams['font.family'] = 'serif'
plt.rcParams['font.serif'] = ['DejaVu Serif', 'Times New Roman']

n_masses = int(__n_masses__)
damping = float(__damping__)
wind_freq = float(__wind_freq__)

# Цепочка масс (модель пролёта моста), закреплённая с обоих концов
K = np.diag([2.0] * n_masses) + np.diag([-1.0] * (n_masses - 1), 1) + np.diag([-1.0] * (n_masses - 1), -1)
evals, evecs = np.linalg.eigh(K)
nat_freqs = np.sqrt(np.abs(evals)) / (2 * np.pi)     # собственные частоты, Гц
mode_i = int(np.argmin(np.abs(nat_freqs - wind_freq)))  # ближайшая к ветру мода
f0 = nat_freqs[mode_i]
phi = evecs[:, mode_i]
phi = phi / np.max(np.abs(phi))
detune = abs(f0 - wind_freq) / f0
resonance = detune < 0.08

# Вынужденные колебания резонансной моды: q'' + 2 zeta w0 q' + w0^2 q = F cos(w t)
w0 = 2 * np.pi * f0
w = 2 * np.pi * wind_freq
zeta = damping
F = 1.0
T_total = 60.0
dt = 0.02
steps = int(T_total / dt)
q = 0.0; qd = 0.0
qs = np.zeros(steps); ts = np.linspace(0, T_total, steps)
for s in range(steps):
    a = F * np.cos(w * ts[s]) - 2 * zeta * w0 * qd - w0**2 * q
    qd += a * dt; q += qd * dt
    qs[s] = q
amp = np.abs(qs)
ymax = max(np.max(amp) * 1.1, 1.0)

x = np.linspace(0, 1, n_masses + 2)
deck = np.concatenate([[0], phi, [0]])

FRAMES = 36
idx = np.linspace(0, steps - 1, FRAMES).astype(int)
frames = []
for k, si in enumerate(idx):
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(7.6, 5.0),
                                   gridspec_kw={'height_ratios': [1.1, 1]})
    fig.patch.set_facecolor('#fffff8')
    for ax in (ax1, ax2):
        ax.set_facecolor('#fffff8')
    col = '#C0392B' if resonance else '#1F4E79'
    y = qs[si] * deck
    ax1.axhline(0, color='#bbbbbb', lw=0.8, zorder=1)
    ax1.plot(x, y, '-', color=col, lw=2.0, zorder=3)
    ax1.scatter(x[1:-1], y[1:-1], color=col, s=26, zorder=4)
    ax1.scatter([x[0], x[-1]], [0, 0], marker='s', color='#333333', s=55, zorder=5)
    ax1.set_ylim(-ymax, ymax); ax1.set_xlim(-0.02, 1.02)
    ax1.set_xticks([]); ax1.set_yticks([])
    ax1.set_title(f'Пролёт моста ({n_masses} масс):  ветер {wind_freq:.2f} Гц,  мода {mode_i+1} = {f0:.2f} Гц', fontsize=10.5)
    ax1.text(0.5, -0.13, ('РЕЗОНАНС — амплитуда растёт' if resonance else 'вне резонанса — колебания ограничены'),
             transform=ax1.transAxes, ha='center', va='top', fontsize=10, color=col)
    ax1.spines[['top', 'right', 'left', 'bottom']].set_visible(False)

    ax2.plot(ts[:si+1], qs[:si+1], color=col, lw=1.0, alpha=0.55)
    ax2.plot(ts[:si+1], amp[:si+1], color=col, lw=1.6)
    ax2.plot(ts[:si+1], -amp[:si+1], color=col, lw=1.6)
    ax2.set_xlim(0, T_total); ax2.set_ylim(-ymax, ymax)
    ax2.set_xlabel('Время, с', fontsize=9); ax2.set_ylabel('Амплитуда', fontsize=9)
    ax2.set_title('Огибающая колебаний', fontsize=10)
    ax2.spines[['top', 'right']].set_visible(False); ax2.grid(True, alpha=0.18, lw=0.5)
    plt.tight_layout()
    buf = io.BytesIO(); fig.savefig(buf, format='png', dpi=85); plt.close(fig); buf.seek(0)
    frames.append(Image.open(buf).convert('RGB'))
frames += [frames[-1]] * 5

print(f'Собственные частоты (Гц): ' + ', '.join(f'{f:.2f}' for f in nat_freqs[:6]) + (' …' if len(nat_freqs) > 6 else ''))
print(f'Ветер {wind_freq:.2f} Гц ближе всего к моде {mode_i+1} ({f0:.2f} Гц), расстройка {detune*100:.0f}%.')
print('При совпадении частот амплитуда нарастает во времени (резонанс), демпфирование ζ ограничивает её сверху ~1/ζ.' if resonance
      else 'Частоты не совпали — система отдаёт энергию обратно, колебания остаются малыми.')

import os
os.makedirs('/tmp/figs', exist_ok=True)
pal = [f.convert('P', palette=Image.ADAPTIVE, colors=48) for f in frames]
pal[0].save('/tmp/figs/resonance.gif', save_all=True, append_images=pal[1:], duration=120, loop=0)
