#!/usr/bin/env python3
# @feanor: persistent
"""Дерево страниц на главной (book/index.qmd) — генерируется из _quarto.yml.

Зачем: раньше дерево на лендинге правили руками, и оно разъехалось с сайдбаром —
семь сюжетов в дерево не попали вовсе, а «Часть III» вела на ch_linalg.html,
которого нет с тех пор, как главу нарезали на страницы (живой 404 на главной).
Теперь состав и порядок берутся из единственного источника — sidebar в
book/_quarto.yml, а руками поддерживается только текст подписей
(book/landing_desc.json). Ссылка на несуществующую страницу физически
невозможна: генератор падает, если .qmd из сайдбара нет на диске.

Вставляется в index.qmd между маркерами:
  <!-- TREE:START -->  ...  <!-- TREE:END -->
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent
BOOK = REPO / "book"
QUARTO_YML = BOOK / "_quarto.yml"
INDEX_QMD = BOOK / "index.qmd"
DESC_JSON = BOOK / "landing_desc.json"

START, END = "<!-- TREE:START -->", "<!-- TREE:END -->"


def esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def qmd_title(stem: str) -> str:
    """Заголовок страницы из frontmatter .qmd."""
    path = BOOK / f"{stem}.qmd"
    if not path.exists():
        raise SystemExit(f"✗ сайдбар ссылается на {stem}.qmd, которого нет в book/")
    head = path.read_text(encoding="utf-8").split("---", 2)
    fm = head[1] if len(head) > 2 else ""
    m = re.search(r'^title:\s*"?(.*?)"?\s*$', fm, re.M)
    return m.group(1) if m else stem


def entries(node) -> list[tuple[str, str]]:
    """[(stem, title)] для одного элемента contents."""
    if isinstance(node, str):
        stem = node[:-4] if node.endswith(".qmd") else node
        return [(stem, qmd_title(stem))]
    if isinstance(node, dict) and "href" in node:
        href = node["href"]
        stem = href[:-4] if href.endswith(".qmd") else href
        return [(stem, node.get("text") or qmd_title(stem))]
    return []


def render() -> str:
    cfg = yaml.safe_load(QUARTO_YML.read_text(encoding="utf-8"))
    desc = json.loads(DESC_JSON.read_text(encoding="utf-8"))
    contents = cfg["website"]["sidebar"]["contents"]

    missing: list[str] = []
    # Raw-html блок: внутри .desc живёт $TeX$, который дорисовывает KaTeX уже
    # в браузере — пандоку туда лезть незачем.
    out = ["```{=html}", '<section class="sigma-tree">', "", "<h2>Все сюжеты</h2>", ""]
    out.append(
        '<p class="lede">Деления на главы нет: каждая страница — законченный '
        "сюжет, который читается сам по себе. Порядок ниже — рекомендованный, "
        "но заходить можно с любого места.</p>"
    )
    out.append(
        '<p class="controls">\n'
        "<a onclick=\"document.querySelectorAll('.sigma-tree details')"
        '.forEach(d=>d.open=true)">раскрыть всё</a>\n'
        "<a onclick=\"document.querySelectorAll('.sigma-tree details')"
        '.forEach(d=>d.open=false)">свернуть всё</a>\n</p>'
    )

    for node in contents:
        for stem, title in entries(node):
            if stem == "index":
                continue
            out += _leaf(stem, title, desc, missing)

    out.append("</section>")
    out.append("```")

    if missing:
        print(
            "  ⚠ нет подписи в landing_desc.json: " + ", ".join(missing),
            file=sys.stderr,
        )
    return "\n".join(out)


def _leaf(stem: str, title: str, desc: dict, missing: list[str]) -> list[str]:
    tag = ' <span class="tag new">сюжет</span>' if stem.startswith("story_") else ""
    body = desc.get(stem)
    if body is None:
        missing.append(stem)
        body = ""
    lines = [
        "<details>",
        f'<summary><a href="{stem}.html">{esc(title)}{tag}</a></summary>',
    ]
    if body:
        lines.append(f'<div class="desc">{body}</div>')
    lines += ["</details>", ""]
    return lines


def main() -> None:
    text = INDEX_QMD.read_text(encoding="utf-8")
    if START not in text or END not in text:
        raise SystemExit(f"✗ маркеры {START}/{END} не найдены в {INDEX_QMD}")
    pre, rest = text.split(START, 1)
    _, post = rest.split(END, 1)
    new = f"{pre}{START}\n{render()}\n{END}{post}"
    if new != text:
        INDEX_QMD.write_text(new, encoding="utf-8")
        print("  ✓ дерево на главной пересобрано из _quarto.yml")
    else:
        print("  дерево на главной без изменений")


if __name__ == "__main__":
    main()
