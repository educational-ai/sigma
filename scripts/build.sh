#!/usr/bin/env bash
# Build pipeline: overleaf_export/ → docs/
# Конвертирует LaTeX из Overleaf в HTML сайт для uchebniik.fmin.xyz.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${REPO_ROOT}/overleaf_export"
OUT="${REPO_ROOT}/docs"
CONV="${REPO_ROOT}/converted"

if [ ! -f "${SRC}/main.tex" ]; then
    echo "ERROR: ${SRC}/main.tex not found. Положи экспорт из Overleaf в overleaf_export/." >&2
    exit 1
fi

echo "[1/3] tex → qmd"
python3 "${REPO_ROOT}/scripts/tex_to_qmd.py" \
    --tex "${SRC}/main.tex" \
    --chapters "${SRC}/chapters" \
    --out "${CONV}"

echo "[2/3] копирую figures в docs/"
mkdir -p "${OUT}/figures"
cp -r "${SRC}/figures/." "${OUT}/figures/"

echo "[3/3] quarto render"
cd "${REPO_ROOT}"
quarto render --output-dir docs

echo "✅ Готово: ${OUT}/index.html"
