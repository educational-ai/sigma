#!/usr/bin/env python3
"""Добавить `{.python}` к code-блокам без языка.

Учебник написан на Python — все code-листинги по умолчанию Python.
Идемпотентно: уже размеченные блоки (```python или {.python ...}) не трогаем.

Запускается build.sh после split_chapters.py.
"""
import re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DIRS = ["book", "10", "11"]

# Bare opening: ``` {something}   (no language word inside braces)
# Skip if braces start with `.lang` (already classed), `=fmt` (raw block like {=html})
# or with a known Quarto engine name (mermaid, dot, ojs).
KNOWN_ENGINES = ("mermaid", "dot", "ojs")
BARE_FENCE_RE = re.compile(
    r'^```\s*\{(?![=.])(?!(?:' + '|'.join(KNOWN_ENGINES) + r')\b)(?P<attrs>[^}]*)\}\s*$',
    re.MULTILINE,
)
# Also handle bare ```\n... that's not preceded by an open fence
# Quarto: ``` opens, ``` closes. A bare ``` followed by `import` etc. likely Python.
BARE_PLAIN_RE = re.compile(r'^```\s*$\n(?P<body>(?:.*\n)*?)^```\s*$', re.MULTILINE)


def fix_file(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    changed = False

    def add_python_class(m: re.Match) -> str:
        nonlocal changed
        changed = True
        attrs = m.group("attrs").strip()
        if attrs:
            return f"```{{.python {attrs}}}"
        return "```{.python}"

    new_text = BARE_FENCE_RE.sub(add_python_class, text)

    if new_text != text:
        path.write_text(new_text, encoding="utf-8")
    return changed


def main() -> None:
    n = 0
    for d in DIRS:
        for qmd in (REPO / d).glob("*.qmd"):
            if fix_file(qmd):
                n += 1
                print(f"  fixed {qmd.relative_to(REPO)}")
    if n == 0:
        print("  no code blocks needed language hint")


if __name__ == "__main__":
    main()
