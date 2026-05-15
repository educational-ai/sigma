#!/usr/bin/env python3
"""Convert Overleaf textbook .tex → Quarto .qmd.

Pipeline per chapter:
  1. flatten \\input{X} references inline
  2. scan source for \\label{X} and build a registry → number map
     (eq:* → (chap.eqno), fig:* → fig N, ch:* → chap title, sec:* → section number)
  3. stash custom tcolorbox envs (historybox / notebox / tasksbox) with placeholders
     — pandoc body separately so inner markdown renders properly
  4. pandoc latex → markdown (full markdown writer to preserve fenced div attrs)
  5. post-process regex:
       - <figure><embed src=X.pdf>+caption → ![](X.svg)
       - bare ref placeholders [eq:foo] / [ch:bar] → resolved numbers
       - drop pandoc anchor-link cross-refs
       - strip \\label{} inside math
  6. restore stashed callouts as proper Quarto callouts
  7. emit YAML frontmatter with title
"""
import re
import hashlib
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
SRC = HERE / "source"
DST = HERE / "converted"
FIGURES = HERE / "figures"
TIKZ_BUILD = HERE / "_tikz_build"

MAIN_CHAPTERS = [
    "preface",
    "ch01_intro",
    "ch02_newton",
    "ch03_ds",
    "ch04_numtheory",
]
CH04_INCLUDES = [
    "par1_theory",
    "par2_history",
    "par3_rsa_dh",
    "par4_applications",
    "par5_hashing",
    "par6_hyperloglog",
    "summary",
]

# Pandoc post-processing patterns
FIGURE_RE = re.compile(
    r'<figure[^>]*>\s*<embed\s+src="([^"]+)"\s*/?>\s*<figcaption>(.*?)</figcaption>\s*</figure>',
    re.DOTALL | re.IGNORECASE,
)
# Plain <embed src="X.pdf"> or <img src="X.pdf"> outside <figure> wrap — pandoc
# emits this when \includegraphics is used without surrounding figure env.
BARE_EMBED_RE = re.compile(
    r'<(?:embed|img)\s+[^>]*src="([^"]+\.pdf)"[^>]*/?>',
    re.IGNORECASE,
)
# Pandoc markdown form: ![caption](path.pdf){#fig:label width="..."}
MD_FIG_RE = re.compile(
    r'!\[(?P<cap>[^\]]*)\]\((?P<src>[^)]+\.pdf)\)(?:\{(?P<attrs>[^}]*)\})?'
)
ANCHOR_RE = re.compile(
    r'<a\s+href="#[^"]+"\s+data-reference[^>]*data-reference="([^"]+)"[^>]*>([^<]*)</a>',
    re.IGNORECASE,
)
# Pandoc may also emit refs as markdown links:
#   [text](#anchor){reference-type="ref" reference="label"}
#   or with data-reference="label"
MD_REF_LINK_RE = re.compile(
    r'\[([^\[\]\n]+)\]\(#[^)]+\)\{[^}]*\breference="([^"]+)"[^}]*\}'
)
LABEL_IN_MATH_RE = re.compile(r'\\label\{[^}]+\}')

# LaTeX env regexes (need DOTALL non-greedy)
HISTORYBOX_RE = re.compile(r'\\begin\{historybox\}(?:\[[^\]]*\])?(.*?)\\end\{historybox\}', re.DOTALL)
NOTEBOX_RE    = re.compile(r'\\begin\{notebox\}(?:\[[^\]]*\])?(.*?)\\end\{notebox\}', re.DOTALL)
TASKSBOX_RE   = re.compile(r'\\begin\{tasksbox\}(?:\[[^\]]*\])?(.*?)\\end\{tasksbox\}', re.DOTALL)
BOX_ENVS = ("historybox", "notebox", "tasksbox", "algorithmbox", "interestbox", "importantbox")
BOX_RE = {
    env: re.compile(rf'\\begin\{{{env}\}}(?P<opt>\[[^\]]*\])?(?P<body>.*?)\\end\{{{env}\}}', re.DOTALL)
    for env in BOX_ENVS
}
TIKZ_FIGURE_RE = re.compile(r'\\begin\{figure\}(?:\[[^\]]*\])?(?P<body>.*?)\\end\{figure\}', re.DOTALL)
TIKZ_PICTURE_RE = re.compile(r'\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}', re.DOTALL)

