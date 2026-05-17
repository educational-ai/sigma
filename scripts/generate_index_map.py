#!/usr/bin/env python3
r"""Автогенерация карты глав в dop/index.qmd из overleaf_export/.

Источник истины: main.tex (порядок \part + \input{chapters/X}).
Для каждой главы извлекаются \chapter{Title} и \section{Title}
(включая секции, подгружаемые из \input'ов внутри главы).

Опциональная мета (статус готовности, подпись) — из dop/index_meta.json:
  {
    "ch01_intro":  {"status": 1, "meta": "стаб · 30 строк .tex"},
    "ch_linalg":   {"status": 2, "meta": "новая · SVD · eigenfaces"}
  }

Если файла нет — все главы помечаются статусом 2 (AI-черновик) без подписи.
В dop/index.qmd карта вставляется между маркерами:
  <!-- CHAPTERS:START -->
  ... сгенерённый блок ...
  <!-- CHAPTERS:END -->
"""
from __future__ import annotations
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MAIN_TEX = REPO / "overleaf_export" / "main.tex"
CH_DIR = REPO / "overleaf_export" / "chapters"
INDEX_QMD = REPO / "book" / "index.qmd"
META_JSON = REPO / "book" / "index_meta.json"

START_MARK = "<!-- CHAPTERS:START -->"
END_MARK = "<!-- CHAPTERS:END -->"


def strip_tex(s: str) -> str:
    """Минимальная очистка LaTeX от макросов для отображения в HTML."""
    s = re.sub(r"\\texorpdfstring\{([^}]*)\}\{([^}]*)\}", r"\2", s)
    s = re.sub(r"\\(emph|textbf|textit|term|engterm)\{([^}]*)\}", r"\2", s)
    s = re.sub(r"\\\\", " ", s)
    s = re.sub(r"\$[^$]*\$", "", s)
    s = re.sub(r"\\[a-zA-Z]+\*?", "", s)
    s = s.replace("{", "").replace("}", "")
    s = re.sub(r"\s+", " ", s).strip()
    return s


def read_with_inputs(path: Path, depth: int = 0) -> str:
    """Читает .tex, рекурсивно разворачивая \\input{...}."""
    if depth > 6 or not path.exists():
        return ""
    text = path.read_text(encoding="utf-8")

    def repl(m: re.Match) -> str:
        target = m.group(1)
        for cand in [
            CH_DIR / f"{target}.tex",
            CH_DIR / target,
            REPO / "overleaf_export" / f"{target}.tex",
            REPO / "overleaf_export" / target,
        ]:
            if cand.exists():
                return "\n" + read_with_inputs(cand, depth + 1) + "\n"
        return ""

    return re.sub(r"\\input\{([^}]+)\}", repl, text)


def parse_main_tex() -> list[tuple[str, list[str]]]:
    r"""Возвращает [(part_title, [chapter_input_basename, ...]), ...]
    в порядке, в котором они встречаются в main.tex.
    Игнорирует \part'ы до \mainmatter.
    """
    text = MAIN_TEX.read_text(encoding="utf-8")
    after = text.split("\\mainmatter", 1)
    body = after[1] if len(after) > 1 else text
    parts: list[tuple[str, list[str]]] = []
    current: tuple[str, list[str]] | None = None
    pattern = re.compile(r"\\(part|input)\{([^}]+)\}")
    for m in pattern.finditer(body):
        kind, arg = m.group(1), m.group(2)
        if kind == "part":
            if current:
                parts.append(current)
            current = (strip_tex(arg), [])
        elif kind == "input" and current is not None:
            base = Path(arg).name
            if base.startswith("ch"):
                current[1].append(base)
    if current:
        parts.append(current)
    return parts


def parse_chapter(stem: str) -> tuple[str, list[str]] | None:
    """(chapter_title, [section_title, ...]) или None если не найдено."""
    candidates = [CH_DIR / f"{stem}.tex"]
    if not stem.endswith(".tex"):
        candidates.append(CH_DIR / stem)
    chap_path: Path | None = next((p for p in candidates if p.exists()), None)
    if chap_path is None:
        return None
    tex = read_with_inputs(chap_path)
    chap_match = re.search(r"\\chapter\{([^}]+)\}", tex)
    if not chap_match:
        return None
    chap = strip_tex(chap_match.group(1))
    sections = [strip_tex(m.group(1))
                for m in re.finditer(r"(?m)^\\section\{([^}]+)\}", tex)]
    return chap, sections


def load_meta() -> dict:
    if META_JSON.exists():
        return json.loads(META_JSON.read_text(encoding="utf-8"))
    return {}


def render(parts: list[tuple[str, list[str]]], meta: dict) -> str:
    out = ["", "```{=html}", "<div class=\"hm-legend\">",
           "  <span class=\"hm-pill hm-0\">0 · Пусто</span>",
           "  <span class=\"hm-pill hm-1\">1 · Есть ответственный</span>",
           "  <span class=\"hm-pill hm-2\">2 · AI-черновик</span>",
           "  <span class=\"hm-pill hm-3\">3 · Вычитано 1 раз</span>",
           "  <span class=\"hm-pill hm-4\">4 · Вычитано оракулом</span>",
           "  <span class=\"hm-pill hm-5\">5 · Финал</span>",
           "</div>", ""]
    chap_idx = 0
    for part_title, inputs in parts:
        if part_title:
            out.append(f"<h3 class=\"hm-part-title\">{part_title}</h3>")
        for stem in inputs:
            base = stem[:-4] if stem.endswith(".tex") else stem
            parsed = parse_chapter(base)
            if not parsed:
                continue
            chap_idx += 1
            chap_title, sections = parsed
            m = meta.get(base, {})
            status = int(m.get("status", 2))
            meta_text = m.get("meta", "")
            href = f"{base}.html"
            out.append("<div class=\"hm-chapter\">")
            out.append(f"  <a class=\"hm-chapter-head hm-{status}\" href=\"{href}\">")
            out.append(f"    <span class=\"hm-chapter-num\">Гл {chap_idx}.</span>")
            out.append(f"    <span class=\"hm-chapter-title\">{chap_title}</span>")
            if meta_text:
                out.append(f"    <span class=\"hm-meta\">{meta_text}</span>")
            out.append("  </a>")
            if sections:
                out.append("  <div class=\"hm-sub-grid\">")
                for i, s in enumerate(sections, 1):
                    out.append(
                        f"    <div class=\"hm-sub-cell hm-{status}\">"
                        f"{chap_idx}.{i} {s}</div>"
                    )
                out.append("  </div>")
            out.append("</div>")
            out.append("")
    out.append("```")
    return "\n".join(out)


def update_index(rendered: str) -> bool:
    text = INDEX_QMD.read_text(encoding="utf-8")
    if START_MARK not in text or END_MARK not in text:
        print(f"  ⚠ markers {START_MARK} / {END_MARK} not in {INDEX_QMD}",
              file=sys.stderr)
        return False
    pre, rest = text.split(START_MARK, 1)
    _, post = rest.split(END_MARK, 1)
    new = f"{pre}{START_MARK}\n{rendered}\n{END_MARK}{post}"
    if new != text:
        INDEX_QMD.write_text(new, encoding="utf-8")
        return True
    return False


def main():
    parts = parse_main_tex()
    meta = load_meta()
    rendered = render(parts, meta)
    changed = update_index(rendered)
    n_chap = sum(len(inputs) for _, inputs in parts)
    print(f"  chapters detected: {n_chap}; "
          f"{'updated' if changed else 'no changes'} {INDEX_QMD}")


if __name__ == "__main__":
    main()
