#!/usr/bin/env bash
# Сборка sigma.fmin.xyz.
#
#   book/*.qmd            → [quarto] → docs/*.html   (единственный источник текста)
#   figures_tikz/*.tex    → [xelatex] → book/figures/*.svg
#   overleaf_export/make_figures.py → book/figures/*.svg (matplotlib)
#   scripts/interactive/  → docs/assistant/interactive.js
#
# Overleaf отрезан 2026-08-03 (решение Даниила): .qmd больше не генерятся из
# .tex, а правятся руками — правка типографики и текста делается на месте, а не
# «в источнике, куда я не пишу». Исходники .tex остались в overleaf_export/
# только как архив; ничего из них не собирается, кроме make_figures.py.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

# -----------------------------------------------------------------
echo "[1/6] matplotlib → SVG (figures)"
# -----------------------------------------------------------------
PDF_DIR="${REPO_ROOT}/overleaf_export/figures"
SVG_DIR="${REPO_ROOT}/book/figures"
mkdir -p "${SVG_DIR}"
# make_figures.py авторитетен в git (sync.sh его не затирает); перегенерируем
# его PDF, иначе устаревшие копии из Overleaf-ZIP возвращают уже починенные
# дефекты подписей на live (инцидент 2026-06-27).
MAKE_FIGS="${REPO_ROOT}/overleaf_export/make_figures.py"
if [ -f "${MAKE_FIGS}" ]; then
    if (cd "${REPO_ROOT}/overleaf_export" && \
        FIGURES_OUT="${PDF_DIR}" /root/.venv/bin/python make_figures.py >/dev/null); then
        echo "  ↻ make_figures.py: PDF перегенерированы из git-версии"
    else
        echo "  ⚠ make_figures.py упал — остаются PDF из Overleaf-экспорта"
    fi
fi
if command -v pdftocairo >/dev/null 2>&1 && [ -d "${PDF_DIR}" ]; then
    converted=0
    for pdf in "${PDF_DIR}"/*.pdf; do
        [ -f "$pdf" ] || continue
        name=$(basename "$pdf" .pdf)
        svg="${SVG_DIR}/${name}.svg"
        if [ ! -f "$svg" ] || [ "$pdf" -nt "$svg" ]; then
            pdftocairo -svg "$pdf" "$svg" 2>/dev/null && converted=$((converted+1))
            echo "    ↻ ${name}"
        fi
    done
    echo "  converted ${converted} new/updated SVGs"
else
    echo "  ⚠ pdftocairo missing or no overleaf_export/figures — skipping"
fi


# -----------------------------------------------------------------
echo "[2/5] TikZ → SVG (figures_tikz/*.tex)"
# -----------------------------------------------------------------
/root/.venv/bin/python "${REPO_ROOT}/scripts/build_tikz_figures.py"

# fix_code_blocks.py и augment.py из сборки выведены намеренно: они ПРАВИЛИ
# .qmd на каждом прогоне, а .qmd теперь источник, а не артефакт. Самомутирующий
# источник уже давал 230 вложенных ::: {.column-page} и красный билд. Обе
# нормализации применены разово; нужны снова — запускать руками.

# -----------------------------------------------------------------
echo "[3/6] regen дерева страниц на главной из book/_quarto.yml"
# -----------------------------------------------------------------
# Единственный источник состава и порядка — sidebar в _quarto.yml. Раньше
# дерево на лендинге правили руками, и оно разъехалось: 7 сюжетов отсутствовали,
# «Часть III» вела на удалённый ch_linalg.html (404 с главной страницы сайта).
/root/.venv/bin/python "${REPO_ROOT}/scripts/generate_landing_tree.py"

# -----------------------------------------------------------------
echo "[4/6] render book/ → docs/ (HTML + per-page typst PDF)"
# -----------------------------------------------------------------
(cd "${REPO_ROOT}/book" && quarto render --to html) 2>&1 | tail -3

# Нативный фреймворк живых виджетов: core.js + widgets/*.js → docs/assistant/interactive.js
# (быстро, без сетевых зависимостей; данные виджетов — git-tracked JSON, считаются
#  отдельно через precompute_interactive.py и НЕ пересчитываются на каждом билде).
echo "[5/6] bundle interactive widgets"
bash "${REPO_ROOT}/scripts/build_interactive.sh" 2>&1 | sed 's/^/  /'

echo "[5.5/6] typst PDF per page (errors ignored)"
# story_*/index — HTML-only (интерактивные эссе + лендинг): анимации/виджеты/
# pyodide в PDF не рендерятся, а старый tufte-extension (v1.0) несовместим с
# marginalia-вёрсткой Quarto 1.9 на документах с margin-контентом. Полный
# book.pdf убран вместе с Overleaf — печатный артефакт теперь постраничный.
ok=0; fail=0
for qmd in "${REPO_ROOT}/book"/*.qmd; do
    name=$(basename "$qmd" .qmd)
    case "$name" in
        story_*|index) continue ;;
    esac
    if (cd "${REPO_ROOT}/book" && QUARTO_TYPST_FONT_PATHS="${REPO_ROOT}/book/fonts" quarto render "$(basename "$qmd")" --to tufte-inspired-typst >/dev/null 2>&1); then
        ok=$((ok+1))
    else
        fail=$((fail+1))
        echo "    ✗ ${name}.pdf (typst skip)"
    fi
done
echo "  typst PDFs: ${ok} OK / ${fail} skipped"

# favicon: quarto чистит docs/, кладём из репо корня
for f in favicon.svg favicon.ico favicon-32.png favicon-180.png favicon-192.png favicon-512.png; do
    [ -f "${REPO_ROOT}/${f}" ] && cp "${REPO_ROOT}/${f}" "${REPO_ROOT}/docs/${f}"
done
echo "  ✓ favicon files synced"

# -----------------------------------------------------------------
echo "[6/6] переиндексация ассистента"
# -----------------------------------------------------------------
# Индекс жил отдельной жизнью и молча протух на два месяца: шесть сюжетов
# ассистент не находил вовсе, но отвечал уверенно. Сборка сайта и индекс
# обязаны ехать вместе.
if [ -x /root/.venv/bin/python ] && [ -f /root/sigma_assistant/build_structural_index.py ]; then
    (cd /root/sigma_assistant && /root/.venv/bin/python build_structural_index.py 2>&1 | sed 's/^/  /') \
        && systemctl restart sigma-assistant 2>/dev/null \
        && echo "  ✓ индекс пересобран, sigma-assistant перезапущен"
else
    echo "  ⚠ /root/sigma_assistant не найден — индекс не тронут"
fi

echo "✅ Готово: https://sigma.fmin.xyz/"