# Labels & refs
EQ_LABEL_RE = re.compile(r'\\label\{(eq:[^}]+)\}')
FIG_LABEL_RE = re.compile(r'\\label\{(fig:[^}]+)\}')
CH_LABEL_RE = re.compile(r'\\label\{(ch:[^}]+)\}')
SEC_LABEL_RE = re.compile(r'\\label\{(sec:[^}]+)\}')
TAB_LABEL_RE = re.compile(r'\\label\{(tab:[^}]+)\}')
# theorems/definitions/examples carry their label as third argument:
#   \begin{theorem}{title}{thm:xxx}…   \begin{example}{}{ex:yyy}…
THM_LABEL_RE = re.compile(r'\\begin\{theorem\}\{[^}]*\}\{(thm:[^}]+)\}')
DEF_LABEL_RE = re.compile(r'\\begin\{definition\}\{[^}]*\}\{(def:[^}]+)\}')
EX_LABEL_RE  = re.compile(r'\\begin\{example\}\{[^}]*\}\{(ex:[^}]+)\}')

# Chapter detection (we use to scope eq numbers)
CHAPTER_RE = re.compile(r'\\chapter\{([^}]+)\}')


# ---------------------------------------------------------------------------

def flatten_inputs(tex: str, base_dir: Path) -> str:
    def repl(m):
        path = m.group(1).strip()
        for p in (base_dir / path, base_dir / (path + ".tex"),
                  SRC / path, SRC / (path + ".tex")):
            if p.exists():
                return "\n" + flatten_inputs(p.read_text(encoding="utf-8"), p.parent) + "\n"
        return f"% MISSING: \\input{{{path}}}"
    return re.sub(r"\\input\{([^}]+)\}", repl, tex)


def find_matching_brace(s: str, open_pos: int) -> int:
    """Return index of the matching } for s[open_pos] == {, or -1."""
    if open_pos >= len(s) or s[open_pos] != "{":
        return -1
    depth = 0
    escaped = False
    for i in range(open_pos, len(s)):
        ch = s[i]
        if escaped:
            escaped = False
            continue
        if ch == "\\":
            escaped = True
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return i
    return -1


def extract_command_arg(tex: str, command: str, start: int = 0):
    """Extract the first braced argument after a LaTeX command.

    Returns (arg, command_start, arg_open, arg_close), or None.
    """
    pos = tex.find(command, start)
    if pos < 0:
        return None
    i = pos + len(command)
    while i < len(tex) and tex[i].isspace():
        i += 1
    if i >= len(tex) or tex[i] != "{":
        return None
    end = find_matching_brace(tex, i)
    if end < 0:
        return None
    return tex[i + 1:end], pos, i, end


def extract_option_title(opt: str | None) -> str:
    """Read title={...} from a tcolorbox optional argument."""
    if not opt:
        return ""
    m = re.search(r'\btitle\s*=\s*\{', opt)
    if not m:
        return ""
    open_pos = m.end() - 1
    close_pos = find_matching_brace(opt, open_pos)
    if close_pos < 0:
        return ""
    return opt[open_pos + 1:close_pos].strip()


def replace_one_arg_macro(tex: str, name: str, repl) -> str:
    """Replace \name{...}, preserving nested braces inside the argument."""
    needle = "\\" + name
    out = []
    i = 0
    while True:
        pos = tex.find(needle, i)
        if pos < 0:
            out.append(tex[i:])
            break
        after_name = pos + len(needle)
        if after_name < len(tex) and tex[after_name].isalpha():
            out.append(tex[i:after_name])
            i = after_name
            continue
        j = after_name
        while j < len(tex) and tex[j].isspace():
            j += 1
        if j >= len(tex) or tex[j] != "{":
            out.append(tex[i:after_name])
            i = after_name
            continue
        end = find_matching_brace(tex, j)
        if end < 0:
            out.append(tex[i:after_name])
            i = after_name
            continue
        out.append(tex[i:pos])
        out.append(repl(tex[j + 1:end]))
        i = end + 1
    return "".join(out)


ANY_LABEL_RE = re.compile(r'\\label\{([^}]+)\}')
TCB_THEOREM_LABEL_RE = re.compile(
    r'\\begin\{(theorem|definition|example|lemma|corollary)\}\{[^}]*\}\{([^}]+)\}'
)
TCB_PREFIX = {
    "theorem": "thm",
    "definition": "def",
    "example": "ex",
    "lemma": "lem",
    "corollary": "cor",
}

