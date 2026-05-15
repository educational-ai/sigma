#!/usr/bin/env python3
"""
AI textbook prototype server.

Endpoints:
- GET  /                  index.html
- GET  /api/model         current best free model id (from shir-man.com)
- GET  /api/chapters      list of {slug, title}
- GET  /api/chapter/<slug>  {title, subtitle, html}
- GET  /static/<file>     static assets (mp4, svg, ...)
- POST /api/ask           {fragment, question} -> OpenRouter answer

Run:
    OPENROUTER_API_KEY=sk-or-... python3 server.py
"""

import http.server
import json
import os
import re
import socketserver
import sys
import time
import urllib.parse
import urllib.request
import urllib.error
from pathlib import Path

import markdown as md  # type: ignore

HERE = Path(__file__).parent
CHAPTERS_DIRS = [
    HERE / "chapters_template",                        # Альянс ИИ template chapters (highest priority)
    HERE / "chapters",
    HERE / "chapters_ru",                              # Russian translations of optim chapters
    HERE / "_optim_repo" / "docs" / "visualizations",  # English fallback while translations pending
]
STATIC_DIRS = [
    HERE / "ai-textbook-template" / "figures_svg",     # template figures (PDF→SVG converted)
    HERE / "_optim_repo" / "docs" / "visualizations",
]

API_KEY = os.environ.get("OPENROUTER_API_KEY", "").strip()
MODEL_ENDPOINT = "https://shir-man.com/api/free-llm/top-models"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
FALLBACK_MODEL = "openrouter/free"

_model_cache = {"id": None, "fetched_at": 0.0}


def fetch_top_model():
    now = time.time()
    if _model_cache["id"] and now - _model_cache["fetched_at"] < 300:
        return _model_cache["id"]
    try:
        req = urllib.request.Request(
            MODEL_ENDPOINT,
            headers={"User-Agent": "ai-textbook-prototype/0.1 (+fmin.xyz)"},
        )
        with urllib.request.urlopen(req, timeout=5) as r:
            data = json.loads(r.read())
        model_id = data["models"][0]["id"]
        _model_cache.update(id=model_id, fetched_at=now)
        return model_id
    except Exception as e:
        print(f"[model] fetch failed: {e}", file=sys.stderr)
        return FALLBACK_MODEL


SYSTEM_PROMPT = (
    "Ты — встроенный помощник школьного учебника информатики (10-11 класс, "
    "Альянс ИИ). Тебе дают конкретный фрагмент учебника и вопрос ученика. "
    "Отвечай по-русски, кратко, на уровне старшеклассника. Если фрагмент не "
    "содержит ответа напрямую — честно скажи об этом и дополни из общих знаний "
    "по информатике / математике / нейросетям. Никогда не выдумывай факты.\n\n"
    "Форматирование: используй markdown. Для математических формул используй "
    "ТОЛЬКО доллары: $...$ для формул внутри строки и $$...$$ для формул в "
    "отдельной строке. НЕ используй \\(...\\) и \\[...\\] — они не отрендерятся."
)


# ----------------------------- chapter rendering -----------------------------

FRONTMATTER_RE = re.compile(r"^---\n(.*?)\n---\n", re.DOTALL)
VIDEO_BLOCK_RE = re.compile(
    r":::\s*\{\.video\}\s*\n(.+?)\n:::", re.DOTALL
)
GENERIC_FENCED_DIV_RE = re.compile(
    r":::([\w.-]+)?\s*\n(.*?)\n:::", re.DOTALL
)


def parse_frontmatter(text: str):
    m = FRONTMATTER_RE.match(text)
    if not m:
        return {}, text
    meta = {}
    for line in m.group(1).split("\n"):
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip().strip('"').strip("'")
    return meta, text[m.end():]


def stash_math(text: str):
    blocks = []

    def grab(match):
        blocks.append(match.group(0))
        return f"\x00MATH{len(blocks)-1}\x00"

    text = re.sub(r"\$\$[\s\S]+?\$\$", grab, text)
    text = re.sub(r"(?<!\\)\$(?!\s)[^\n$]+?(?<!\s)\$", grab, text)
    return text, blocks


def restore_math(html: str, blocks):
    return re.sub(
        r"\x00MATH(\d+)\x00", lambda m: blocks[int(m.group(1))], html
    )


def render_md_to_html(text: str):
    # 1) Video blocks → <video> tags
    def video_repl(m):
        body = m.group(1).strip()
        # first non-empty line is the src
        for line in body.splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                src = line
                return (
                    f'<div class="video"><video src="/static/{src}" '
                    f'autoplay muted loop playsinline controls '
                    f'preload="metadata"></video></div>'
                )
        return ""

    text = VIDEO_BLOCK_RE.sub(video_repl, text)

    # 2) Generic fenced divs (e.g. :::sidebox, :::note)
    def div_repl(m):
        cls = (m.group(1) or "").lstrip(".").strip() or "callout"
        inner = m.group(2)
        # render inner as markdown (recursively, but safely — without frontmatter)
        inner_html = render_inline_md(inner)
        return f'<div class="callout callout-{cls}">{inner_html}</div>'

    text = GENERIC_FENCED_DIV_RE.sub(div_repl, text)

    # 3) Stash math
    text, math_blocks = stash_math(text)

    # 4) Markdown → HTML
    html = md.markdown(
        text,
        extensions=["extra", "sane_lists", "tables", "toc"],
        output_format="html5",
    )

    # 5) Rewrite relative <img src="..."> → /static/...
    html = rewrite_static_assets(html)

    # 6) Restore math
    html = restore_math(html, math_blocks)
    return html


