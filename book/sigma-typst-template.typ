// Минимальный Tufte-inspired Typst шаблон для Сигмы.
// Узкая колонка контента + широкая правая margin для marginalia.

#let sigma(
  title: none,
  subtitle: none,
  authors: (),
  date: none,
  abstract: none,
  doc,
) = {
  set document(title: title)
  set page(
    paper: "us-letter",
    margin: (left: 1in, right: 3.2in, top: 1in, bottom: 1in),
    fill: rgb("#fffff8"),  // тёплый off-white Tufte
  )
  set text(
    font: ("Palatino", "ETbb", "Palatino Linotype", "Book Antiqua", "TeX Gyre Pagella"),
    size: 11pt,
    lang: "ru",
  )
  set par(leading: 0.65em, justify: true)

  // Headings: italic, serif, restrained
  show heading: set text(weight: "regular")
  show heading.where(level: 1): it => block(below: 1.2em, above: 1.6em)[
    #set text(size: 1.8em, weight: "regular")
    #it
  ]
  show heading.where(level: 2): it => block(below: 0.8em, above: 1.3em)[
    #set text(style: "italic", size: 1.35em)
    #it
  ]
  show heading.where(level: 3): it => block(below: 0.6em, above: 1.0em)[
    #set text(style: "italic", size: 1.1em)
    #it
  ]

  // Links
  show link: set text(fill: rgb("#a00000"))

  // Code
  show raw.where(block: true): block.with(
    fill: rgb("#f5f3e8"),
    inset: (x: 8pt, y: 6pt),
    radius: 2pt,
    width: 100%,
  )
  show raw: set text(font: ("JetBrains Mono", "DejaVu Sans Mono", "Consolas"), size: 0.9em)

  // Figure captions: italic small
  show figure.caption: it => {
    set text(style: "italic", size: 0.88em, fill: rgb("#444"))
    it
  }

  // Title page (compact)
  if title != none {
    align(left)[
      #text(size: 2.2em, weight: "regular")[#title]
      #if subtitle != none [
        \ #text(size: 1.2em, style: "italic", fill: rgb("#555"))[#subtitle]
      ]
      #if date != none [
        \ #text(size: 0.9em, fill: rgb("#777"))[#date]
      ]
    ]
    v(1.5em)
    line(length: 100%, stroke: 0.5pt + rgb("#aaa"))
    v(1em)
  }

  if abstract != none [
    #text(style: "italic", fill: rgb("#555"))[#abstract]
    #v(1em)
  ]

  doc
}
