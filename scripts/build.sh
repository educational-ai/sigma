#!/usr/bin/env bash
# Build pipeline: overleaf_export/ → docs/
# Конвертирует LaTeX из Overleaf в HTML сайт для uchebniik.fmin.xyz.
#
# TODO: интегрировать существующий конвертер из /root/uchebniik/scripts/tex_to_qmd.py
# и Quarto конфиг (_quarto.yml) — когда Даниил приведёт материалы в порядок.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${REPO_ROOT}/overleaf_export"
OUT="${REPO_ROOT}/docs"

if [ ! -f "${SRC}/main.tex" ]; then
    echo "ERROR: ${SRC}/main.tex not found. Положи экспорт из Overleaf в overleaf_export/." >&2
    exit 1
fi

echo "[build] source: ${SRC}"
echo "[build] target: ${OUT}"
echo "[build] TODO: реализовать конвертацию (см. /root/uchebniik/scripts/tex_to_qmd.py)"
