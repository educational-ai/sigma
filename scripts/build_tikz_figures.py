#!/usr/bin/env python3
# @feanor: persistent
"""TikZ-фигуры сайта: figures_tikz/*.tex → book/figures/*.svg.

Раньше эти 24 фигуры жили внутри глав Overleaf и вырезались на лету
tex_to_qmd.py — то есть существовали ровно до тех пор, пока жив Overleaf-проект
МФТИ, а standalone-исходники лежали в untracked _tikz_build/ на одном диске.
Теперь исходники под git и рендерятся здесь, локальным xelatex.

Пересобирает только то, что изменилось (sha256 исходника рядом с SVG).
"""
from __future__ import annotations

import hashlib
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SRC = REPO / "figures_tikz"
OUT = REPO / "book" / "figures"
BUILD = REPO / "figures_tikz" / ".build"


def render(tex: Path) -> tuple[bool, str]:
    OUT.mkdir(parents=True, exist_ok=True)
    BUILD.mkdir(parents=True, exist_ok=True)
    name = tex.stem
    svg = OUT / f"{name}.svg"
    stamp = BUILD / f"{name}.sha256"
    digest = hashlib.sha256(tex.read_bytes()).hexdigest()
    if svg.exists() and stamp.exists() and stamp.read_text().strip() == digest:
        return True, "skip"
    work = BUILD / f"{name}.tex"
    work.write_text(tex.read_text(encoding="utf-8"), encoding="utf-8")
    try:
        subprocess.run(
            ["xelatex", "-interaction=nonstopmode", "-halt-on-error", work.name],
            cwd=BUILD, check=True, capture_output=True, text=True, timeout=180,
        )
        subprocess.run(
            ["pdftocairo", "-svg", str(BUILD / f"{name}.pdf"), str(svg)],
            check=True, capture_output=True, text=True, timeout=60,
        )
    except subprocess.CalledProcessError as e:
        return False, ((e.stdout or "") + (e.stderr or ""))[-600:]
    except subprocess.TimeoutExpired:
        return False, "timeout"
    stamp.write_text(digest + "\n")
    return True, "built"


def main() -> None:
    if not SRC.exists():
        print(f"  ⚠ {SRC} отсутствует — TikZ-фигуры не собраны")
        return
    built = skipped = 0
    failed: list[str] = []
    for tex in sorted(SRC.glob("*.tex")):
        ok, how = render(tex)
        if not ok:
            failed.append(tex.stem)
            print(f"    ✗ {tex.stem}: {how}", file=sys.stderr)
        elif how == "built":
            built += 1
            print(f"    ↻ {tex.stem}")
        else:
            skipped += 1
    print(f"  TikZ: {built} пересобрано, {skipped} без изменений, {len(failed)} ошибок")
    if failed:
        raise SystemExit(f"✗ не собрались: {', '.join(failed)}")


if __name__ == "__main__":
    main()