# Resolved refs: just the number "N.M" (source prose typically already has
# "рис.", "теор." etc. before \ref so we don't double the prefix).
PREFIX_RU = {
    "eq":   "",
    "fig":  "",
    "tab":  "",
    "sec":  "",
    "ssec": "",
    "thm":  "",
    "def":  "",
    "ex":   "",
    "lem":  "",
}


def build_label_registry(tex: str, chap_num: int) -> dict:
    """Scan every \\label{X} in source order and assign numbered references per prefix.
    Eq labels render as (chap.n); others as 'prefix chap.n'."""
    reg = {}
    counters: dict[str, int] = {}
    tcb_like = {"thm", "def", "ex", "lem", "cor"}
    # Walk the source in order, collecting BOTH \label{...} occurrences AND
    # the {label} argument of tcb-theorem-like envs, preserving source order
    # so refs render in consistent appearance order.
    iters = []
    for m in ANY_LABEL_RE.finditer(tex):
        iters.append((m.start(), m.group(1)))
    for m in TCB_THEOREM_LABEL_RE.finditer(tex):
        env, label = m.group(1), m.group(2)
        # cleveref auto-prefixes: \begin{theorem}{...}{X} → thm:X reference
        prefix = TCB_PREFIX.get(env, env[:3])
        full_label = label if ":" in label else f"{prefix}:{label}"
        iters.append((m.start(), full_label))
    iters.sort()
    for _, key in iters:
        if ":" not in key or key in reg:
            continue
        prefix = key.split(":", 1)[0]
        counter_key = "tcb" if prefix in tcb_like else prefix
        counters[counter_key] = counters.get(counter_key, 0) + 1
        n = counters[counter_key]
        if prefix == "eq":
            reg[key] = f"({chap_num}.{n})"
        else:
            reg[key] = f"{chap_num}.{n}"
    return reg


PARAGRAPH_RE = re.compile(r'\\paragraph\*?\{([^}]+)\}')


def demote_paragraphs(tex: str) -> str:
    """\\paragraph{Foo.} → \\noindent\\textbf{Foo.} so it becomes inline bold,
    not a 6th-level heading with confusing 4.1.1.0.1 numbering."""
    return PARAGRAPH_RE.sub(lambda m: r"\noindent\textbf{" + m.group(1) + "}", tex)


# --- Custom macros / theorems / examples ----------------------------------

TERM_RE = re.compile(r'\\term\{([^}]+)\}')
ENGTERM_RE = re.compile(r'\\engterm\{([^}]+)\}')
NOD_RE = re.compile(r'\\NOD\b')
EUL_RE = re.compile(r'\\Eul\b')
SIMPLE_MATH_MACROS = {
    "R": r"\\mathbb{R}",
    "N": r"\\mathbb{N}",
    "Z": r"\\mathbb{Z}",
    "eps": r"\\varepsilon",
    "argmin": r"\\operatorname*{arg\\,min}",
    "argmax": r"\\operatorname*{arg\\,max}",
}

# Theorem-like environments: \begin{ENV}{TITLE}{LABEL}...\end{ENV}
THM_RE = re.compile(
    r'\\begin\{theorem\}\{([^}]*)\}\{([^}]*)\}(.*?)\\end\{theorem\}',
    re.DOTALL,
)
DEF_RE = re.compile(
    r'\\begin\{definition\}\{([^}]*)\}\{([^}]*)\}(.*?)\\end\{definition\}',
    re.DOTALL,
)
EX_RE = re.compile(
    r'\\begin\{example\}\{([^}]*)\}\{([^}]*)\}(.*?)\\end\{example\}',
    re.DOTALL,
)
TCB_ENV_RE = re.compile(
    r'\\begin\{(theorem|definition|example)\}\{([^}]*)\}\{([^}]*)\}(.*?)\\end\{\1\}',
    re.DOTALL,
)
PROOF_RE = re.compile(r'\\begin\{proof\}(?:\[[^\]]*\])?(.*?)\\end\{proof\}', re.DOTALL)


