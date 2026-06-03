"""
Генератор: eigen_resonance.svg
Резонансная кривая гармонического осциллятора.
Стиль: книжный (serif, #1F4E79, spines top/right off, нет тяжёлого chartjunk)
"""
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

plt.rcParams.update({
    'font.family': 'serif',
    'font.serif': ['DejaVu Serif', 'Times New Roman', 'serif'],
    'mathtext.fontset': 'dejavuserif',
    'axes.facecolor': '#fffff8',
    'figure.facecolor': '#fffff8',
})

BASE   = '#1F4E79'
ACCENT = '#C0392B'

# параметры осциллятора
m, c, k = 1.0, 0.02, 1.0
omega_0 = np.sqrt(k / m)
F0 = 1.0

omega_ext = np.linspace(0.1, 2.0, 800)
amp = F0 / np.sqrt((k - m * omega_ext**2)**2 + (c * omega_ext)**2)

fig, ax = plt.subplots(figsize=(8, 4))
fig.patch.set_facecolor('#fffff8')
ax.set_facecolor('#fffff8')

ax.semilogy(omega_ext, amp, color=BASE, lw=1.8, label='Амплитуда $A(\\omega)$')
ax.axvline(omega_0, color=ACCENT, ls='--', lw=1.2, label=f'$\\omega_0 = {omega_0:.2f}$')

# аннотация — стрелка к пику, не поверх кривой
peak_idx = np.argmax(amp)
ax.annotate(
    'резонанс',
    xy=(omega_ext[peak_idx], amp[peak_idx]),
    xytext=(omega_ext[peak_idx] + 0.22, amp[peak_idx] * 0.35),
    arrowprops=dict(arrowstyle='->', color=ACCENT, lw=1.2),
    fontsize=9, color=ACCENT, fontstyle='italic',
)

ax.set_xlabel('Частота внешней силы $\\omega$', fontsize=10)
ax.set_ylabel('Амплитуда (лог. шкала)', fontsize=10)
ax.set_title('Резонансная кривая: пик при $\\omega \\approx \\omega_0$', fontsize=12)
ax.tick_params(labelsize=9)
ax.spines[['top', 'right']].set_visible(False)
ax.grid(True, alpha=0.2, lw=0.4, color='gray')
ax.legend(fontsize=9, frameon=False)

plt.tight_layout(pad=1.0)
out_path = '/var/www/sigma/book/figures/stories/eigen_resonance.svg'
plt.savefig(out_path, format='svg', bbox_inches='tight', facecolor='#fffff8')
print(f"Saved: {out_path}")
