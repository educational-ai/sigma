# Сигма — свод правил работы с проектом

**Этот файл — жёсткий doctrine, а не рекомендация. Игнорировать его правила нельзя.**

## Архитектура (что НЕЛЬЗЯ нарушать)

### 1. Overleaf — единственный источник истины

- `overleaf_export/` — read-only зеркало проекта в Overleaf.
- НИКОГДА не редактируй `overleaf_export/*.tex` напрямую. Никаких прицельных правок «вот тут поменяй слово». Все изменения содержания делает автор в Overleaf, а мы их забираем синком.
- Если что-то нужно поправить в самом тексте (опечатка, перенос, формула) — это задача автора, и она решается в Overleaf. Мы можем подсказать словами, но не править `.tex` локально.

### 2. Все наши правки — это патчи, а не диффы по PDF

Контент конвертируется по конвейеру:

```
overleaf_export/*.tex
   │  scripts/tex_to_qmd.py        (LaTeX → Quarto markdown)
   ▼
book/*.qmd
   │  scripts/augment.py           (наши патчи: column-margin, column-page, …)
   ▼
book/*.qmd  (augmented)
   │  scripts/split_chapters.py + scripts/fix_code_blocks.py
   ▼
quarto render --to html          → docs/*.html
quarto render --to tufte-inspired-typst  → docs/*.pdf
```

- Любая логика правок ВСЕГДА живёт в `scripts/augment.py` + `book/augments/*.yml`.
- Запрещено: вручную править `book/*.qmd`, а потом гонять `quarto render`. Это сразу будет затёрто следующим запуском пайплайна.
- Запрещено: править `docs/*.html` или `docs/*.pdf`. Эти файлы — артефакты сборки.

### 3. Визуальное оформление — только в шаблоне или CSS, не в .qmd

Если что-то выглядит неправильно во ВСЕХ главах или в шаблоне Tufte:

- HTML — правится в `book/sigma-tufte.css` (Tufte-стили) или `book/mobile-safe.css` (мобильный fallback).
- Typst PDF — правится в `book/_extensions/fredguth/tufte-inspired/typst-template.typ` (геометрия страницы, заголовки, figure-caption) или `typst-show.typ` (show-rules верхнего уровня) или `tufte-inspired.lua` (mapping Pandoc → typst).

Если правится одна страница одной главы — это симптом того, что pipeline проектируется неправильно. Никаких «давайте на этой странице поправим вручную».

## Процесс изменений (что обязательно делать)

### 4. Каждое изменение конфигурации/скрипта → обязательная визуальная верификация

Не «я думаю, должно работать», а:

1. Прогнать пайплайн до конца: `scripts/build.sh` (или прицельный `quarto render`).
2. Открыть **обе сборки**: HTML (через `curl https://sigma.fmin.xyz/...` или `pdftoppm` + Read) и PDF (`pdftoppm -r 130 docs/chXX.pdf /tmp/.../`).
3. **Просмотреть каждую страницу обеих сборок руками, в hi-res.** Не «прокликать по диагонали». Минимум 100 DPI, hi-res — 150+ DPI. Использовать инструмент Read для каждого PNG.
4. Если хоть одна страница сломана — это не «известный хвост», это блокер. Чинить пайплайн, не отдельную страницу.
5. Сверка должна быть и на HTML (мобильная ширина + десктоп) и на PDF (typst per-chapter).

**Без визуальной верификации не отчитываемся «готово».** Если устал — лучше сказать «прошёл столько-то страниц, надо доделать», чем закрыть таску формально.

### 5. Подписи к рисункам — жёсткий приоритет в маргиналиях

Caption всегда тяготеет к вертикальному центру картинки. Прочие margin-callout-ы должны помещаться либо до, либо после, но НЕ обрываться. Если очень длинный callout не помещается рядом с figure:

- сначала пробуем уменьшить шрифт callout-а (см. `tufte-inspired.lua`, `#set text(size: 7.5pt)`)
- если всё равно не лезет — каскадно через `safe-dy` в `typst-show.typ`: caption уходит чуть ниже центра, но не выше предыдущего descent

Никаких ad-hoc правок «здесь сдвинул, тут подвинул».

### 6. Marrjines не обрываются