def replace_modn(tex: str) -> str:
    r"""Replace \modn{m} and common shorthand \modn m with KaTeX-safe math."""
    out = []
    i = 0
    needle = r"\modn"
    while True:
        pos = tex.find(needle, i)
        if pos < 0:
            out.append(tex[i:])
            break
        after = pos + len(needle)
        if after < len(tex) and tex[after].isalpha():
            out.append(tex[i:after])
            i = after
            continue
        j = after
        while j < len(tex) and tex[j].isspace():
            j += 1
        arg = ""
        end = j
        if j < len(tex) and tex[j] == "{":
            close = find_matching_brace(tex, j)
            if close >= 0:
                arg = tex[j + 1:close]
                end = close + 1
        else:
            if j < len(tex) and tex[j] == "\\":
                k = j + 1
                while k < len(tex) and tex[k].isalpha():
                    k += 1
                while k < len(tex) and tex[k] in "0123456789_":
                    k += 1
                if k < len(tex) and tex[k] == "(":
                    depth = 1
                    k += 1
                    while k < len(tex) and depth:
                        if tex[k] == "(":
                            depth += 1
                        elif tex[k] == ")":
                            depth -= 1
                        k += 1
                arg = tex[j:k]
                end = k
            else:
                k = j
                while k < len(tex) and (tex[k].isalnum() or tex[k] in "_'"):
                    k += 1
                arg = tex[j:k]
                end = k
        if not arg:
            out.append(tex[i:after])
            i = after
            continue
        out.append(tex[i:pos])
        out.append(r"\,(\mathrm{mod}\," + arg + ")")
        i = end
    return "".join(out)


def normalize_macros(tex: str) -> str:
    """Replace custom textbook macros with standard LaTeX so pandoc/KaTeX render them.
    \\term{X} → \\textbf{X}; \\engterm{X} → \\textit{X};
    \\NOD → \\gcd; \\Eul → \\varphi; \\modn{n} → \\,(\\mathrm{mod}\\,n)
    """
    def flatten_textit(s: str) -> str:
        s = replace_one_arg_macro(s, "textit", lambda inner: inner)
        s = replace_one_arg_macro(s, "emph", lambda inner: inner)
        return s

    tex = replace_one_arg_macro(tex, "textit", lambda s: r"\textit{" + flatten_textit(s) + "}")
    tex = replace_one_arg_macro(tex, "emph", lambda s: r"\emph{" + flatten_textit(s) + "}")
    tex = replace_one_arg_macro(tex, "term", lambda s: r"\textbf{" + s + "}")
    tex = replace_one_arg_macro(tex, "engterm", lambda s: r"\textit{" + s + "}")
    tex = replace_one_arg_macro(tex, "norm", lambda s: r"\left\lVert " + s + r" \right\rVert")
    tex = replace_one_arg_macro(tex, "abs", lambda s: r"\left|" + s + r"\right|")
    tex = replace_one_arg_macro(tex, "Zn", lambda s: r"\mathbb{Z}_{" + s + "}")
    tex = NOD_RE.sub(r"\\gcd", tex)
    tex = EUL_RE.sub(r"\\varphi", tex)
    tex = replace_modn(tex)
    for name, replacement in SIMPLE_MATH_MACROS.items():
        tex = re.sub(rf'\\{name}(?![A-Za-z])', replacement, tex)
    return tex


def stash_callouts(tex: str, chap_num: int):
    """Replace custom envs with placeholders; return (modified_tex, stash list).
    Stash entry: (kind, body_tex, title_extra) — body needs separate pandoc pass.
    """
    stash = []
    tcb_counter = {"n": 0}

    def stash_simple(kind, fallback_title):
        def f(m):
            title = extract_option_title(m.group("opt")) or fallback_title
            stash.append((kind, m.group("body"), title))
            return f"\n\nCALLOUTSTASH{len(stash)-1}STOP\n\n"
        return f

    box_titles = {
        "historybox": "Историческая справка",
        "notebox": "Замечание",
        "tasksbox": "Задачи для самостоятельной работы",
        "algorithmbox": "Алгоритм",
        "interestbox": "Это интересно",
        "importantbox": "Важно",
    }
    for env in BOX_ENVS:
        tex = BOX_RE[env].sub(stash_simple(env, box_titles[env]), tex)
    ru_names = {
        "theorem": "Теорема",
        "definition": "Определение",
        "example": "Пример",
    }
    def stash_titled(m):
        kind = m.group(1)
        tcb_counter["n"] += 1
        n = tcb_counter["n"]
        extra_title = m.group(2).strip()
        body = m.group(4)
        label = f"{ru_names[kind]} {chap_num}.{n}" + (f". {extra_title}" if extra_title else "")
        stash.append((kind, body, label))
        return f"\n\nCALLOUTSTASH{len(stash)-1}STOP\n\n"
    tex = TCB_ENV_RE.sub(stash_titled, tex)
    # Proof env → keep inline with "Доказательство." prefix
    tex = PROOF_RE.sub(lambda m: r"\noindent\textbf{Доказательство.} " + m.group(1).strip() + r"\hfill$\square$", tex)
    return tex, stash


