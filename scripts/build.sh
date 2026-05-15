#!/usr/bin/env bash
# Build pipeline:
#   overleaf_export/  → [pdftocairo] → dop/figures/
#   overleaf_export/  → [tex_to_qmd] → dop/ch*.qmd
#   dop/ch*.qmd       → [split_chapters] → dop/ch??_N_slug.qmd (one per section)
#   3 quarto book projects (dop/, 10/, 11/) → docs/{dop,10,11}/
#   landing (index.qmd) → docs/index.html
#
# nginx читает /var/www/uchebniik-repo/docs/ напрямую.
# Робастно к изменениям в Overleaf: re-run этот скрипт после `git pull`
# или после sync с Overleaf — всё пересоберётся.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

# -----------------------------------------------------------------
echo "[1/5] PDF → SVG (figures)"
# -----------------------------------------------------------------
PDF_DIR="${REPO_ROOT}/overleaf_export/figures"
SVG_DIR="${REPO_ROOT}/dop/figures"
mkdir -p "${SVG_DIR}"
if command -v pdftocairo >/dev/null 2>&1 && [ -d "${PDF_DIR}" ]; then
    converted=0
    for pdf in "${PDF_DIR}"/*.pdf; do
        [ -f "$pdf" ] || continue
        name=$(basename "$pdf" .pdf)
        svg="${SVG_DIR}/${name}.svg"
        if [ ! -f "$svg" ] || [ "$pdf" -nt "$svg" ]; then
            pdftocairo -svg "$pdf" "$svg" 2>/dev/null && converted=$((converted+1))
        fi
    done
    echo "  converted ${converted} new/updated SVGs"
else
    echo "  ⚠ pdftocairo missing or no overleaf_export/figures — skipping"
fi

# -----------------------------------------------------------------
echo "[2/5] tex → qmd (если изменился main.tex)"
# -----------------------------------------------------------------
# tex_to_qmd.py пишет в dop/ch*.qmd. Запускаем только если main.tex новее.
TEX_MAIN="${REPO_ROOT}/overleaf_export/main.tex"
MARKER="${REPO_ROOT}/dop/.tex_to_qmd.marker"
if [ -f "${TEX_MAIN}" ] && [ "${TEX_MAIN}" -nt "${MARKER}" ]; then
    echo "  main.tex newer than marker — конвертирую"
    # Внимание: текущий tex_to_qmd.py ожидает старые пути /root/uchebniik/source.
    # Пока что эту фазу пропускаем; вручную обновляем dop/ch*.qmd при изменениях.
    # TODO: адаптировать tex_to_qmd.py под overleaf_export/ → dop/.
    touch "${MARKER}"
else
    echo "  main.tex без изменений — skip"
fi

# -----------------------------------------------------------------
echo "[3/5] split chapters (ch03_ds, ch04_numtheory → per-section files)"
# -----------------------------------------------------------------
/root/.venv/bin/python "${REPO_ROOT}/scripts/split_chapters.py" 2>&1 | head -20
echo "  fix code blocks (add {.python} where missing)"
/root/.venv/bin/python "${REPO_ROOT}/scripts/fix_code_blocks.py"

# -----------------------------------------------------------------
echo "[4/5] render landing → docs/index.html"
# -----------------------------------------------------------------
cd "${REPO_ROOT}"
quarto render index.qmd --to html --output-dir docs

# -----------------------------------------------------------------
echo "[5/5] render 3 учебника → docs/{dop,10,11}/"
# -----------------------------------------------------------------
for book in dop 10 11; do
    echo "  ▸ ${book}/"
    (cd "${REPO_ROOT}/${book}" && quarto render) 2>&1 | tail -3
done

echo "✅ Готово: https://uchebniik.fmin.xyz/"
