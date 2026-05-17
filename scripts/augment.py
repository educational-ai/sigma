#!/usr/bin/env python3
"""Локальные augmentations поверх .qmd, сгенерённых tex_to_qmd.py.

Конфиг:
  dop/augments/_global.yml         — правила для всех .qmd
  dop/augments/<basename>.yml      — per-chapter overrides

Поддерживаемые правила (см. _global.yml):
  callouts_in_margin_by_title — добавить .column-margin вокруг callout
  equation_page_if_chars_gt   — длинные display equations → ::: {.column-page}
  figure_page_if_attr_width_gt — figures с width >= X → ::: {.column-page}

Per-chapter правила (YAML список патчей):
  - target: { type: equation|figure|section, label?: str, id?: str, n?: int }
    wrap: column-page | column-margin
    inject_after: "raw markdown"
"""
from __future__ import annotations
import argparse
import re
import sys
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parent.parent
DOP = REPO / "book"
AUG = DOP / "augments"


# ---------------------------------------------------------------------------
# Загрузка конфигов
# ---------------------------------------------------------------------------
def load_yaml(path: Path) -> dict:
    if not path.exists():
        return {}
    return yaml.safe_load(path.read_text(encoding="utf-8")) or {}


def load_rules_for(stem: str) -> tuple[dict, list[dict]]:
    g = load_yaml(AUG / "_global.yml")
    per_chap = load_yaml(AUG / f"{stem}.yml")
    patches = per_chap if isinstance(per_chap, list) else per_chap.get("patches", [])
    return g, patches


# ---------------------------------------------------------------------------
# Глобальные правила
# ---------------------------------------------------------------------------
CALLOUT_RE = re.compile(
    r'(?P<full>::: \{\.callout-\w+(?:\s+[^}]*)?\}\n(?:.*\n)*?:::)',
    re.MULTILINE,
)


def reorder_margin_around_figures(md: str, threshold_chars: int = 350) -> str:
    """Тяжёлый column-margin (> threshold), стоящий ПЕРЕД ближайшей figure
    в той же секции, переносится ПОСЛЕ этой figure. Это даёт caption жёсткий
    приоритет в margin-колонке; callout уезжает ниже, не обрываясь.

    Алгоритм: построчно, считаем глубину ::: чтобы корректно проходить
    вложенные callout. Ищем ближайший `![image](...)` после блока, при условии
    что до него нет другого `column-margin` или `## sec heading`.
    """
    lines = md.split("\n")
    n = len(lines)
    out_lines = []
    i = 0
    while i < n:
        line = lines[i]
        if line.strip() == "::: {.column-margin}":
            depth = 1
            j = i + 1
            while j < n and depth > 0:
                ls = lines[j].strip()
                if ls.startswith("::: {.") or ls.startswith("::: {"):
                    depth += 1
                elif ls == ":::":
                    depth -= 1
                j += 1
            # column-margin = lines[i..j-1] включая закрывающий :::
            block = "\n".join(lines[i:j])
            body_chars = len(re.sub(r'[\s\W]', '', block))
            # Ищем ближайший image. Останавливаемся если встретим
            # новый column-margin (он сам "займёт" свою figure), heading,
            # или конец секции.
            target_image_idx = -1
            for k in range(j, n):
                lk = lines[k].lstrip()
                if lk.startswith("## ") or lk.startswith("# "):
                    break
                if lk.startswith("::: {.column-margin}"):
                    break
                if lk.startswith("!["):
                    target_image_idx = k
                    break
            if target_image_idx >= 0 and body_chars >= threshold_chars:
                # копируем всё, что между блоком и image, ПЕРЕД image, затем image, затем блок
                between = lines[j:target_image_idx]
                image_line = lines[target_image_idx]
                out_lines.extend(between)
                out_lines.append(image_line)
                out_lines.append("")
                out_lines.append(block)
                i = target_image_idx + 1
                continue
            out_lines.append(block)
            i = j
            continue
        out_lines.append(line)
        i += 1
    return "\n".join(out_lines)


