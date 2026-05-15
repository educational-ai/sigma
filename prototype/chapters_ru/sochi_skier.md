---
title: "Броуновский лыжник на ЦМР Сочи"
resources:
  - sochi_skier.js
  - sochi_skier_map.jpg
  - sochi_skier_dem_f32.bin
  - sochi_skier_meta.json
---

Лыжник движется по передемпфрованной динамике Ланжевена на цифровой модели рельефа коридора «Роза Хутор — Сириус»:

$$
dx = -\nabla h(x)\,dt + \sigma\,dW
$$

Дрифт-член смещает точку вниз по склону; броуновский член добавляет управляемый шум, так что при большем $\sigma$ траектория исследует рельеф, вместо того чтобы скользить вдоль одной детермининистической линии спуска.

```{=html}
<link rel="preload" href="sochi_skier_map.jpg" as="image">
<link rel="preload" href="sochi_skier_dem_f32.bin" as="fetch" crossorigin>

<div class="sochi-skier" data-sochi-skier>
  <div class="sochi-skier__toolbar" aria-label="Sochi skier controls">
    <label class="sochi-skier__control">
      <span class="sochi-skier__label">
        <span>Частота симуляции (кадр/с)</span>
        <span class="sochi-skier__value" data-role="fps-value">60</span>
      </span>
      <input class="sochi-skier__range" data-role="fps" type="range" min="10" max="360" step="10" value="60">
    </label>
    <label class="sochi-skier__control">
      <span class="sochi-skier__label">
        <span>Броуновский шум, &sigma;</span>
        <span class="sochi-skier__value" data-role="sigma-value">10.0</span>
      </span>
      <input class="sochi-skier__range" data-role="sigma" type="range" min="0" max="120" step="0.5" value="10">
    </label>
    <button class="sochi-skier__button sochi-skier__button--primary" data-role="restart" type="button">Роза Хутор</button>
    <button class="sochi-skier__button" data-role="clear" type="button">Стереть след</button>
    <button class="sochi-skier__button" data-role="toggle" type="button" aria-pressed="false">Пауза</button>
  </div>
  <div class="sochi-skier__stage" data-role="stage">
    <canvas class="sochi-skier__canvas" data-role="canvas" aria-label="Траектория броуновского лыжника на ЦМР Сочи"></canvas>
    <div class="sochi-skier__pois" data-role="pois" aria-hidden="true"></div>
    <div class="sochi-skier__loading" data-role="loading">Загрузка ЦМР Сочи...</div>
  </div>
  <div class="sochi-skier__readout" aria-live="polite">
    <span>Высота <strong data-role="elevation">...</strong></span>
    <span>Положение <strong data-role="position">...</strong></span>
  </div>
</div>
```

Коснитесь или щёлкните по карте, чтобы задать новую начальную точку.

```{=html}
<script defer src="sochi_skier.js"></script>
```