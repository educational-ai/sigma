#!/usr/bin/env python3
"""Convert ai-textbook-template/chapters/*.tex → chapters_template/*.md.

- pandoc handles latex→markdown (math + lists + structure)
- post-process: <embed src=X.pdf> + caption → ![alt](X.svg)
- strip stale anchor links and \label{...} inside math
- add YAML frontmatter with title (from first H1)
"""
import re
import shutil
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
SRC = HERE / "ai-textbook-template" / "chapters"
DST = HERE / "chapters_template"
FIG_DIR_REL = ""  # served via STATIC_DIRS

CHAPTERS = [
    ("preface.tex",     "tpl_00_preface.md",  None),  # title taken from H1
    ("ch01_intro.tex",  "tpl_01_intro.md",    None),
    ("ch02_newton.tex", "tpl_02_newton.md",   None),
    ("ch03_ml.tex",     "tpl_03_ml.md",       None),
]

FIGURE_RE = re.compile(
    r'<figure[^>]*>\s*<embed\s+src="([^"]+)"\s*/>\s*<figcaption>(.*?)</figcaption>\s*</figure>',
    re.DOTALL | re.IGNORECASE,
)
# anchor-style cross-refs pandoc emits: <a href="#xxx" data-reference-...>text</a>
ANCHOR_RE = re.compile(
    r'<a\s+href="#[^"]+"\s+data-reference[^>]*>([^<]*)</a>',
    re.IGNORECASE,
)
LABEL_IN_MATH_RE = re.compile(r'\\label\{[^}]+\}')


def pandoc_convert(tex: Path) -> str:
    out = subprocess.run(
        [
            "pandoc",
            "--from=latex",
            "--to=markdown_strict+pipe_tables+tex_math_dollars",
            "--wrap=preserve",
            str(tex),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return out.stdout


def strip_labels_in_math(md: str) -> str:
    def repl_block(m):
        body = m.group(1)
        body = LABEL_IN_MATH_RE.sub("", body)
        return f"$${body}$$"
    md = re.sub(r"\$\$([\s\S]+?)\$\$", repl_block, md)
    return md


def rewrite_figures(md: str) -> str:
    def repl(m):
        src = m.group(1)
        caption_html = m.group(2).strip()
        # naive HTML→text caption: drop tags
        caption = re.sub(r"<[^>]+>", "", caption_html)
        caption = re.sub(r"\s+", " ", caption).strip()
        # PDF → SVG
        svg = re.sub(r"\.pdf$", ".svg", src, flags=re.IGNORECASE)
        alt = caption.replace("[", "(").replace("]", ")")
        # caption rendered as italic line under image
        return f"![{alt[:120]}]({svg})\n\n*{caption}*"
    return FIGURE_RE.sub(repl, md)


def strip_cross_refs(md: str) -> str:
    # turn "<a href=...>1.1</a>" → "1.1" (drop the link, keep label)
    return ANCHOR_RE.sub(lambda m: m.group(1), md)


def split_title(md: str):
    m = re.match(r"\s*#\s+(.+?)\s*\n+", md)
    if not m:
        return None, md
    title = m.group(1).strip()
    return title, md[m.end():]


def main():
    DST.mkdir(exist_ok=True)
    for src_name, dst_name, _ in CHAPTERS:
        src = SRC / src_name
        if not src.exists():
            print(f"skip (missing): {src}")
            continue
        md = pandoc_convert(src)
        md = strip_labels_in_math(md)
        md = rewrite_figures(md)
        md = strip_cross_refs(md)
        title, body = split_title(md)
        # remove pandoc warnings if any leaked into stdout (shouldn't, they're stderr)
        body = body.strip() + "\n"
        front = "---\n"
        if title:
            front += f'title: "{title}"\n'
        front += "---\n\n"
        (DST / dst_name).write_text(front + body, encoding="utf-8")
        print(f"wrote: {dst_name}  (title={title!r})")


if __name__ == "__main__":
    main()
