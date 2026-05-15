#!/usr/bin/env python3
"""Translate optim chapters from English to Russian via OpenRouter.

Reads `_optim_repo/docs/visualizations/*.md`, writes `chapters_ru/*.md`.
Preserves math, frontmatter structure, fenced divs, and links.
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
SRC = HERE / "_optim_repo" / "docs" / "visualizations"
DST = HERE / "chapters_ru"
DST.mkdir(exist_ok=True)

API_KEY = os.environ.get("OPENROUTER_API_KEY", "").strip()
MODEL = os.environ.get("TRANSLATE_MODEL", "openrouter/owl-alpha")

SYSTEM = """Переводи главы курса по оптимизации с английского на аккуратный, естественный академический русский. Тон — учебник для старшекурсников и аспирантов: ясно, по-русски, без канцелярита и буквальных калек.

Правила:
- YAML frontmatter в начале (между --- и ---) сохрани, переведи только значение поля title: (и subtitle: если есть). Остальные ключи и форматирование не трогай.
- Всё содержимое математических формул $...$ и $$...$$ оставляй БЕЗ ИЗМЕНЕНИЙ. Никаких \\text{...} переводов. Никаких изменений внутри $.
- Структуру markdown сохраняй: заголовки, списки, таблицы, ссылки, кодовые блоки.
- Блоки вида :::{.video} foo.mp4 ::: и :::block ... ::: сохрани структурно, текст внутри тоже переводи.
- Ссылки [текст](url) — переводи текст, url не трогай.
- Кодовые блоки ``` ``` не переводи.

Терминология:
- gradient descent → градиентный спуск; stochastic gradient descent → стохастический градиентный спуск (SGD ок).
- convergence → сходимость; convex → выпуклый; strongly convex → сильно выпуклый.
- step size, learning rate → шаг, скорость обучения.
- condition number → число обусловленности; eigenvalue → собственное число; eigenvector → собственный вектор.
- proximal operator → проксимальный оператор; subgradient → субградиент; soft-thresholding → мягкая пороговая функция (soft-thresholding в скобках при первом упоминании).
- momentum (Polyak) → импульс / момент Поляка; Nesterov acceleration → ускорение Нестерова.
- line search → линейный поиск; backtracking → бэктрекинг.
- saddle point → седловая точка; local / global minimum → локальный / глобальный минимум.
- quadratic form → квадратичная форма.
- Lipschitz → Липшиц; Lipschitz continuous → липшицев / с константой Липшица.

Имена собственные: Chebyshev → Чебышёв, Newton → Ньютон, Polyak → Поляк, Nesterov → Нестеров, Lipschitz → Липшиц, Fokker-Planck → Фоккер–Планк, Lagrange → Лагранж.

Выводи ТОЛЬКО переведённый markdown целиком, без preamble, без обёрток ``` и без пояснений.
"""


def translate(text: str) -> str:
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": text},
        ],
        "temperature": 0.2,
    }
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://fmin.xyz",
            "X-Title": "AI Textbook Prototype - translate",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        data = json.loads(r.read())
    return data["choices"][0]["message"]["content"]


def process(md_path: Path):
    slug = md_path.stem
    out = DST / f"{slug}.md"
    if out.exists() and out.stat().st_size > 0:
        return slug, "skip (exists)"
    try:
        src = md_path.read_text(encoding="utf-8")
        t0 = time.time()
        translated = translate(src)
        out.write_text(translated, encoding="utf-8")
        return slug, f"ok {len(translated)} chars in {time.time()-t0:.1f}s"
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")[:200]
        return slug, f"ERR HTTP {e.code}: {body}"
    except Exception as e:
        return slug, f"ERR {e}"


def main():
    if not API_KEY:
        print("OPENROUTER_API_KEY missing", file=sys.stderr)
        sys.exit(1)
    mds = sorted(SRC.glob("*.md"))
    print(f"[translate] model={MODEL}, {len(mds)} chapters → {DST}")
    workers = int(os.environ.get("TRANSLATE_WORKERS", "4"))
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futures = {ex.submit(process, p): p for p in mds}
        for fut in as_completed(futures):
            slug, status = fut.result()
            print(f"  {slug:35s} {status}", flush=True)
    print("[translate] done")


if __name__ == "__main__":
    main()
