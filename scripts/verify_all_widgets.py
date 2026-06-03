#!/usr/bin/env python3
"""verify_all_widgets.py — массовая браузерная проверка ВСЕХ живых виджетов.
Находит docs/*.html с data-sigma-widget, гоняет каждую страницу через
verify_widget.py-логику, агрегирует отчёт + скриншоты в outDir.

Запуск: /root/.venv/bin/python scripts/verify_all_widgets.py [outDir] [base_url]
"""
import glob
import json
import os
import re
import sys

from playwright.sync_api import sync_playwright

out_dir = sys.argv[1] if len(sys.argv) > 1 else "/tmp/sigverify"
base = sys.argv[2] if len(sys.argv) > 2 else "https://sigma.fmin.xyz"
os.makedirs(out_dir, exist_ok=True)
DOCS = os.path.join(os.path.dirname(__file__), "..", "docs")

pages = []
for f in sorted(glob.glob(os.path.join(DOCS, "*.html"))):
    txt = open(f, encoding="utf-8", errors="ignore").read()
    names = re.findall(r'data-sigma-widget="([^"]+)"', txt)
    if names:
        pages.append((os.path.basename(f), names))

CANVAS_HASH = """el => { const c = el.querySelector('canvas'); if(!c) return null;
  try { const u=c.toDataURL(); return u.length+':'+u.slice(-80); } catch(e){ return 'tainted'; } }"""

summary = []
with sync_playwright() as p:
    browser = p.chromium.launch()
    for fname, names in pages:
        slug = fname.replace(".html", "")
        url = f"{base}/{fname}"
        errors = []
        page = browser.new_page(viewport={"width": 1100, "height": 1500}, device_scale_factor=2)
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append("PAGEERROR: " + e.message))
        try:
            page.goto(url, wait_until="networkidle", timeout=60000)
            page.wait_for_timeout(800)
        except Exception as e:
            summary.append({"page": fname, "load_error": str(e)})
            page.close(); continue
        widgets = page.locator(".sigma-int")
        n = widgets.count()
        wres = []
        for i in range(n):
            w = widgets.nth(i)
            w.scroll_into_view_if_needed()
            page.wait_for_timeout(400)
            r = {"i": i, "widget": names[i] if i < len(names) else "?",
                 "canvas": w.locator("canvas").count() > 0,
                 "svg": w.locator("svg.sigma-int-svg").count() > 0,
                 "err": None, "reacts": None}
            if w.locator(".sigma-int-err").count():
                r["err"] = w.locator(".sigma-int-err").first.text_content()
            try:
                w.screenshot(path=f"{out_dir}/{slug}_w{i}_before.png")
            except Exception:
                pass
            ranges = w.locator("input[type=range]")
            if ranges.count() and r["canvas"]:
                h = w.element_handle()
                h0 = h.evaluate(CANVAS_HASH)
                rng = ranges.first
                for v in (rng.get_attribute("max"), rng.get_attribute("min")):
                    rng.fill(str(v)); rng.dispatch_event("input"); page.wait_for_timeout(250)
                r["reacts"] = h.evaluate(CANVAS_HASH) != h0
                try:
                    w.screenshot(path=f"{out_dir}/{slug}_w{i}_after.png")
                except Exception:
                    pass
            wres.append(r)
        summary.append({"page": fname, "widgets": wres, "console_errors": errors[:10]})
        page.close()
    browser.close()

with open(f"{out_dir}/_summary.json", "w") as f:
    json.dump(summary, f, ensure_ascii=False, indent=2)

# краткий human-readable вывод
print(f"Проверено страниц: {len(summary)}")
for s in summary:
    if "load_error" in s:
        print(f"  ✗ {s['page']}: LOAD ERROR {s['load_error'][:60]}"); continue
    for w in s["widgets"]:
        flag = "✓" if (w["reacts"] and not w["err"]) else ("⚠" if not w["err"] else "✗")
        print(f"  {flag} {s['page']} [{w['widget']}] canvas={w['canvas']} svg={w['svg']} reacts={w['reacts']} err={w['err']}")
    if s["console_errors"]:
        print(f"      console: {s['console_errors']}")
print(f"\nСводка: {out_dir}/_summary.json | скриншоты: {out_dir}/*_w*.png")
