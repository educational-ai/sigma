#!/usr/bin/env bash
# Build pipeline:
#   overleaf_export/  → [pdftocairo] → book/figures/
#   overleaf_export/  → [tex_to_qmd] → book/ch*.qmd
#   book/ch*.qmd       → [split_chapters] → book/ch??_N_slug.qmd (one per section)
#   3 quarto book projects (dop/, 10/, 11/) → docs/{dop,10,11}/
#   landing (index.qmd) → docs/index.html
#
# nginx читает /var/www/sigma/docs/ напрямую.
# Робастно к изменениям в Overleaf: re-run этот скрипт после `git pull`
# или после sync с Overleaf — всё пересоберётся.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

# -----------------------------------------------------------------
echo "[0/5] xelatex main.tex → overleaf_export/main.pdf (если изменился)"
# -----------------------------------------------------------------
TEX_DIR="${REPO_ROOT}/overleaf_export"
if [ -d "${TEX_DIR}" ] && command -v latexmk >/dev/null 2>&1; then
    NEED_BUILD=0
    if [ ! -f "${TEX_DIR}/main.pdf" ]; then
        NEED_BUILD=1
    elif find "${TEX_DIR}" -maxdepth 3 \( -name '*.tex' -o -path '*/figures/*.pdf' \) -newer "${TEX_DIR}/main.pdf" | grep -q .; then
        NEED_BUILD=1
    fi
    if [ "${NEED_BUILD}" = "1" ]; then
        echo "  есть изменения — запускаю latexmk -xelatex"
        (cd "${TEX_DIR}" && latexmk -xelatex -interaction=nonstopmode main.tex >/dev/null 2>&1) || echo "  ⚠ latexmk вернул ненулевой код (warnings ок)"
        echo "  ✓ main.pdf пересобран"
    else
        echo "  без изменений — skip"
    fi
else
    echo "  ⚠ latexmk не найден или overleaf_export/ отсутствует — skip"
fi

# -----------------------------------------------------------------
echo "[1/5] PDF → SVG (figures)"
# -----------------------------------------------------------------
PDF_DIR="${REPO_ROOT}/overleaf_export/figures"
SVG_DIR="${REPO_ROOT}/book/figures"
mkdir -p "${SVG_DIR}"
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
echo "[2/5] tex → qmd (если изменился main.tex)"
# -----------------------------------------------------------------
# tex_to_qmd.py flatten-ит \input{}, разрешает refs, конвертит окружения
# (theorem/example/historybox/tasksbox/...) в Quarto callouts.
# Запускаем если что-либо в overleaf_export/chapters/ новее маркера.
TEX_CH_DIR="${REPO_ROOT}/overleaf_export/chapters"
MARKER="${REPO_ROOT}/book/.tex_to_qmd.marker"
if [ -d "${TEX_CH_DIR}" ]; then
    if [ ! -f "${MARKER}" ] || find "${TEX_CH_DIR}" -name '*.tex' -newer "${MARKER}" | grep -q .; then
        echo "  изменения в overleaf_export/chapters — конвертирую"
        /root/.venv/bin/python "${REPO_ROOT}/scripts/tex_to_qmd.py"
        touch "${MARKER}"
    else
        echo "  без изменений — skip"
    fi
else
    echo "  ⚠ overleaf_export/chapters отсутствует — skip"
fi

# -----------------------------------------------------------------
echo "[3/5] split chapters (ch03_ds, ch04_numtheory → per-section files)"
# -----------------------------------------------------------------
/root/.venv/bin/python "${REPO_ROOT}/scripts/split_chapters.py" 2>&1 | head -20
echo "  fix code blocks (add {.python} where missing)"
/root/.venv/bin/python "${REPO_ROOT}/scripts/fix_code_blocks.py"
echo "  augment .qmd (margin callouts, column-page for wide блок)"
/root/.venv/bin/python "${REPO_ROOT}/scripts/augment.py" 2>&1 | head -10

# -----------------------------------------------------------------
echo "[3.5/5] regen book/index.qmd карты глав из overleaf_export/"
# -----------------------------------------------------------------
/root/.venv/bin/python "${REPO_ROOT}/scripts/generate_index_map.py"

# -----------------------------------------------------------------
echo "[4/4] render book/ → docs/ (HTML + per-page typst PDF)"
# -----------------------------------------------------------------
(cd "${REPO_ROOT}/book" && quarto render --to html) 2>&1 | tail -3

# Нативный фреймворк живых виджетов: core.js + widgets/*.js → docs/assistant/interactive.js
# (быстро, без сетевых зависимостей; данные виджетов — git-tracked JSON, считаются
#  отдельно через precompute_interactive.py и НЕ пересчитываются на каждом билде).
echo "[4.2/5] bundle interactive widgets"
bash "${REPO_ROOT}/scripts/build_interactive.sh" 2>&1 | sed 's/^/  /'

echo "[4.5/5] typst PDF per page (errors ignored)"
# story_*/index — HTML-only (интерактивные эссе + лендинг): анимации/виджеты/
# pyodide в PDF не рендерятся, а старый tufte-extension (v1.0) несовместим с
# marginalia-вёрсткой Quarto 1.9 на документах с margin-контентом. Канонический
# печатный артефакт — docs/book.pdf (полный учебник из Overleaf).
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

# -----------------------------------------------------------------
echo "[5.5/5] copy main.pdf → docs/book.pdf (после quarto-рендеров!)"
# -----------------------------------------------------------------
if [ -f "${REPO_ROOT}/overleaf_export/main.pdf" ]; then
    cp "${REPO_ROOT}/overleaf_export/main.pdf" "${REPO_ROOT}/docs/book.pdf"
    echo "  ✓ docs/book.pdf updated ($(stat -c%s "${REPO_ROOT}/docs/book.pdf") bytes)"
else
    echo "  ⚠ overleaf_export/main.pdf отсутствует — book.pdf не обновлён"
fi

# favicon: quarto чистит docs/, кладём из репо корня
for f in favicon.svg favicon.ico favicon-32.png favicon-180.png favicon-192.png favicon-512.png; do
    [ -f "${REPO_ROOT}/${f}" ] && cp "${REPO_ROOT}/${f}" "${REPO_ROOT}/docs/${f}"
done
echo "  ✓ favicon files synced"

echo "✅ Готово: https://sigma.fmin.xyz/"