def pandoc_convert(tex_text: str) -> str:
    out = subprocess.run(
        ["pandoc",
         "--from=latex",
         "--to=markdown+tex_math_dollars+fenced_divs+raw_html-smart",
         "--wrap=preserve"],
        input=tex_text, check=True, capture_output=True, text=True,
    )
    return out.stdout


TIKZ_STANDALONE_PREAMBLE = r"""
\documentclass[border=4pt]{standalone}
\usepackage{polyglossia}
\setdefaultlanguage{russian}
\setotherlanguage{english}
\usepackage{fontspec}
\IfFontExistsTF{CMU Serif}{\setmainfont{CMU Serif}}{\setmainfont{Liberation Serif}}
\IfFontExistsTF{CMU Sans Serif}{\setsansfont{CMU Sans Serif}}{\setsansfont{Liberation Sans}}
\IfFontExistsTF{CMU Typewriter Text}{\setmonofont{CMU Typewriter Text}}{\setmonofont{DejaVu Sans Mono}}
\usepackage{amsmath,amssymb,mathtools,bm}
\usepackage{xcolor}
\definecolor{accent}{HTML}{1F4E79}
\definecolor{accent2}{HTML}{B85450}
\definecolor{shade}{HTML}{F4F1EA}
\colorlet{prosvBlue}{accent}
\colorlet{prosvRed}{accent2}
\colorlet{prosvLight}{accent!12}
\colorlet{prosvCream}{shade}
\definecolor{prosvGold}{HTML}{E8B647}
\definecolor{prosvGreen}{HTML}{6A9F58}
\colorlet{prosvGray}{black!55}
\usepackage{tikz}
\usetikzlibrary{calc, arrows.meta, decorations.pathreplacing,
                positioning, shapes.geometric, shapes.misc, fit,
                backgrounds}
\usepackage{pgfplots}
\pgfplotsset{compat=1.18}
\newcommand{\R}{\mathbb{R}}
\newcommand{\N}{\mathbb{N}}
\newcommand{\Z}{\mathbb{Z}}
\newcommand{\eps}{\varepsilon}
\newcommand{\norm}[1]{\left\|#1\right\|}
\newcommand{\abs}[1]{\left|#1\right|}
\newcommand{\NOD}{\gcd}
\newcommand{\Eul}{\varphi}
\newcommand{\Zn}[1]{\mathbb{Z}_{#1}}
\newcommand{\modn}[1]{\,(\mathrm{mod}\,#1)}
\newcommand{\term}[1]{\textcolor{accent2}{\textbf{#1}}}
\newcommand{\engterm}[1]{\textit{#1}}
\DeclareMathOperator*{\argmin}{arg\,min}
\DeclareMathOperator*{\argmax}{arg\,max}
\begin{document}
"""


def sanitize_fig_name(label: str) -> str:
    base = re.sub(r'[^a-zA-Z0-9_-]+', '_', label.replace("fig:", "fig_")).strip("_")
    return f"tikz_{base or 'figure'}"


def render_tikz_svg(label: str, tikz_tex: str) -> tuple[Path | None, str | None]:
    """Render an inline TikZ picture into figures/*.svg.

    Returns (svg_path, error). The content hash avoids expensive recompiles
    during hourly syncs when the figure source has not changed.
    """
    FIGURES.mkdir(exist_ok=True)
    TIKZ_BUILD.mkdir(exist_ok=True)
    name = sanitize_fig_name(label)
    tex_path = TIKZ_BUILD / f"{name}.tex"
    pdf_path = TIKZ_BUILD / f"{name}.pdf"
    svg_path = FIGURES / f"{name}.svg"
    hash_path = TIKZ_BUILD / f"{name}.sha256"
    doc = TIKZ_STANDALONE_PREAMBLE + "\n" + tikz_tex.strip() + "\n\\end{document}\n"
    digest = hashlib.sha256(doc.encode("utf-8")).hexdigest()
    if svg_path.exists() and hash_path.exists() and hash_path.read_text(encoding="utf-8").strip() == digest:
        return svg_path, None
    tex_path.write_text(doc, encoding="utf-8")
    try:
        subprocess.run(
            ["xelatex", "-interaction=nonstopmode", "-halt-on-error", tex_path.name],
            cwd=TIKZ_BUILD,
            check=True,
            capture_output=True,
            text=True,
            timeout=120,
        )
        subprocess.run(
            ["pdftocairo", "-svg", str(pdf_path), str(svg_path)],
            check=True,
            capture_output=True,
            text=True,
            timeout=60,
        )
        hash_path.write_text(digest + "\n", encoding="utf-8")
        return svg_path, None
    except subprocess.CalledProcessError as e:
        log = (e.stdout or "") + "\n" + (e.stderr or "")
        return None, log[-2000:]
    except subprocess.TimeoutExpired as e:
        return None, f"timeout while rendering {label}: {e}"