def apply_global(md: str, rules: dict) -> str:
    titles = set(rules.get("callouts_in_margin_by_title") or [])
    eq_threshold = rules.get("equation_page_if_chars_gt") or 0
    fig_width_threshold = rules.get("figure_page_if_attr_width_gt") or 1.1

    # 0) убираем \boxed{...} — typst+mitex рендерит криво (символы сжимаются).
    #    Берём только содержимое, без рамки. Поддерживает вложенные скобки.
    def strip_boxed(text: str) -> str:
        out = []
        i = 0
        while i < len(text):
            j = text.find("\\boxed{", i)
            if j < 0:
                out.append(text[i:])
                break
            out.append(text[i:j])
            depth = 1
            k = j + 7
            while k < len(text) and depth > 0:
                if text[k] == "{":
                    depth += 1
                elif text[k] == "}":
                    depth -= 1
                k += 1
            # j+7..k-1 = содержимое без \boxed{ }
            inner = text[j + 7:k - 1]
            out.append(inner)
            i = k
        return "".join(out)
    md = strip_boxed(md)

    # 1) callouts → margin: по title из whitelist ИЛИ если короткий (< N симв)
    short_thresh = rules.get("callout_to_margin_if_chars_lt") or 0
    exclude_prefixes = tuple(rules.get("callout_margin_exclude_title_prefixes") or [])
    if titles or short_thresh > 0:
        def is_already_wrapped(start: int) -> bool:
            """Проверяем — обёрнут ли callout уже в column-margin."""
            preceding = md[max(0, start - 200):start]
            if "::: {.column-margin}" not in preceding:
                return False
            opens = preceding.count("::: {.column-margin}")
            closes_after_last = preceding.rsplit("::: {.column-margin}", 1)[1].count(":::\n")
            return opens > closes_after_last

        def wrap_callout(m: re.Match) -> str:
            block = m.group("full")
            title_m = re.search(r'title="([^"]+)"', block)
            this_title = title_m.group(1) if title_m else None
            body = block.split("\n", 1)[1] if "\n" in block else ""
            header = block.split("\n")[0]
            is_short_kind = ("callout-tip" in header) or ("callout-note" in header)
            by_title = this_title in titles if this_title else False
            # length-based, но с исключением смысловых блоков по prefix
            excluded = this_title and any(this_title.startswith(p) for p in exclude_prefixes)
            by_length = (
                short_thresh > 0 and is_short_kind and len(body) < short_thresh and not excluded
            )
            if not (by_title or by_length):
                return block
            if is_already_wrapped(m.start()):
                return block
            return f"::: {{.column-margin}}\n{block}\n:::"
        md = CALLOUT_RE.sub(wrap_callout, md)

    # 2) длинные display equations → column-page
    if eq_threshold > 0:
        def maybe_widen_eq(m: re.Match) -> str:
            body = m.group(1)
            if len(body) < eq_threshold:
                return m.group(0)
            return f"\n::: {{.column-page}}\n$$\n{body}\n$$\n:::\n"
        md = re.sub(
            r'\n\$\$\n([\s\S]+?)\n\$\$\n',
            maybe_widen_eq,
            md,
        )

    # 3) large figures → column-page (на основе markdown image attrs)
    def maybe_widen_fig(m: re.Match) -> str:
        attrs = m.group("attrs") or ""
        wm = re.search(r'width="([^"\\]+)"', attrs)
        if not wm:
            return m.group(0)
        try:
            val = wm.group(1)
            if val.endswith("\\linewidth"):
                w = float(val.replace("\\linewidth", "").strip() or "1")
            elif val.endswith("%"):
                w = float(val[:-1]) / 100
            else:
                return m.group(0)
        except ValueError:
            return m.group(0)
        if w >= fig_width_threshold:
            return f"\n::: {{.column-page}}\n{m.group(0).strip()}\n:::\n"
        return m.group(0)

    md = re.sub(
        r'!\[(?P<cap>[^\]]*?)\]\((?P<src>[^)]+)\)\{(?P<attrs>[^}]*)\}',
        maybe_widen_fig,
        md,
    )

    return md


# ---------------------------------------------------------------------------
# Per-chapter патчи
# ---------------------------------------------------------------------------
def apply_patches(md: str, patches: list[dict]) -> str:
    for p in patches:
        target = p.get("target") or {}
        ttype = target.get("type")
        label = target.get("label") or target.get("id")
        if ttype == "equation" and label:
            # ищем display equation сразу после `\label{label}` или с #id
            pattern = (
                rf'(\n\$\$[\s\S]+?\\label\{{{re.escape(label)}\}}[\s\S]+?\$\$\n)'
            )
            m = re.search(pattern, md)
            if m and "wrap" in p:
                replacement = f"\n::: {{.{p['wrap']}}}\n{m.group(1).strip()}\n:::\n"
                md = md.replace(m.group(0), replacement)

        elif ttype == "figure" and label:
            # markdown figure ![](path){#fig:label ...}
            pattern = rf'(!\[[^\]]*\]\([^)]+\)\{{[^}}]*#{re.escape(label)}[^}}]*\}})'
            m = re.search(pattern, md)
            if m and "wrap" in p:
                md = md.replace(m.group(1),
                                f"\n::: {{.{p['wrap']}}}\n{m.group(1)}\n:::\n")

        elif ttype == "section" and label:
            # Header ## ... {#sec:label}
            pattern = rf'(^#{{1,6}} [^\n]+\{{[^}}]*#{re.escape(label)}[^}}]*\}}\n)'
            m = re.search(pattern, md, re.MULTILINE)
            if m and "inject_after" in p:
                md = md.replace(m.group(1), m.group(1) + "\n" + p["inject_after"] + "\n")
    return md


# ---------------------------------------------------------------------------
def process_file(qmd_path: Path) -> bool:
    rules, patches = load_rules_for(qmd_path.stem)
    if not rules and not patches:
        return False
    text = qmd_path.read_text(encoding="utf-8")
    new = apply_global(text, rules)
    # Caption приоритет: длинные margin-callouts ПЕРЕД figure → переносим ПОСЛЕ
    # figure. Так figure caption встаёт в верхнюю часть margin, не отрываясь.
    new = reorder_margin_around_figures(new, threshold_chars=250)
    new = apply_patches(new, patches)
    if new != text:
        qmd_path.write_text(new, encoding="utf-8")
        return True
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="*", help="qmd files to augment; default: dop/*.qmd")
    args = ap.parse_args()
    files = [Path(f) for f in args.files] if args.files else sorted(DOP.glob("*.qmd"))
    changed = 0
    for f in files:
        if process_file(f):
            changed += 1
            print(f"  augmented: {f.name}")
    print(f"augment.py: {changed} file(s) changed")


if __name__ == "__main__":
    main()
