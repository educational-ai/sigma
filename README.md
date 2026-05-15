# uchebniik

Приватный репозиторий учебника. Публикуется на **uchebniik.fmin.xyz**.

## Структура

```
raw_materials/    — исходные материалы (рукописи, заметки, источники)
overleaf_export/  — экспорт из Overleaf (main.tex, главы, фигуры)
docs/             — собранный сайт (HTML), отсюда публикуется на uchebniik.fmin.xyz
scripts/          — конвертация overleaf_export/ → docs/
```

## Сборка

```bash
./scripts/build.sh
```

Конвертирует `overleaf_export/main.tex` → Quarto/HTML в `docs/`.

## Публикация

`docs/` отдаётся на uchebniik.fmin.xyz (через GitHub Pages или nginx с VPS).
