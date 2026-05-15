#!/usr/bin/env bash
# Build pipeline: overleaf_export/ → docs/ (nginx читает docs/ напрямую).
#
# nginx (sites-available/uchebniik.fmin.xyz): root /var/www/uchebniik-repo/docs.
# Изменения в docs/ видны на uchebniik.fmin.xyz моментально, без rsync/deploy.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${REPO_ROOT}/overleaf_export"
DOCS="${REPO_ROOT}/docs"
CONV="${REPO_ROOT}/converted"

if [ ! -f "${SRC}/main.tex" ]; then
    echo "ERROR: ${SRC}/main.tex not found" >&2
    exit 1
fi

echo "[1/3] tex → qmd"
python3 "${REPO_ROOT}/scripts/tex_to_qmd.py" \
    --tex "${SRC}/main.tex" \
    --chapters "${SRC}/chapters" \
    --out "${CONV}"

echo "[2/3] copy figures → docs/figures"
mkdir -p "${DOCS}/figures"
rsync -a --delete "${SRC}/figures/" "${DOCS}/figures/"

echo "[3/3] quarto render → docs/"
cd "${REPO_ROOT}"
quarto render --output-dir docs

echo "✅ Готово: https://uchebniik.fmin.xyz/"