RELATIVE_SRC_RE = re.compile(r'(<img\b[^>]*\bsrc=)"([^"]+)"', re.IGNORECASE)


def rewrite_static_assets(html: str) -> str:
    """Prefix relative <img src> with /static/ so SVGs/PNGs resolve via STATIC_DIRS."""
    def repl(m):
        prefix, src = m.group(1), m.group(2)
        if src.startswith(("http://", "https://", "/", "data:", "#")):
            return m.group(0)
        return f'{prefix}"/static/{src}"'
    return RELATIVE_SRC_RE.sub(repl, html)


def render_inline_md(text: str):
    """Like render_md_to_html but skipping the fenced-div pre-pass."""
    text, math_blocks = stash_math(text)
    html = md.markdown(
        text, extensions=["extra", "sane_lists"], output_format="html5"
    )
    return restore_math(html, math_blocks)


def discover_chapters():
    chapters = []
    seen = set()
    for d in CHAPTERS_DIRS:
        if not d.exists():
            continue
        for p in sorted(d.glob("*.md")):
            slug = p.stem
            if slug in seen:
                continue
            seen.add(slug)
            with p.open(encoding="utf-8") as f:
                meta, _ = parse_frontmatter(f.read())
            chapters.append(
                {
                    "slug": slug,
                    "title": meta.get("title") or slug.replace("_", " ").title(),
                    "subtitle": meta.get("subtitle", ""),
                    "_path": str(p),
                }
            )
    return chapters


def load_chapter(slug: str):
    for d in CHAPTERS_DIRS:
        p = d / f"{slug}.md"
        if p.exists():
            with p.open(encoding="utf-8") as f:
                raw = f.read()
            meta, body = parse_frontmatter(raw)
            html = render_md_to_html(body)
            return {
                "slug": slug,
                "title": meta.get("title") or slug.replace("_", " ").title(),
                "subtitle": meta.get("subtitle", ""),
                "html": html,
            }
    return None


# ----------------------------- OpenRouter ask --------------------------------

def ask_openrouter(fragment: str, question: str, model: str | None) -> dict:
    if not API_KEY:
        return {"error": "OPENROUTER_API_KEY не задан на сервере"}
    model = model or fetch_top_model()
    user_msg = (
        f"Фрагмент учебника:\n\"\"\"\n{fragment.strip()}\n\"\"\"\n\n"
        f"Вопрос ученика: {question.strip()}"
    )
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        "temperature": 0.3,
    }
    req = urllib.request.Request(
        OPENROUTER_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://fmin.xyz",
            "X-Title": "AI Textbook Prototype",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read())
        answer = data["choices"][0]["message"]["content"]
        return {"answer": answer, "model": model}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        return {"error": f"HTTP {e.code}: {body}", "model": model}
    except Exception as e:
        return {"error": str(e), "model": model}


# ----------------------------- HTTP handler ----------------------------------

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(HERE), **kw)

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))

    def _send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _serve_static(self, name: str):
        # very restrictive: only basename, no traversal
        if "/" in name or "\\" in name or ".." in name:
            return self.send_error(400)
        for d in STATIC_DIRS:
            p = d / name
            if p.exists() and p.is_file():
                self.path = "/" + str(p.relative_to(HERE))
                return super().do_GET()
        self.send_error(404)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path == "/api/model":
            return self._send_json({"model": fetch_top_model()})
        if path == "/api/chapters":
            chs = [
                {k: v for k, v in c.items() if not k.startswith("_")}
                for c in discover_chapters()
            ]
            return self._send_json({"chapters": chs})
        if path.startswith("/api/chapter/"):
            slug = path[len("/api/chapter/"):]
            slug = urllib.parse.unquote(slug)
            ch = load_chapter(slug)
            if not ch:
                return self._send_json({"error": "not found"}, status=404)
            return self._send_json(ch)
        if path.startswith("/static/"):
            return self._serve_static(path[len("/static/"):])
        return super().do_GET()

    def do_POST(self):
        if self.path == "/api/ask":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                body = json.loads(self.rfile.read(length).decode("utf-8"))
            except Exception as e:
                return self._send_json({"error": f"bad request: {e}"}, status=400)
            fragment = (body.get("fragment") or "").strip()
            question = (body.get("question") or "").strip()
            model = body.get("model") or None
            if not fragment or not question:
                return self._send_json(
                    {"error": "Нужно прислать fragment и question"}, status=400
                )
            result = ask_openrouter(fragment, question, model)
            status = 500 if "error" in result and "answer" not in result else 200
            return self._send_json(result, status=status)
        return self._send_json({"error": "not found"}, status=404)


class ThreadingServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8765))
    host = os.environ.get("HOST", "0.0.0.0")
    print(f"AI textbook prototype on http://{host}:{port}")
    print(f"OPENROUTER_API_KEY: {'set' if API_KEY else 'MISSING'}")
    print(f"Chapters discovered: {len(discover_chapters())}")
    ThreadingServer((host, port), Handler).serve_forever()
