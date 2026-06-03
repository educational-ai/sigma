"""
w2v_analogies.py — Два параллелограмма аналогий Word2Vec.
Левая панель: gender-royalty (king/queen/man/woman + prince/princess/boy/girl с пунктирными стрелками).
Правая панель: capitals (Paris/Berlin/France/Germany + Rome/Madrid/Italy/Spain).

Исправлено:
- Удалена ошибочная подпись «country→capital» с горизонтальной стрелки Paris→Berlin.
  Горизонтальные красные стрелки теперь подписаны «= одинаковое смещение».
- Ось Y подписана «▼ royalty» и «▼ capital direction» горизонтально снизу панелей.
- Дополнительные слова (prince/princess, boy/girl, Rome/Madrid, Italy/Spain)
  получили пунктирные стрелки-аналогии (royalty и country→capital).

Sigma-стиль: serif, #1F4E79/#C0392B/#2E7D5B, no top/right spines.
"""
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches

plt.rcParams.update({
    'font.family': 'serif',
    'font.serif': ['DejaVu Serif', 'Times New Roman'],
    'mathtext.fontset': 'dejavuserif',
})

BLUE  = '#1F4E79'
RED   = '#C0392B'
GREEN = '#2E7D5B'
GRAY  = '#999999'
BG    = '#fffff8'

# ── координаты «игрушечного» 2D пространства ──────────────────────────────
# Левая панель: ось x = gender (male < female), ось y = royalty (low < high)
# Правая панель: ось x = capital offset, ось y = country→capital direction

# --- Левая панель ---
# Основной параллелограмм: king, queen, man, woman
Lkx, Lky     = 0.2, 0.82   # king
Lqx, Lqy     = 0.8, 0.82   # queen
Lmx, Lmy     = 0.2, 0.2    # man
Lwx, Lwy     = 0.8, 0.2    # woman

# Дополнительные слова: prince/princess (средний royalty), boy/girl (низкий royalty)
Lprx, Lpry   = 0.2, 0.56   # prince
Lpsx, Lpsy   = 0.8, 0.56   # princess
Lbx,  Lby    = 0.2, 0.02   # boy
Lgx,  Lgy    = 0.8, 0.02   # girl

# --- Правая панель ---
# Основной параллелограмм: Paris, Berlin, France, Germany
# Paris и Berlin — на высоком y (столицы), France/Germany — на низком (страны)
Rpax, Rpay   = 0.15, 0.82  # Paris   (capital)
Rbex, Rbey   = 0.85, 0.82  # Berlin  (capital)
Rfx,  Rfy    = 0.15, 0.2   # France  (country)
Rgx,  Rgy    = 0.85, 0.2   # Germany (country)

# Дополнительные — дополнительные пары для иллюстрации той же аналогии
# Rome/Italy и Madrid/Spain — в промежуточных x-позициях
Rrmx, Rrmy   = 0.38, 0.82  # Rome    (capital)
Ritx, Rity   = 0.38, 0.2   # Italy   (country)
Rmax, Rmay   = 0.62, 0.82  # Madrid  (capital)
Rspx, Rspy   = 0.62, 0.2   # Spain   (country)


def draw_arrow(ax, x1, y1, x2, y2, color, lw=2.0, linestyle='-',
               arrowstyle='->', mutation_scale=14):
    ax.annotate("", xy=(x2, y2), xytext=(x1, y1),
                arrowprops=dict(
                    arrowstyle=arrowstyle,
                    color=color,
                    lw=lw,
                    linestyle=linestyle,
                    connectionstyle='arc3,rad=0.0'
                ))


def label(ax, x, y, text, ha='center', va='center',
          color=BLUE, fontsize=10.5, fontweight='bold', offset=(0, 0)):
    ax.text(x + offset[0], y + offset[1], text,
            ha=ha, va=va, fontsize=fontsize,
            fontweight=fontweight, color=color,
            fontfamily='serif',
            bbox=dict(boxstyle='round,pad=0.15', fc=BG, ec='none', alpha=0.85))


fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4.5),
                                facecolor=BG)
for ax in (ax1, ax2):
    ax.set_xlim(-0.05, 1.15)
    ax.set_ylim(-0.12, 1.08)
    ax.set_aspect('equal')
    ax.axis('off')
    ax.set_facecolor(BG)

# ═══════════════════════════════════════════════════════════════════════════
# ЛЕВАЯ ПАНЕЛЬ — gender / royalty
# ═══════════════════════════════════════════════════════════════════════════

# --- основной параллелограмм ---
# горизонтальные красные: king↔queen (gender direction), man↔woman
draw_arrow(ax1, Lkx, Lky, Lqx, Lqy, RED, lw=2.2)
draw_arrow(ax1, Lmx, Lmy, Lwx, Lwy, RED, lw=2.2)

# вертикальные зелёные: king↔man (royalty), queen↔woman
draw_arrow(ax1, Lkx, Lky, Lmx, Lmy, GREEN, lw=2.2, linestyle='--')
draw_arrow(ax1, Lqx, Lqy, Lwx, Lwy, GREEN, lw=2.2, linestyle='--')

# --- дополнительные: prince/princess ---
draw_arrow(ax1, Lprx, Lpry, Lpsx, Lpsy, RED, lw=1.3, linestyle=(0, (4, 3)))
draw_arrow(ax1, Lkx, Lky, Lprx, Lpry, GREEN, lw=1.1, linestyle=(0, (3, 4)))
draw_arrow(ax1, Lqx, Lqy, Lpsx, Lpsy, GREEN, lw=1.1, linestyle=(0, (3, 4)))

# --- дополнительные: boy/girl ---
draw_arrow(ax1, Lbx, Lby, Lgx, Lgy, RED, lw=1.3, linestyle=(0, (4, 3)))
draw_arrow(ax1, Lmx, Lmy, Lbx, Lby, GREEN, lw=1.1, linestyle=(0, (3, 4)))
draw_arrow(ax1, Lwx, Lwy, Lgx, Lgy, GREEN, lw=1.1, linestyle=(0, (3, 4)))

# подписи основных слов
label(ax1, Lkx, Lky, 'king',   va='bottom', offset=(0, 0.04))
label(ax1, Lqx, Lqy, 'queen',  va='bottom', offset=(0, 0.04))
label(ax1, Lmx, Lmy, 'man',    va='top',    offset=(0, -0.04))
label(ax1, Lwx, Lwy, 'woman',  va='top',    offset=(0, -0.04))
label(ax1, Lprx, Lpry, 'prince',   va='center', ha='right',
      offset=(-0.06, 0), color=GRAY, fontsize=9, fontweight='normal')
label(ax1, Lpsx, Lpsy, 'princess', va='center', ha='left',
      offset=(0.06, 0), color=GRAY, fontsize=9, fontweight='normal')
label(ax1, Lbx, Lby, 'boy',  va='top',  offset=(0, -0.06),
      color=GRAY, fontsize=9, fontweight='normal')
label(ax1, Lgx, Lgy, 'girl', va='top',  offset=(0, -0.06),
      color=GRAY, fontsize=9, fontweight='normal')

# подпись горизонтальной красной стрелки: «gender»
ax1.text(0.5, Lky + 0.06, 'gender →', ha='center', va='bottom',
         fontsize=9, fontstyle='italic', color=RED, fontfamily='serif')

# подпись вертикальных зелёных: горизонтально, снизу панели
ax1.text(0.5, -0.10, '↕ royalty', ha='center', va='bottom',
         fontsize=9, fontstyle='italic', color=GREEN, fontfamily='serif')

ax1.set_title('Семантика пола и статуса', fontsize=11.5,
              fontfamily='serif', pad=6, color='#333333')