`margin-note` от drafting'а не умеет переноситься через page break. Поэтому:

- если callout больше пол-страницы по высоте — это уже сигнал разбить его в источнике (а это значит — сказать автору и подождать пока перепишет в Overleaf, либо в `augment.py` написать heuristic split, но осторожно).
- НЕ переносить тяжёлый callout автоматически на bottom-half страницы (там он гарантированно обрежется).

### 7. Никакого изоляционизма: HTML и PDF идут вместе

Любое изменение в pipeline должно работать в обеих ветках сборки. Нельзя «починили в HTML, в PDF не проверили».

## Что чем правится (cheatsheet)

| Симптом | Слой |
|---|---|
| Длинный TG-callout срезан в margin PDF | `tufte-inspired.lua` (font size), `typst-show.typ` (safe-dy) |
| Caption под картинкой, не в margin | `typst-show.typ` `#show figure.where(kind: "quarto-float-fig")` |
| Картинка съезжает в маргин справа | `scale(85%, it.body, reflow: true)` в `typst-show.typ` |
| Формула вылазит за viewport на мобиле | `book/mobile-safe.css` `.katex-display { overflow-x: auto }` |
| Sidebar TOC обрывается на телефоне | `book/sigma-tufte.css` `.sidebar-link { white-space: normal }` |
| `sequence(styled(...))` вместо кода | `typst-template.typ` `#let Skylighting(body, ..rest)` (итерирует строки) |
| Кросс-ссылка `??` на figure | `typst-show.typ` `\refstepcounter` вне `marginnote` |
| Должны переехать callout-ы в margin | `scripts/augment.py` + `book/augments/_global.yml` (`callouts_in_margin_by_title`, `callout_to_margin_if_chars_lt`, `callout_margin_exclude_title_prefixes`) |
| Длинная формула не помещается в margin column | пока не починено архитектурно; правка в исходнике автору, мы помогать с конкретной рекомендацией |
| Pandoc сломал `pmatrix` в typst | `scripts/tex_to_qmd.py` — добавить препроцессинг до Pandoc |

## Минимальный smoke-test перед «готово»

1. `cd book && quarto render --to html` — без ошибок.
2. `cd book && quarto render ch02_newton.qmd --to tufte-inspired-typst` — без ошибок, PDF создан.
3. `cd book && quarto render ch_linalg.qmd --to tufte-inspired-typst` — без ошибок, PDF создан.
4. `curl -I https://sigma.fmin.xyz/ch02_newton.html` → 200.
5. `pdftoppm -r 130 docs/ch02_newton.pdf /tmp/check/n -png` → читаем каждую страницу.
6. То же для linalg.
7. Сверяем мобильную HTML — должно ли что-то быть в margin column, как себя ведёт sidebar.

## Антипаттерны (никогда так не делаем)

- ❌ «Я открыл первую страницу, выглядит ок, остальные тоже норм». — Нет. Каждая страница, каждой главы, каждой сборки.
- ❌ «Поправил вручную в `book/ch02_newton.qmd`, чтобы починить». — Затрётся.
- ❌ «Прицельно подгонял PDF под скриншот пользователя, не понимая причину». — Поломается на следующей странице.
- ❌ «PDF выложил в TG, на сайт не задеплоил». — Сайт = nginx на `/var/www/sigma/docs/`, всё что мы рендерим уже там. Но: HTML рендерится отдельно, не забываем `quarto render --to html`.
- ❌ Менять `overleaf_export/*.tex` напрямую.
- ❌ Использовать `EnterPlanMode` в Telegram-сессии — это ловушка, выйти можно только через UI.

## Чек-лист каждой задачи

- [ ] Понятно, в каком слое pipeline патч?
- [ ] Патч архитектурный (а не «правка одной строки в одном qmd»)?
- [ ] Прогнал `quarto render --to html`?
- [ ] Прогнал `quarto render --to tufte-inspired-typst` для **обеих** глав?
- [ ] Посмотрел каждую страницу обеих PDF в hi-res?
- [ ] Открыл HTML на телефоне (или в инспекторе с шириной 375px)?
- [ ] Нет регрессии: то, что работало в других главах, продолжает работать?
- [ ] CSS/typst-template изменения отрабатывают на ВСЕХ главах, а не только на тестовой?
