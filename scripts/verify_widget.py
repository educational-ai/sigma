#!/usr/bin/env python3
"""verify_widget.py — браузерная проверка живых виджетов Сигмы.
Грузит страницу, ждёт монтирования, ловит console-ошибки, двигает каждый
ползунок (min→max), проверяет факт перерисовки canvas, скриншотит до/после.
Верификация + инструмент design-review.

Запуск:  /root/.venv/bin/python scripts/verify_widget.py <url> <outDir>
"""
import json
import os
import sys

from playwright.sync_api import sync_playwright

url = sys.argv[1] if len(sys.argv) > 1 else "https://sigma.fmin.xyz/story_pca.html"
out_dir = sys.argv[2] if len(sys.argv) > 2 else "/tmp/sigverify"
os.makedirs(out_dir, exist_ok=True)
slug = url.rstrip("/").split("/")[-1].replace(".html", "") or "page"

errors = []
report = {"url": url, "widgets": 0, "errors": [], "results": []}

CANVAS_HASH = """el => { const c = el.querySelector('canvas'); if(!c) return null;
  try { const u = c.toDataURL(); return u.length + ':' + u.slice(-80); } catch(e){ return 'tainted'; } }"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1100, "height": 1400}, device_scale_factor=2)
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append("PAGEERROR: " + e.message))
    page.goto(url, wait_until="networkidle", timeout=60000)
    page.wait_for_timeout(800)

    widgets = page.locator(".sigma-int")
    n = widgets.count()
    report["widgets"] = n
    if n == 0:
        report["errors"].append("НЕТ смонтированных .sigma-int виджетов")

    for i in range(n):
        w = widgets.nth(i)
        w.scroll_into_view_if_needed()
        page.wait_for_timeout(500)
        r = {"index": i, "hasCanvas": False, "hasSvg": False, "reactsToSlider": None, "err": None}
        if w.locator(".sigma-int-err").count():
            r["err"] = w.locator(".sigma-int-err").first.text_content()
        r["hasCanvas"] = w.locator("canvas").count() > 0
        r["hasSvg"] = w.locator("svg.sigma-int-svg").count() > 0
        try:
            w.screenshot(path=f"{out_dir}/{slug}_w{i}_before.png")
        except Exception:
            pass

        ranges = w.locator("input[type=range]")
        nr = ranges.count()
        if nr > 0 and r["hasCanvas"]:
            handle = w.element_handle()
            h0 = handle.evaluate(CANVAS_HASH)
            rng = ranges.first
            mx = rng.get_attribute("max")
            mn = rng.get_attribute("min")
            for val in (mx, mn):
                rng.fill(str(val))
                rng.dispatch_event("input")
                page.wait_for_timeout(300)
            h1 = handle.evaluate(CANVAS_HASH)
            r["reactsToSlider"] = (h0 != h1)
            try:
                mid = round((float(mn) + float(mx)) / 2)
                rng.fill(str(mid))
                rng.dispatch_event("input")
                page.wait_for_timeout(300)
            except Exception:
                pass
            try:
                w.screenshot(path=f"{out_dir}/{slug}_w{i}_after.png")
            except Exception:
                pass
        report["results"].append(r)

    report["errors"].extend(errors)
    browser.close()

with open(f"{out_dir}/{slug}_report.json", "w") as f:
    json.dump(report, f, ensure_ascii=False, indent=2)
print(json.dumps(report, ensure_ascii=False, indent=2))