# ═══════════════════════════════════════════════════════════════════════════
# ПРАВАЯ ПАНЕЛЬ — capital / country
# ═══════════════════════════════════════════════════════════════════════════

# основные: Paris→Berlin (горизонтальная, красная = одинаковое смещение)
draw_arrow(ax2, Rpax, Rpay, Rbex, Rbey, RED, lw=2.2)
# France→Germany
draw_arrow(ax2, Rfx, Rfy, Rgx, Rgy, RED, lw=2.2)

# вертикальные зелёные: Paris→France (capital→country), Berlin→Germany
draw_arrow(ax2, Rpax, Rpay, Rfx, Rfy, GREEN, lw=2.2, linestyle='--')
draw_arrow(ax2, Rbex, Rbey, Rgx, Rgy, GREEN, lw=2.2, linestyle='--')

# дополнительные: Rome/Italy, Madrid/Spain — только вертикальные стрелки
draw_arrow(ax2, Rrmx, Rrmy, Ritx, Rity, GREEN, lw=1.1,
           linestyle=(0, (3, 4)))
draw_arrow(ax2, Rmax, Rmay, Rspx, Rspy, GREEN, lw=1.1,
           linestyle=(0, (3, 4)))

# подписи основных слов
label(ax2, Rpax, Rpay, 'Paris',   va='bottom', offset=(0, 0.04))
label(ax2, Rbex, Rbey, 'Berlin',  va='bottom', offset=(0, 0.04))
label(ax2, Rfx, Rfy, 'France',  va='top',    offset=(0, -0.04))
label(ax2, Rgx, Rgy, 'Germany', va='top',    offset=(0, -0.04))

# Подписи дополнительных слов — чуть ниже линии столиц, не перекрываются
label(ax2, Rrmx, Rrmy, 'Rome',   va='top', ha='center',
      offset=(0, -0.08), color=GRAY, fontsize=8.5, fontweight='normal')
label(ax2, Ritx, Rity, 'Italy', va='top', ha='center', offset=(0, -0.04),
      color=GRAY, fontsize=8.5, fontweight='normal')
label(ax2, Rmax, Rmay, 'Madrid', va='top', ha='center',
      offset=(0, -0.08), color=GRAY, fontsize=8.5, fontweight='normal')
label(ax2, Rspx, Rspy, 'Spain', va='top', ha='center', offset=(0, -0.04),
      color=GRAY, fontsize=8.5, fontweight='normal')

# подпись горизонтальной красной стрелки — над всей панелью, не перекрывается
ax2.text((Rpax + Rbex) / 2, Rpay + 0.10, '= одинаковое смещение',
         ha='center', va='bottom',
         fontsize=8.5, fontstyle='italic', color=RED, fontfamily='serif')

# подпись вертикальных зелёных: горизонтально, снизу
ax2.text(0.5, -0.10, '↕ capital → country', ha='center', va='bottom',
         fontsize=9, fontstyle='italic', color=GREEN, fontfamily='serif')

ax2.set_title('Семантика столиц и стран', fontsize=11.5,
              fontfamily='serif', pad=6, color='#333333')

# ═══════════════════════════════════════════════════════════════════════════
# Легенда
# ═══════════════════════════════════════════════════════════════════════════
red_patch   = mpatches.Patch(color=RED,   label='одинаковое смещение (аналогия)')
green_patch = mpatches.Patch(color=GREEN, label='семантическое отношение')
gray_patch  = mpatches.Patch(color=GRAY,  label='другие примеры той же аналогии')
fig.legend(handles=[red_patch, green_patch, gray_patch],
           loc='lower center', ncol=3,
           fontsize=8.5, frameon=False,
           bbox_to_anchor=(0.5, -0.01))

fig.patch.set_facecolor(BG)
plt.tight_layout(rect=[0, 0.06, 1, 1])
fig.savefig(
    '/var/www/sigma/book/figures/stories/w2v_analogies.svg',
    bbox_inches='tight', facecolor=BG
)
print("w2v_analogies.svg saved.")
