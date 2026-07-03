#!/usr/bin/env bash
# Overleaf → sigma.fmin.xyz sync pipeline.
# Idempotent: only rebuilds when source actually changed.
#
# Source of truth: Overleaf MIPT project (share-token grants permanent access).
# Pipeline: Overleaf ZIP → /var/www/sigma/overleaf_export/ → scripts/build.sh → docs/.
# nginx читает /var/www/sigma/docs/ напрямую.
set -euo pipefail

REPO_ROOT="/var/www/sigma"
LOG_DIR="${REPO_ROOT}/logs"
LOG="${LOG_DIR}/sync.log"
COOKIE_JAR="${LOG_DIR}/overleaf_cookies.txt"
ZIP_NEW="${LOG_DIR}/project.new.zip"
ZIP_PREV="${LOG_DIR}/project.prev.zip"
WORK_DIR="${LOG_DIR}/zip_extract"
mkdir -p "${LOG_DIR}"

trap 'echo "[$(date -Is)] FAILED at line $LINENO" >> "$LOG"' ERR

log() { echo "[$(date -Is)] $*" | tee -a "$LOG"; }

# load creds
set -a; source /root/config/.env; set +a
: "${OVERLEAF_EMAIL:?missing}"; : "${OVERLEAF_PASSWORD:?missing}"
SHARE_TOKEN="${OVERLEAF_PROJECT_ID:-2484959286nqqftjdwkqxc}"
HOST="https://overleaf.mipt.ru"

log "=== sigma sync start ==="

# 1. Login (fresh CSRF each time; sessions can expire)
rm -f "$COOKIE_JAR"
curl -s -c "$COOKIE_JAR" "$HOST/login" -o "${LOG_DIR}/login.html"
CSRF=$(grep -oE 'ol-csrfToken[^>]*content="[^"]+"' "${LOG_DIR}/login.html" \
       | head -1 | sed -E 's/.*content="([^"]+)".*/\1/')
[ -n "$CSRF" ] || { log "ERROR: no CSRF token"; exit 1; }

LOGIN_HTTP=$(curl -s -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X POST "$HOST/login" \
  -H "X-CSRF-TOKEN: $CSRF" -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d "{\"_csrf\":\"$CSRF\",\"email\":\"$OVERLEAF_EMAIL\",\"password\":\"$OVERLEAF_PASSWORD\"}" \
  -w "%{http_code}" -o "${LOG_DIR}/login_resp.json")
case "$LOGIN_HTTP" in
  200|302) log "login ok ($LOGIN_HTTP)";;
  *) log "ERROR: login http=$LOGIN_HTTP body=$(cat ${LOG_DIR}/login_resp.json)"; exit 1;;
esac

# 2. Find project ID from user's dashboard (linked via share-token).
curl -s -b "$COOKIE_JAR" "$HOST/project" -o "${LOG_DIR}/dashboard.html"
PROJECT_ID=$(LOG_DIR="${LOG_DIR}" python3 <<'PY'
import re, html, json, os, sys
h = open(os.path.join(os.environ["LOG_DIR"], "dashboard.html")).read()
m = re.search(r'name="ol-prefetchedProjectsBlob"[^>]*content="([^"]*)"', h)
if not m: sys.exit("no blob")
data = json.loads(html.unescape(m.group(1)))
for p in data.get("projects", []):
    if p.get("source") == "token":
        print(p["id"]); break
PY
)
[ -n "$PROJECT_ID" ] || { log "ERROR: no token-sourced project in dashboard"; exit 1; }
log "project_id=$PROJECT_ID"

# 3. Download zip
DL_INFO=$(curl -s -b "$COOKIE_JAR" -L -o "$ZIP_NEW" \
  -w "size=%{size_download} http=%{response_code}" \
  "$HOST/project/$PROJECT_ID/download/zip")
log "$DL_INFO"
file "$ZIP_NEW" | grep -q "Zip archive" || { log "ERROR: not a zip"; exit 1; }

# 4. Распаковываем и решаем по хэшу СОДЕРЖИМОГО, а не zip.
#    Overleaf отдаёт недетерминированный zip (одинаковый контент — разные байты
#    каждую загрузку), поэтому хэш zip срабатывал «content changed» каждый час.
#    Хэшируем извлечённые исходники (.tex/.bib/.cls/.sty + figures).
rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"
unzip -oq "$ZIP_NEW" -d "$WORK_DIR/"
rm -f "$ZIP_NEW"

CONTENT_HASH=$( (cd "$WORK_DIR" && find . -type f \( -name '*.tex' -o -name '*.bib' \
  -o -name '*.cls' -o -name '*.sty' -o -path './figures/*' \) | sort \
  | xargs -r sha256sum) | sha256sum | cut -d' ' -f1)
HASH_FILE="${LOG_DIR}/content.hash"
if [ -f "$HASH_FILE" ] && [ "$(cat "$HASH_FILE")" = "$CONTENT_HASH" ]; then
  log "no source changes (content $CONTENT_HASH); skip rebuild"
  rm -rf "$WORK_DIR"
  exit 0
fi
log "content changed, rebuilding (content $CONTENT_HASH)"

# 5. Заменяем overleaf_export/ (rsync поверх, сохраняя артефакты latexmk).
EXPORT_DIR="${REPO_ROOT}/overleaf_export"
# make_figures.py: source of truth — git-копия, НЕ Overleaf. Копия в Overleaf
# устарела и каждый синк откатывала закоммиченные фиксы подписей фигур
# (инцидент 2026-06-27: на live вернулись починенные дефекты newton/taylor).
rsync -a --delete \
  --exclude='main.pdf' --exclude='main.aux' --exclude='main.log' \
  --exclude='main.out' --exclude='main.toc' --exclude='main.fls' \
  --exclude='main.fdb_latexmk' --exclude='main.xdv' --exclude='main.synctex.gz' \
  --exclude='make_figures.py' \
  "$WORK_DIR/" "$EXPORT_DIR/"
rm -rf "$WORK_DIR"
log "overleaf_export updated"

# 6. Запустить полный build pipeline (LaTeX → PDF, tex→qmd, quarto render).
"${REPO_ROOT}/scripts/build.sh" >> "$LOG" 2>&1
log "build.sh finished"

# 7. Зафиксировать хэш контента ТОЛЬКО после успешной сборки
#    (упавший билд → повтор на следующем часу).
echo "$CONTENT_HASH" > "$HASH_FILE"

log "=== sigma sync done ==="
