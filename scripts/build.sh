#!/usr/bin/env bash
# Build pipeline:
#   3 независимых quarto book-проекта (dop/, 10/, 11/) + top-level landing.
# nginx читает /var/www/uchebniik-repo/docs/ напрямую.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[1/4] render landing → docs/"
cd "${REPO_ROOT}"
quarto render index.qmd --to html --output-dir docs

echo "[2/4] render Дополнительный учебник → docs/dop/"
cd "${REPO_ROOT}/dop"
quarto render

echo "[3/4] render 10 класс → docs/10/"
cd "${REPO_ROOT}/10"
quarto render

echo "[4/4] render 11 класс → docs/11/"
cd "${REPO_ROOT}/11"
quarto render

echo "✅ Готово: https://uchebniik.fmin.xyz/"
