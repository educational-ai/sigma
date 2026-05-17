#!/usr/bin/env python3
"""Split big chapter qmds (ch03_ds, ch04_numtheory) into per-section files.

Idempotent — safe to re-run after tex_to_qmd regenerates chapter qmds.

Reads:  dop/<chapter>.qmd
Writes: dop/<chapter>_<section_num>.qmd  (one per ## section)
        dop/<chapter>_intro.qmd          (text before first ##)

Removes original dop/<chapter>.qmd if split happened.

Configuration: SPLIT_CHAPTERS list — which chapters to split.
ch01_intro and ch02_newton stay as single files (too small / one section).
"""
import re
import sys
from pathlib import Path

DOP = Path(__file__).resolve().parent.parent / "book"

# (source_qmd_basename, output_prefix, chapter_number)
SPLIT_CHAPTERS = [
    ("ch03_ds", "ch03", 3),
    ("ch04_numtheory", "ch04", 4),
]

FRONTMATTER_RE = re.compile(r'^---\n(.*?)\n---\n(.*)', re.DOTALL)
SECTION_SPLIT_RE = re.compile(r'\n(?=## )')
HEADING_RE = re.compile(r'## (?P<title>[^\n{]+?)(?:\s*\{[^}]*\})?\s*\n')


def slugify(text: str, max_len: int = 32) -> str:
    """Russian/English → kebab-case ascii slug."""
    table = str.maketrans({
        "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
        "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
        "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
        "ф": "f", "х": "h", "ц": "c", "ч": "ch", "ш": "sh", "щ": "sch",
        "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
    })
    s = text.lower().translate(table)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:max_len].rstrip("-") or "section"


def split_one(src_basename: str, prefix: str, chapter_num: int) -> list[Path]:
    src = DOP / f"{src_basename}.qmd"
    if not src.exists():
        print(f"  skip {src.name}: not found")
        return []

    text = src.read_text(encoding="utf-8")
    m = FRONTMATTER_RE.match(text)
    if not m:
        print(f"  skip {src.name}: no frontmatter")
        return []
    # Pull the chapter's own title (set by tex_to_qmd from \chapter{...})
    # to label the intro page — better than the generic "Введение".
    src_title_m = re.search(r'title:\s*"([^"]+)"', m.group(1))
    src_title = src_title_m.group(1) if src_title_m else None
    body = m.group(2)

    parts = SECTION_SPLIT_RE.split(body)
    if len(parts) < 2:
        print(f"  skip {src.name}: no ## sections")
        return []

    intro_text = parts[0].strip()
    sections = parts[1:]

    out_files: list[Path] = []

    # Intro page — preserve previous title if file already exists
    if intro_text:
        intro_path = DOP / f"{prefix}_0_intro.qmd"
        existing_title = None
        if intro_path.exists():
            mm = FRONTMATTER_RE.match(intro_path.read_text(encoding="utf-8"))
            if mm:
                tm = re.search(r'title:\s*"([^"]+)"', mm.group(1))
                if tm:
                    existing_title = tm.group(1)
        title = existing_title or src_title or f"Глава {chapter_num}. Введение"
        intro_path.write_text(
            f"---\ntitle: \"{title}\"\n---\n\n{intro_text}\n",
            encoding="utf-8",
        )
        out_files.append(intro_path)

    # Section pages
    for i, sec in enumerate(sections, 1):
        h = HEADING_RE.match(sec)
        title = h.group("title").strip() if h else f"Раздел {i}"
        # Drop the heading line from body
        sec_body = HEADING_RE.sub("", sec, count=1).lstrip()
        # Promote H3→H2, H4→H3, etc.
        sec_body = re.sub(r"^### ", "## ", sec_body, flags=re.MULTILINE)
        sec_body = re.sub(r"^#### ", "### ", sec_body, flags=re.MULTILINE)
        sec_body = re.sub(r"^##### ", "#### ", sec_body, flags=re.MULTILINE)

        slug = slugify(title)
        out_path = DOP / f"{prefix}_{i}_{slug}.qmd"
        out_path.write_text(
            f"---\ntitle: \"{chapter_num}.{i} {title}\"\n---\n\n{sec_body}\n",
            encoding="utf-8",
        )
        out_files.append(out_path)

    # Remove original now that split succeeded
    src.unlink()
    print(f"  split {src.name} → {len(out_files)} files")
    return out_files


def main() -> None:
    all_files: list[Path] = []
    for src_base, prefix, ch_num in SPLIT_CHAPTERS:
        all_files.extend(split_one(src_base, prefix, ch_num))

    if not all_files:
        return

    # Print a fragment for _quarto.yml chapters list
    print("\n# Generated chapters fragment (copy into _quarto.yml under appropriate part):")
    by_chapter: dict[int, list[Path]] = {}
    for f in all_files:
        m = re.match(r"ch(\d+)_", f.name)
        if m:
            by_chapter.setdefault(int(m.group(1)), []).append(f)
    for ch, files in sorted(by_chapter.items()):
        print(f"# Chapter {ch}:")
        for f in sorted(files, key=lambda p: p.name):
            print(f"  - {f.name}")


if __name__ == "__main__":
    main()
