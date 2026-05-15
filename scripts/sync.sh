#!/usr/bin/env bash
# Overleaf → uchebniik.fmin.xyz sync pipeline.
# Idempotent: only rebuilds when source actually changed.
set -euo pipefail
trap 'echo "[$(date -Is)] FAILED at line $LINENO" >> "$LOG"' ERR

HERE="/root/uchebniik"
LOG="$HERE/logs/sync.log"
COOKIE_JAR="$HERE/logs/overleaf_cookies.txt"
ZIP_NEW="$HERE/logs/project.new.zip"
ZIP_PREV="$HERE/logs/project.prev.zip"
mkdir -p "$HERE/logs"

log() { echo "[$(date -Is)] $*" | tee -a "$LOG"; }

# load creds
set -a; source /root/config/.env; set +a
: "${OVERLEAF_EMAIL:?missing}"; : "${OVERLEAF_PASSWORD:?missing}"
SHARE_TOKEN="${OVERLEAF_PROJECT_ID:-2484959286nqqftjdwkqxc}"  # the token from URL
HOST="https://overleaf.mipt.ru"

log "=== sync start ==="

# 1. Login (fresh CSRF each time; sessions can expire)
rm -f "$COOKIE_JAR"
curl -s -c "$COOKIE_JAR" "$HOST/login" -o "$HERE/logs/login.html"
CSRF=$(grep -oE 'ol-csrfToken[^>]*content="[^"]+"' "$HERE/logs/login.html" \
       | head -1 | sed -E 's/.*content="([^"]+)".*/\1/')
[ -n "$CSRF" ] || { log "ERROR: no CSRF token"; exit 1; }

LOGIN_HTTP=$(curl -s -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X POST "$HOST/login" \
  -H "X-CSRF-TOKEN: $CSRF" -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d "{\"_csrf\":\"$CSRF\",\"email\":\"$OVERLEAF_EMAIL\",\"password\":\"$OVERLEAF_PASSWORD\"}" \
  -w "%{http_code}" -o "$HERE/logs/login_resp.json")
case "$LOGIN_HTTP" in
  200|302) log "login ok ($LOGIN_HTTP)";;
  *) log "ERROR: login http=$LOGIN_HTTP body=$(cat $HERE/logs/login_resp.json)"; exit 1;;
esac

# 2. Find project ID from user's dashboard (project is permanently linked
#    via share-token grant, so we just look it up by source=token)
curl -s -b "$COOKIE_JAR" "$HOST/project" -o "$HERE/logs/dashboard.html"
PROJECT_ID=$(python3 <<'PY'
import re, html, json, sys
h = open("/root/uchebniik/logs/dashboard.html").read()
m = re.search(r'name="ol-prefetchedProjectsBlob"[^>]*content="([^"]*)"', h)
if not m: sys.exit("no blob")
data = json.loads(html.unescape(m.group(1)))
# pick the first project sourced from share-token
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

# 4. Skip rebuild if content identical
if [ -f "$ZIP_PREV" ]; then
  PREV_HASH=$(sha256sum "$ZIP_PREV" | cut -d' ' -f1)
  NEW_HASH=$(sha256sum "$ZIP_NEW" | cut -d' ' -f1)
  if [ "$PREV_HASH" = "$NEW_HASH" ]; then
    log "no changes (hash $NEW_HASH); skip rebuild"
    rm -f "$ZIP_NEW"
    exit 0
  fi
fi
log "content changed, rebuilding"

# 5. Replace source/
rm -rf "$HERE/source"
mkdir -p "$HERE/source"
unzip -oq "$ZIP_NEW" -d "$HERE/source/"

# 6. Convert PDF figures → SVG (only those that changed)
mkdir -p "$HERE/figures_svg" "$HERE/figures"
for pdf in "$HERE/source/figures/"*.pdf; do
  [ -f "$pdf" ] || continue
  name=$(basename "$pdf" .pdf)
  svg="$HERE/figures_svg/${name}.svg"
  if [ ! -f "$svg" ] || [ "$pdf" -nt "$svg" ]; then
    pdftocairo -svg "$pdf" "$svg" 2>/dev/null && log "svg: $name"
  fi
done
cp -u "$HERE/figures_svg/"*.svg "$HERE/figures/"

# 7. Convert .tex → .qmd
python3 "$HERE/scripts/tex_to_qmd.py" >> "$LOG" 2>&1
log "converted .qmd"

# 8. Build HTML site
cd "$HERE"
quarto render >> "$LOG" 2>&1
log "quarto rendered"

# 9. Build authoritative PDF (best-effort; warnings ok)
cd "$HERE/source"
rm -f main.aux main.toc main.out main.log
timeout 240 latexmk -xelatex -interaction=nonstopmode main.tex >> "$LOG" 2>&1 || true
if [ -f main.pdf ]; then
  cp main.pdf "$HERE/_site/book.pdf"
  log "pdf: $(du -h $HERE/_site/book.pdf | cut -f1)"
else
  log "pdf: build failed (HTML still ok)"
fi

# 10. Publish to nginx web root (separate from /root/ which is 700)
PUBROOT="/var/www/uchebniik"
mkdir -p "$PUBROOT"
rsync -a --delete "$HERE/_site/" "$PUBROOT/"
log "published to $PUBROOT"

# 11. Promote zip as prev
mv "$ZIP_NEW" "$ZIP_PREV"

log "=== sync done ==="
