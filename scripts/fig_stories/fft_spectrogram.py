"""
fft_spectrogram.py — спектрограмма трёх последовательных нот (A4, C#5, E5).
Дом-стиль Сигма: serif, сдержанная палитра, читаемые подписи вне пятен.
"""
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import Normalize
from scipy.signal import spectrogram as scipy_spectrogram

plt.rcParams.update({
    'font.family': 'serif',
    'font.serif': ['DejaVu Serif', 'Times New Roman'],
    'mathtext.fontset': 'dejavuserif',
})

# --- синтез сигнала ---
fs = 22050        # частота дискретизации
dur = 0.6         # длительность каждой ноты (с)
silence = 0.02    # крошечная пауза между нотами

notes = [
    ('A4',  440),
    ('C♯5', 554),
    ('E5',  659),
]

t_note = np.linspace(0, dur, int(fs * dur), endpoint=False)
t_sil  = np.zeros(int(fs * silence))

segments = []
for name, freq in notes:
    # фундаментальный + 2 первых обертона с убывающей амплитудой
    sig = (np.sin(2 * np.pi * freq * t_note) +
           0.5 * np.sin(2 * np.pi * 2 * freq * t_note) +
           0.25 * np.sin(2 * np.pi * 3 * freq * t_note))
    # мягкий огибающий (Hann-like)
    env = np.hanning(len(t_note))
    segments.append(sig * env)
    segments.append(t_sil)

signal = np.concatenate(segments)
T_total = len(signal) / fs

# --- STFT ---
nperseg = 512
noverlap = 384
freqs, times, Sxx = scipy_spectrogram(
    signal, fs=fs, nperseg=nperseg, noverlap=noverlap,
    window='hann', scaling='spectrum'
)

# в дБ
Sxx_db = 10 * np.log10(Sxx + 1e-12)
vmin, vmax = -70, 0  # dB range

# --- рисуем ---
fig, ax = plt.subplots(figsize=(8.5, 3.8))

freq_max = 2200  # Hz — достаточно чтобы видеть 3 обертона каждой ноты
freq_mask = freqs <= freq_max

im = ax.pcolormesh(
    times, freqs[freq_mask], Sxx_db[freq_mask, :],
    cmap='magma', vmin=vmin, vmax=vmax,
    shading='gouraud', rasterized=True
)

# --- вертикальные разделители между нотами ---
# каждая нота занимает (dur + silence), стыки:
gap = dur + silence
boundaries = [gap, 2 * gap]  # конец 1-й ноты, конец 2-й ноты

for b in boundaries:
    ax.axvline(b, color='#AAAAAA', linewidth=0.8, linestyle='--', alpha=0.7)

# --- горизонтальные метки фундаментальных частот ---
note_centers = [gap / 2, gap + gap / 2, 2 * gap + gap / 2]

for (name, freq), xc in zip(notes, note_centers):
    # тонкая горизонтальная пунктирная линия по фундаменталу
    ax.axhline(freq, color='white', linewidth=0.5, linestyle=':', alpha=0.5)
    # лейбл ниже фундаментальной частоты, снаружи от яркого пятна
    ax.text(
        xc, freq - 90, f'{name}\n{freq} Гц',
        color='white', fontsize=8, ha='center', va='top',
        fontfamily='serif',
        bbox=dict(boxstyle='round,pad=0.2', fc='#1F4E79', ec='none', alpha=0.80)
    )

# --- colorbar ---
cbar = fig.colorbar(im, ax=ax, pad=0.02, fraction=0.025)
cbar.set_label('дБ', fontsize=9, fontfamily='serif')
cbar.ax.tick_params(labelsize=8)

# --- оформление осей ---
ax.set_xlim(0, times[-1])
ax.set_ylim(0, freq_max)
ax.set_xlabel('Время, с', fontsize=10, fontfamily='serif')
ax.set_ylabel('Частота, Гц', fontsize=10, fontfamily='serif')
ax.tick_params(labelsize=8)
ax.spines[['top', 'right']].set_visible(False)

fig.tight_layout()
fig.savefig(
    '/var/www/sigma/book/figures/stories/fft_spectrogram.png',
    dpi=150, bbox_inches='tight'
)
print("fft_spectrogram.png saved.")