def caption_to_markdown(caption_tex: str) -> str:
    caption_tex = normalize_macros(caption_tex)
    try:
        return pandoc_convert(caption_tex).strip()
    except Exception:
        return caption_tex.strip()


def stash_tikz_figures(tex: str):
    """Render figure environments with inline tikzpicture and stash them."""
    stash = []

    def repl(m):
        fig = m.group(0)
        body = m.group("body")
        if not TIKZ_PICTURE_RE.search(body):
            return fig
        label_m = re.search(r'\\label\{(fig:[^}]+)\}', fig)
        label = label_m.group(1) if label_m else f"fig:tikz-{len(stash)+1}"
        cap_info = extract_command_arg(fig, r"\caption")
        caption = cap_info[0].strip() if cap_info else label
        tikz = TIKZ_PICTURE_RE.search(body).group(0)
        svg, error = render_tikz_svg(label, tikz)
        stash.append((label, caption, svg, error))
        return f"\n\nTIKZFIGSTASH{len(stash)-1}STOP\n\n"

    return TIKZ_FIGURE_RE.sub(repl, tex), stash


def caption_for_label(label: str, caption: str, registry: dict) -> str:
    num = registry.get(label)
    if num and label.startswith("fig:") and not caption.lstrip().startswith("Рис."):
        return f"Рис. {num}. {caption}"
    return caption


def markdown_image(src: str, caption: str) -> str:
    caption = re.sub(r"\s+", " ", caption).strip()
    # Escape only markdown image delimiters outside math would be ideal; in
    # practice captions here rarely contain literal square brackets, and
    # preserving math such as $[0,1]$ matters more.
    caption = caption.replace("\n", " ")
    return f"![{caption}]({src})"


def restore_tikz_figures(md: str, stash: list, registry: dict) -> str:
    def repl(m):
        idx = int(m.group(1))
        label, caption_tex, svg, error = stash[idx]
        caption_md = caption_for_label(label, caption_to_markdown(caption_tex), registry)
        if svg:
            return f"\n\n{markdown_image('/figures/' + svg.name, caption_md)}\n\n"
        msg = f"Рисунок `{label}` не сгенерирован"
        if error:
            msg += f": `{error.splitlines()[-1][:160]}`"
        return f"\n\n::: {{.callout-warning title=\"Рисунок\"}}\n{msg}\n:::\n\n*{caption_md}*\n\n"
    return re.sub(r'TIKZFIGSTASH(\d+)STOP', repl, md)


def restore_callouts(md: str, stash: list) -> str:
    """Replace CALLOUTSTASH{i}STOP placeholders with proper Quarto callouts."""
    type_map = {
        "historybox": ("tip",       "Историческая справка"),
        "notebox":    ("note",      "Замечание"),
        "tasksbox":   ("important", "Задачи для самостоятельной работы"),
        "algorithmbox":("important", "Алгоритм"),
        "interestbox": ("tip",       "Это интересно"),
        "importantbox":("caution",   "Важно"),
        "theorem":    ("warning",   None),   # title set from stash extra
        "definition": ("note",      None),
        "example":    ("tip",       None),
    }
    def repl(m):
        idx = int(m.group(1))
        kind, body_tex, title_extra = stash[idx]
        callout_type, fallback_title = type_map[kind]
        title_tex = title_extra or fallback_title or kind.capitalize()
        title = caption_to_markdown(title_tex).replace("\n", " ")
        title = title.replace('"', '\\"')
        body_md = pandoc_convert(body_tex).strip()
        return (
            f'\n\n::: {{.callout-{callout_type} title="{title}" collapse="false"}}\n'
            f'{body_md}\n'
            f':::\n\n'
        )
    return re.sub(r'CALLOUTSTASH(\d+)STOP', repl, md)


