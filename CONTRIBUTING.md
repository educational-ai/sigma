# Как контрибьютить в Сигму

Учебник по продвинутым сюжетам ИИ. Live: **sigma.fmin.xyz**. Спасибо, что помогаешь
довести его до уровня [distill.pub](https://distill.pub) 🚀

Это руководство — для студентов-контрибьюторов. Прочитай его целиком перед первым PR.

---

## TL;DR

- **Самая ценная и безопасная работа — живые виджеты** (`scripts/interactive/widgets/`).
  Это изолированный чистый JS, не трогает хрупкий Overleaf-пайплайн. Начни отсюда.
- **НЕ редактируй `overleaf_export/*.tex` и текст глав `book/ch*.qmd` напрямую** — они
  генерятся из Overleaf и затираются ежечасным синком. Контент правится в Overleaf.
- Любой виджет проходит чеклист `book/INTERACTIVE_REVIEW.md` (планка — distill.pub) и
  автопроверку `scripts/verify_widget.py` перед «готово».
- Бери задачу из [Issues](https://github.com/MerkulovDaniil/sigma/issues), пиши в issue
  «беру», делай PR.

---

## Архитектура за 30 секунд

```
overleaf_export/   ← единственный источник правды для ТЕКСТА (main.tex, главы, фигуры)
   │  scripts/tex_to_qmd.py, split_chapters.py, augment.py
   ▼
book/*.qmd         ← Quarto-исходники (генерятся; story_*.qmd — наш authored-трек)
   │  quarto render
   ▼
docs/              ← собранный сайт, его отдаёт nginx (sigma.fmin.xyz)

scripts/interactive/   ← НАШ JS-фреймворк живых виджетов (правится напрямую!)
   core.js              объект S: makeCanvas/slider/drag/loop/axes/PALETTE…
   widgets/<name>.js    один файл = один SigmaInt.register("имя", (root,opts,S)=>{…})
   │  scripts/build_interactive.sh
   ▼
docs/assistant/interactive.js   ← бандл, инъектится на страницы
```

Виджет встраивается в сюжет так:

````markdown
::: {.column-page}
```{=html}
<div data-sigma-widget="имя-виджета"></div>
```
:::
````

## Сборка и предпросмотр

```bash
# весь сайт
./scripts/build.sh

# только пересобрать бандл виджетов
bash scripts/build_interactive.sh

# отрендерить одну страницу-сюжет
cd book && quarto render story_pca.qmd --to html
# результат: docs/story_pca.html
```

## Как добавить живой виджет (рекомендуемый первый вклад)

1. Создай `scripts/interactive/widgets/<имя>.js` с единственным
   `SigmaInt.register("<имя>", (root, opts, S) => { … })`. Подсмотри образец —
   `widgets/optimizers_descent.js` или `widgets/kmeans_cluster.js`.
2. Используй **только** API `S.*` (`core.js`) и стандартный DOM/canvas.
   **Никакого numpy, никаких внешних библиотек** — в браузере их нет, всё на чистом JS.
3. Встрой `<div data-sigma-widget="<имя>">` в нужный `book/story_*.qmd`.
4. Собери бандл: `bash scripts/build_interactive.sh`.
5. Отрендерь сюжет и проверь:
   ```bash
   /root/.venv/bin/python scripts/verify_widget.py \
       file://$PWD/docs/story_<slug>.html /tmp/sigverify
   ```
   Нужно: `err=null`, `reactsToSlider=true`, `hasCanvas`/`hasSvg`, **0 console-error**.
6. **Открой скриншоты `/tmp/sigverify/*_before/_after` глазами** и пройди чеклист
   `book/INTERACTIVE_REVIEW.md` (тактильность, палитра, читаемость, корректность матча).

### Главные правила виджетов (из INTERACTIVE_REVIEW.md)

- **Никаких кнопок «Запустить».** Ползунок / тянешь / крутишь / кликаешь → мгновенный
  пересчёт. Кнопка с ожиданием = это форма, а не живой виджет. Переделать.
- Что-то должно **тянуться/крутиться** (не только числовые ползунки).
- Осмысленная картинка рисуется **сразу при загрузке**, без действий пользователя.
- Палитра Сигмы: blue `#1F4E79`, red `#C0392B`, green `#2E7D5B`, фон `#fffff8`. Сериф в
  подписях, `tabular-nums` в read-out.
- Адаптив 360–600px не ломается; ничего не наезжает и не вылезает за рамку.
- Без «кринжа»: не рисуем реалистичные объекты примитивами — либо реальные данные,
  либо честная абстрактная схема.
- Математика верна; нет деления на ноль / NaN / расходимости на краях ползунков.
- Тяжёлые данные (если нужны) — git-tracked JSON в `docs/assistant/data/`, считаются один
  раз через `scripts/precompute_interactive.py`, НЕ на каждом билде.

## Стиль и язык

- Контент и подписи — **по-русски**, аудитория — студенты МФТИ/ВШЭ.
- Один сюжет = один концепт с конкретным крючком, 150–350 строк (см. `book/NARRATIVE_SPINE.md`).
- Коммиты — осмысленные, по-русски, без следов AI-авторства (никаких `Co-Authored-By`).

## Процесс

1. Возьми задачу из Issues, отметься комментарием «беру».
2. Ветка от `main`, делай атомарный PR с понятным описанием и скриншотом/гифкой виджета.
3. В PR приложи вывод `verify_widget.py` и скриншот «после».
4. Ревью по чеклисту `INTERACTIVE_REVIEW.md`. Доводим до distill-планки, потом мёрджим.

Вопросы — заводи issue с лейблом `question`. Погнали 🔥
