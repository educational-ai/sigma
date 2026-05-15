#!/usr/bin/env bash
# Build & deploy pipeline:
#   overleaf_export/ → [tex_to_qmd → quarto] → docs/ → rsync → /var/www/uchebniik/
# nginx serves /var/www/uchebniik as uchebniik.fmin.xyz.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${REPO_ROOT}/overleaf_export"
DOCS="${REPO_ROOT}/docs"
CONV="${REPO_ROOT}/converted"
WWW="/var/www/uchebniik"

if [ ! -f "${SRC}/main.tex" ]; then
    echo "ERROR: ${SRC}/main.tex not found" >&2
    exit 1
fi

echo "[1/4] tex → qmd"
python3 "${REPO_ROOT}/scripts/tex_to_qmd.py" \
    --tex "${SRC}/main.tex" \
    --chapters "${SRC}/chapters" \
    --out "${CONV}"

echo "[2/4] copy figures → docs/figures"
mkdir -p "${DOCS}/figures"
rsync -a --delete "${SRC}/figures/" "${DOCS}/figures/"

echo "[3/4] quarto render"
cd "${REPO_ROOT}"
quarto render --output-dir docs

echo "[4/4] deploy docs/ → ${WWW}/"
rsync -a --delete --exclude=.gitkeep "${DOCS}/" "${WWW}/"

echo "✅ Готово: https://uchebniik.fmin.xyz/"