def strip_labels_in_math(md: str, registry: dict) -> str:
    """Replace \\label{eq:foo} inside display math with a KaTeX-renderable \\tag{(N.M)}.
    KaTeX supports \\tag{X} to display equation numbers; we use the same labels
    the prose refers to, so equation displays and inline refs stay consistent.
    """
    def repl_block(m):
        body = m.group(1)
        eq_labels = re.findall(r'\\label\{(eq:[^}]+)\}', body)
        if len(eq_labels) > 1:
            body = re.sub(r'\\label\{eq:[^}]+\}', "", body)
            body = LABEL_IN_MATH_RE.sub("", body)
            return f"$${body}$$"
        def label_to_tag(lm):
            key = lm.group(1)
            tag = registry.get(key)
            if tag:
                # registry stores eq refs as "(N.M)" — strip parens for \tag arg
                t = tag.strip("()") if tag.startswith("(") else tag
                return r"\tag{" + t + "}"
            return ""
        body = re.sub(r'\\label\{(eq:[^}]+)\}', label_to_tag, body)
        # any other labels inside math → strip
        body = LABEL_IN_MATH_RE.sub("", body)
        return f"$${body}$$"
    return re.sub(r"\$\$([\s\S]+?)\$\$", repl_block, md)


def rewrite_figures(md: str, registry: dict) -> str:
    def repl_fig(m):
        src = m.group(1)
        caption_html = m.group(2).strip()
        id_m = re.search(r'<figure[^>]*\bid="([^"]+)"', m.group(0), re.IGNORECASE)
        label = id_m.group(1) if id_m else ""
        caption = re.sub(r"<[^>]+>", "", caption_html)
        caption = re.sub(r"\s+", " ", caption).strip()
        name = Path(src).stem
        svg = f"/figures/{name}.svg"
        caption = caption_for_label(label, caption, registry)
        return markdown_image(svg, caption)
    md = FIGURE_RE.sub(repl_fig, md)

    def repl_md(m):
        cap = re.sub(r"\s+", " ", m.group("cap")).strip()
        src = m.group("src")
        name = Path(src).stem
        attrs = m.group("attrs") or ""
        label_m = re.search(r'#(fig:[A-Za-z0-9_:\-]+)', attrs)
        label = label_m.group(1) if label_m else ""
        cap = caption_for_label(label, cap, registry)
        return markdown_image(f"/figures/{name}.svg", cap)
    md = MD_FIG_RE.sub(repl_md, md)

    def repl_bare(m):
        src = m.group(1)
        name = Path(src).stem
        return f'![](/figures/{name}.svg)'
    md = BARE_EMBED_RE.sub(repl_bare, md)
    return md


def strip_cross_refs(md: str, registry: dict, global_refs: dict) -> str:
    """Resolve pandoc anchor/markdown refs to numbered labels from our registry.
    Form A: <a href="#X" data-reference="LABEL">pandoc_number</a>
    Form B: [pandoc_number](#X){data-reference="LABEL"}
    For both, replace with registry[LABEL] if known; else keep inner text.
    """
    merged = {**global_refs, **registry}
    def repl_html(m):
        label = m.group(1)
        return merged.get(label, m.group(2))
    def repl_md(m):
        label = m.group(2)
        return merged.get(label, m.group(1))
    md = ANCHOR_RE.sub(repl_html, md)
    md = MD_REF_LINK_RE.sub(repl_md, md)
    return md


_REF_PREFIXES = r'(?:eq|fig|tab|sec|ssec|ch|thm|def|ex|lem|cor)'
PANDOC_REF_RE = re.compile(
    rf'\[\\\[({_REF_PREFIXES}:[^\\\]]+)\\\]\]\(#[^)]+\)(?:\{{[^}}]*\}})?'
)
BARE_REF_RE = re.compile(rf'\[({_REF_PREFIXES}:[a-zA-Z0-9_:\-]+)\]')


def resolve_bare_refs(md: str, registry: dict, global_chapters: dict) -> str:
    """Replace pandoc-emitted cross-refs and any leftover bare [label] with resolved labels."""
    merged = {**global_chapters, **registry}
    def repl(m):
        key = m.group(1)
        return merged.get(key, m.group(0))
    md = PANDOC_REF_RE.sub(repl, md)
    md = BARE_REF_RE.sub(repl, md)
    return md


