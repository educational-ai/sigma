// annealing-tsp — живой имитационный отжиг для задачи коммивояжёра.
// Отжиг крутится НЕПРЕРЫВНО (S.loop): каждый кадр делает пачку 2-opt/swap
// ходов, тур перерисовывается, длина падает на глазах. Температурой можно
// управлять ползунком или схватив маркер на кривой охлаждения. Клик по полю
// добавляет город. Никакой кнопки «Запустить» — алгоритм идёт сам.
SigmaInt.register("annealing-tsp", function (root, opts, S) {
  const P = S.PALETTE;

  root.appendChild(S.el("div", "sigma-int-hint", {
    text: "Отжиг идёт сам. Тяни ползунок T (или схвати точку на кривой охлаждения), кликни по полю — добавить город, «перемешать» — новая раскладка.",
  }));

  const stage = S.row(root);
  const W = 760, H = 380;
  const cv = S.makeCanvas(stage, W, H, { maxWidth: 760, pan: false });
  const ctx = cv.ctx;

  const controls = S.row(root, "controls");
  const out = S.readout(root);
  S.caption(root,
    "Имитация отжига для коммивояжёра. При высокой температуре алгоритм охотно " +
    "принимает ухудшающие ходы (исследование, выход из локальных ловушек); по мере " +
    "остывания становится придирчивым и замораживается в найденном минимуме (эксплуатация). " +
    "Слева — текущий тур, справа — история длины и кривая температуры.");

  // ---- геометрия панелей (логические координаты W×H) --------------------
  const map = { x: 8, y: 28, w: 420, h: H - 44 };   // карта городов
  const plot = { x: 478, y: 28, w: W - 478 - 8, h: H - 86 }; // график длины
  const tbar = { x: 478, y: H - 44, w: W - 478 - 8, h: 26 }; // полоса температуры

  // ---- RNG (детерминированный по seed) ----------------------------------
  let seed = 12345;
  function rng() {
    // mulberry32
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // ---- состояние задачи -------------------------------------------------
  let cities = [];        // [{x,y}] в логических координатах внутри map
  let tour = [];          // перестановка индексов
  let dist = [];          // матрица расстояний (плоская)
  let curLen = 0;
  let bestTour = [], bestLen = Infinity;
  let iter = 0, accepted = 0, rejected = 0, acceptedWorse = 0;
  let history = [];       // длина тура по времени (для графика)
  const HIST_MAX = 240;

  // температура
  let T = 0;              // текущая
  let manualT = false;    // пользователь держит T вручную
  let Tmax = 1;           // верхняя граница (масштаб) — задаётся от данных

  function pad(n) { return Math.max(2, n); }

  function rebuildDist() {
    const n = cities.length;
    dist = new Array(n * n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = cities[i].x - cities[j].x, dy = cities[i].y - cities[j].y;
        const d = Math.sqrt(dx * dx + dy * dy);
        dist[i * n + j] = d; dist[j * n + i] = d;
      }
    }
  }

  function tourLength(t) {
    const n = t.length; if (n < 2) return 0;
    let s = 0;
    for (let i = 0; i < n; i++) s += dist[t[i] * n + t[(i + 1) % n]];
    return s;
  }

  // средняя длина ребра — масштаб для температуры
  function avgEdge() {
    const n = cities.length; if (n < 2) return 1;
    let s = 0, c = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { s += dist[i * n + j]; c++; }
    return c ? s / c : 1;
  }

  function resetSearch() {
    const n = cities.length;
    tour = Array.from({ length: n }, (_, i) => i);
    // лёгкая перетасовка старта
    for (let i = n - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const tmp = tour[i]; tour[i] = tour[j]; tour[j] = tmp; }
    curLen = tourLength(tour);
    bestTour = tour.slice(); bestLen = curLen;
    iter = 0; accepted = 0; rejected = 0; acceptedWorse = 0;
    history = [curLen];
    Tmax = Math.max(1e-6, avgEdge() * 1.0);
    if (!manualT) T = Tmax * tFromSlider();   // позиция ползунка задаёт долю Tmax
  }

  function scatterCities(n) {
    cities = [];
    const pm = 26; // отступ внутри карты
    for (let i = 0; i < n; i++) {
      cities.push({
        x: map.x + pm + rng() * (map.w - 2 * pm),
        y: map.y + pm + rng() * (map.h - 2 * pm),
      });
    }
    rebuildDist();
    resetSearch();
  }

  // ---- шаг отжига: 2-opt с реверсом сегмента + иногда swap --------------
  function deltaTwoOpt(t, a, b) {
    // ребро (a, a+1) и (b, b+1) → реверс сегмента a+1..b
    const n = t.length;
    const A = t[a], An = t[(a + 1) % n];
    const B = t[b], Bn = t[(b + 1) % n];
    if (A === B || An === B || A === Bn) return null;
    const before = dist[A * n + An] + dist[B * n + Bn];
    const after = dist[A * n + B] + dist[An * n + Bn];
    return after - before;
  }

  function applyTwoOpt(t, a, b) {
    // реверс участка (a+1 .. b)
    let i = a + 1, j = b;
    while (i < j) { const tmp = t[i]; t[i] = t[j]; t[j] = tmp; i++; j--; }
  }

  function annealStep() {
    const n = tour.length;
    if (n < 4) { curLen = tourLength(tour); return; }
    // выбрать два индекса для 2-opt
    let a = (rng() * n) | 0;
    let b = (rng() * n) | 0;
    if (a > b) { const t = a; a = b; b = t; }
    if (b - a < 1 || (a === 0 && b === n - 1)) return;
    const d = deltaTwoOpt(tour, a, b);
    if (d == null) return;
    iter++;
    let accept;
    if (d <= 0) accept = true;
    else if (T <= 1e-12) accept = false;
    else accept = rng() < Math.exp(-d / T);
    if (accept) {
      applyTwoOpt(tour, a, b);
      curLen += d;
      accepted++;
      if (d > 0) acceptedWorse++;
      if (curLen < bestLen - 1e-9) { bestLen = curLen; bestTour = tour.slice(); }
    } else {
      rejected++;
    }
  }

  // ---- ползунок температуры: значение 0..1 = доля Tmax ------------------
  let tSlider;
  function tFromSlider() { return tSlider ? tSlider.get() : 0.35; }

  // ---- отрисовка ---------------------------------------------------------
  function drawMap() {
    // рамка/фон
    ctx.fillStyle = P.panel; ctx.fillRect(map.x, map.y, map.w, map.h);
    ctx.strokeStyle = P.grid; ctx.lineWidth = 1;
    ctx.strokeRect(map.x + 0.5, map.y + 0.5, map.w - 1, map.h - 1);
    ctx.fillStyle = P.mut; ctx.font = "12px Palatino, Georgia, serif"; ctx.textAlign = "left";
    ctx.fillText("Маршрут (клик — добавить город)", map.x, map.y - 8);

    const n = cities.length;
    if (n >= 2) {
      // «призрак» лучшего тура — тонкий
      if (bestTour.length === n && bestLen < curLen - 1e-6) {
        ctx.strokeStyle = "rgba(46,125,91,0.30)"; ctx.lineWidth = 1.4; ctx.beginPath();
        for (let i = 0; i <= n; i++) { const c = cities[bestTour[i % n]]; i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y); }
        ctx.stroke();
      }
      // текущий тур
      ctx.strokeStyle = P.blue; ctx.lineWidth = 2; ctx.beginPath();
      for (let i = 0; i <= n; i++) { const c = cities[tour[i % n]]; i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y); }
      ctx.stroke();
    }
    // города
    for (let i = 0; i < n; i++) {
      const c = cities[i];
      ctx.fillStyle = i === tour[0] ? P.red : P.ink;
      ctx.beginPath(); ctx.arc(c.x, c.y, i === tour[0] ? 5 : 3.4, 0, 2 * Math.PI); ctx.fill();
      ctx.strokeStyle = P.bg; ctx.lineWidth = 1.2; ctx.stroke();
    }
  }

  function drawPlot() {
    ctx.fillStyle = P.mut; ctx.font = "12px Palatino, Georgia, serif"; ctx.textAlign = "left";
    ctx.fillText("Длина тура во времени", plot.x, plot.y - 8);
    // фон
    ctx.fillStyle = P.bg; ctx.fillRect(plot.x, plot.y, plot.w, plot.h);
    ctx.strokeStyle = P.grid; ctx.lineWidth = 1;
    ctx.strokeRect(plot.x + 0.5, plot.y + 0.5, plot.w - 1, plot.h - 1);

    if (history.length < 2) return;
    let mn = Infinity, mx = -Infinity;
    for (const v of history) { if (v < mn) mn = v; if (v > mx) mx = v; }
    if (mx - mn < 1e-6) { mx = mn + 1; }
    const pad = (mx - mn) * 0.08;
    const yS = S.scale(mn - pad, mx + pad, plot.y + plot.h - 6, plot.y + 6);
    const xS = S.scale(0, Math.max(1, history.length - 1), plot.x + 6, plot.x + plot.w - 6);
    // линия best (горизонталь)
    ctx.strokeStyle = "rgba(46,125,91,0.5)"; ctx.setLineDash([4, 3]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(plot.x + 6, yS(bestLen)); ctx.lineTo(plot.x + plot.w - 6, yS(bestLen)); ctx.stroke();
    ctx.setLineDash([]);
    // история
    ctx.strokeStyle = P.blue; ctx.lineWidth = 1.6; ctx.beginPath();
    for (let i = 0; i < history.length; i++) { const X = xS(i), Y = yS(history[i]); i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y); }
    ctx.stroke();
    // подпись best
    ctx.fillStyle = P.green; ctx.font = "11px Palatino, serif"; ctx.textAlign = "right";
    ctx.fillText("best " + bestLen.toFixed(0), plot.x + plot.w - 6, yS(bestLen) - 4);
  }

  // полоса температуры — её можно «схватить» и тянуть, как кривую охлаждения
  function drawTempBar() {
    ctx.fillStyle = P.mut; ctx.font = "11px Palatino, serif"; ctx.textAlign = "left";
    ctx.fillText("Температура T (схвати и тяни)", tbar.x, tbar.y - 5);
    // фон-градиент дискретно: холодно→горячо (синий→золото→красный)
    const steps = 60;
    for (let i = 0; i < steps; i++) {
      const f = i / (steps - 1);
      // интерполяция синий→красный через золото
      let col;
      if (f < 0.5) col = mix(P.blue, P.gold, f / 0.5);
      else col = mix(P.gold, P.red, (f - 0.5) / 0.5);
      ctx.fillStyle = col;
      ctx.fillRect(tbar.x + f * tbar.w, tbar.y, tbar.w / steps + 1, tbar.h);
    }
    ctx.strokeStyle = P.grid; ctx.strokeRect(tbar.x + 0.5, tbar.y + 0.5, tbar.w - 1, tbar.h - 1);
    // маркер текущей T
    const frac = Tmax > 0 ? Math.max(0, Math.min(1, T / Tmax)) : 0;
    const mxp = tbar.x + frac * tbar.w;
    ctx.fillStyle = P.bg; ctx.strokeStyle = P.ink; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(mxp, tbar.y + tbar.h / 2, 7, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(mxp, tbar.y + tbar.h / 2, 2.5, 0, 2 * Math.PI); ctx.fillStyle = P.ink; ctx.fill();
  }

  function mix(h1, h2, t) {
    const a = hex(h1), b = hex(h2);
    const r = Math.round(a[0] + (b[0] - a[0]) * t);
    const g = Math.round(a[1] + (b[1] - a[1]) * t);
    const bl = Math.round(a[2] + (b[2] - a[2]) * t);
    return "rgb(" + r + "," + g + "," + bl + ")";
  }
  function hex(h) {
    const v = parseInt(h.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    drawMap();
    drawPlot();
    drawTempBar();
    updateReadout();
  }

  function updateReadout() {
    const total = accepted + rejected;
    const accRate = total ? (accepted / total * 100) : 0;
    const phase = T > Tmax * 0.5 ? "исследование" : (T > Tmax * 0.08 ? "переход" : "заморозка");
    const phaseColor = T > Tmax * 0.5 ? P.red : (T > Tmax * 0.08 ? P.gold : P.blue);
    out.set([
      { k: "длина", v: curLen.toFixed(0), color: P.blue },
      { k: "лучшая", v: (bestLen === Infinity ? "—" : bestLen.toFixed(0)), color: P.green },
      { k: "T", v: T.toFixed(2), color: phaseColor },
      { k: "режим", v: phase, color: phaseColor },
      { k: "итер.", v: String(iter), color: P.mut },
      { k: "принято", v: accRate.toFixed(0) + "%", color: P.mut },
      { k: "ухудш. принято", v: String(acceptedWorse), color: P.gold },
      { k: "городов", v: String(cities.length), color: P.mut },
    ]);
  }

  const redraw = S.rafThrottle(draw);

  // ---- взаимодействие: клик/тяни ----------------------------------------
  function inside(box, p) { return p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h; }

  let draggingT = false;
  S.dragify(cv.canvas, { w: W, h: H }, {
    onDown: (p) => {
      // если по полоске температуры — начать тянуть T
      if (p.y >= tbar.y - 10 && p.y <= tbar.y + tbar.h + 10 && p.x >= tbar.x - 8 && p.x <= tbar.x + tbar.w + 8) {
        draggingT = true; manualT = true; setTFromBar(p); return;
      }
      // если по карте — добавить город
      if (inside(map, p) && cities.length < 60) {
        cities.push({ x: p.x, y: p.y });
        rebuildDist();
        // вставить новый город в тур рядом с ближайшим, не сбрасывая прогресс
        insertCity(cities.length - 1);
        history.push(curLen); if (history.length > HIST_MAX) history.shift();
        redraw();
      }
    },
    onMove: (p) => { if (draggingT) setTFromBar(p); },
    onUp: () => { draggingT = false; },
  });

  function setTFromBar(p) {
    let frac = (p.x - tbar.x) / tbar.w;
    frac = Math.max(0, Math.min(1, frac));
    T = frac * Tmax;
    if (tSlider) tSlider.set(frac); // синхронизируем ползунок
    redraw();
  }

  function insertCity(idx) {
    const n = tour.length;
    if (n === 0) { tour = [idx]; curLen = 0; bestTour = [idx]; bestLen = 0; return; }
    if (n === 1) { tour = [tour[0], idx]; curLen = tourLength(tour); bestTour = tour.slice(); bestLen = curLen; return; }
    const N = cities.length;
    let bestPos = 0, bestInc = Infinity;
    for (let i = 0; i < n; i++) {
      const a = tour[i], b = tour[(i + 1) % n];
      const inc = dist[a * N + idx] + dist[idx * N + b] - dist[a * N + b];
      if (inc < bestInc) { bestInc = inc; bestPos = i + 1; }
    }
    tour.splice(bestPos, 0, idx);
    curLen = tourLength(tour);
    if (curLen < bestLen) { bestLen = curLen; bestTour = tour.slice(); }
  }

  // ---- контролы ----------------------------------------------------------
  S.slider(controls, {
    label: "Число городов", min: 5, max: 40, step: 1, value: 18, fmt: (v) => v | 0,
  }, (v) => { scatterCities(v | 0); redraw(); });

  tSlider = S.slider(controls, {
    label: "Температура T", min: 0, max: 1, step: 0.01, value: 0.35,
    fmt: (v) => (v * (Tmax || 1)).toFixed(2),
  }, (v) => { manualT = true; T = v * Tmax; redraw(); });

  S.segmented(controls, {
    label: "T-режим", value: "manual",
    options: [
      { value: "manual", label: "ручная" },
      { value: "cool", label: "охлаждение" },
    ],
  }, (v) => {
    coolMode = (v === "cool");
    manualT = !coolMode;
    if (coolMode) coolClock = 0; // перезапустить расписание
  });

  S.button(controls, "перемешать города", () => {
    seed = (Math.random() * 1e9) | 0;
    const n = cities.length || 18;
    scatterCities(n);
    redraw();
  }, "ghost");

  // ---- расписание охлаждения --------------------------------------------
  let coolMode = false;
  let coolClock = 0; // секунды в режиме охлаждения

  // ---- непрерывный отжиг -------------------------------------------------
  // стартовая раскладка
  scatterCities(18);

  const STEPS_PER_FRAME = 140;
  let histClock = 0;

  S.loop((dt) => {
    if (cities.length >= 4) {
      // авто-охлаждение: экспоненциальный спад с периодическим reheat
      if (coolMode) {
        coolClock += dt;
        const period = 14; // секунд на полный цикл охлаждения
        const phase = (coolClock % period) / period; // 0..1
        // T: Tmax при phase=0 → ~0 к концу; затем снова разогрев (цикл)
        const frac = Math.max(0.0, Math.pow(1 - phase, 2.2));
        T = Tmax * frac;
        if (tSlider) tSlider.set(Math.max(0, Math.min(1, frac)));
      }
      for (let s = 0; s < STEPS_PER_FRAME; s++) annealStep();
    }
    // запись истории ~25 раз/сек
    histClock += dt;
    if (histClock > 0.04) {
      histClock = 0;
      history.push(curLen);
      if (history.length > HIST_MAX) history.shift();
    }
    draw();
  }).start();

  // первый кадр немедленно
  draw();
});