HEADING_ID_RE = re.compile(r'\s*\{#[^}]+\}\s*$')


def clean_title(title: str) -> str:
    """Drop pandoc-emitted `{#anchor}` suffix and `.unnumbered` class from title text."""
    return HEADING_ID_RE.sub("", title).strip()


def extract_title(md: str):
    m = re.match(r"\s*#\s+(.+?)\s*\n+", md)
    if m:
        return m.group(1).strip(), md[m.end():]
    return None, md


def blockify_display_math(md: str) -> str:
    """Make display math standalone blocks for Quarto's markdown parser."""
    lines = md.splitlines()
    out = []
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("$$") and out and out[-1].strip():
            out.append("")
        out.append(line)
        if stripped.endswith("$$") and i + 1 < len(lines) and lines[i + 1].strip():
            out.append("")
    return "\n".join(out) + ("\n" if md.endswith("\n") else "")


def convert_one(tex_text: str, base_dir: Path, chap_num: int, global_ch_refs: dict) -> tuple[str, str]:
    flat = flatten_inputs(tex_text, base_dir)
    registry = build_label_registry(flat, chap_num)
    flat, tikz_stash = stash_tikz_figures(flat)
    flat = normalize_macros(flat)
    flat = demote_paragraphs(flat)
    stashed, stash = stash_callouts(flat, chap_num)
    md = pandoc_convert(stashed)
    md = restore_callouts(md, stash)
    md = restore_tikz_figures(md, tikz_stash, registry)
    md = strip_labels_in_math(md, registry)
    md = rewrite_figures(md, registry)
    md = strip_cross_refs(md, registry, global_ch_refs)
    md = resolve_bare_refs(md, registry, global_ch_refs)
    md = blockify_display_math(md)
    title, body = extract_title(md)
    if title:
        title = clean_title(title)
    return title, body.strip() + "\n"


def write_qmd(name: str, title: str | None, body: str, out_dir: Path = DST, unnumbered: bool = False):
    out_dir.mkdir(exist_ok=True)
    front = "---\n"
    if title:
        t = title.replace('"', '\\"')
        front += f'title: "{t}"\n'
    if unnumbered:
        # Keep section numbering off for the frontmatter page.
        front += "number-sections: false\nformat:\n  html:\n    number-sections: false\n"
    front += "---\n\n"
    body_out = body
    # For unnumbered chapters Quarto renders the frontmatter title itself;
    # adding an explicit H1 produces a duplicated visible heading.
    (out_dir / f"{name}.qmd").write_text(front + body_out, encoding="utf-8")


def collect_chapter_refs(chapter_numbers: dict[str, int]) -> dict:
    """First pass: scan all chapters for \\label{ch:*} to build cross-chapter map."""
    refs = {}
    for i, chap in enumerate(MAIN_CHAPTERS, start=1):
        files = [SRC / "chapters" / f"{chap}.tex"]
        for p in files:
            if not p.exists(): continue
            txt = p.read_text(encoding="utf-8")
            chap_label = CH_LABEL_RE.search(txt)
            if chap_label:
                refs[chap_label.group(1)] = str(chapter_numbers.get(chap, i))
    return refs


def main():
    DST.mkdir(exist_ok=True)
    # Numbering matches Quarto book sidebar: position in chapters list + 1
    # (index.qmd is position 0 → "1", preface "2", ch01_intro "3", etc).
    # We mirror Quarto so eq/fig refs in chapter N appear as "N.X" matching its H1.
    QUARTO_POS = {"preface": 2, "ch01_intro": 3, "ch02_newton": 4, "ch03_ds": 5, "ch04_numtheory": 6}
    global_ch_refs = collect_chapter_refs(QUARTO_POS)
    for chap in MAIN_CHAPTERS:
        unnumbered = (chap == "preface")
        chap_num = QUARTO_POS.get(chap, 0)
        p = SRC / "chapters" / f"{chap}.tex"
        if not p.exists():
            print(f"skip (missing): {p}", file=sys.stderr)
            continue
        title, body = convert_one(p.read_text(encoding="utf-8"), SRC / "chapters", chap_num, global_ch_refs)
        write_qmd(chap, title, body, unnumbered=unnumbered)
        print(f"wrote: {chap}.qmd  (n={chap_num} title={title!r})")


if __name__ == "__main__":
    main()
