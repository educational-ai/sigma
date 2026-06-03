// kmeans-cluster — кластеризация k-средних вживую (алгоритм Ллойда).
// Точки непрерывно перекрашиваются по ближайшему центроиду, центроиды ползут
// к среднему своих точек — сходимость видна на глазах. Кликни по полю, чтобы
// добавить точку; тяни центроид (★), чтобы выбить из равновесия; меняй k.
SigmaInt.register("kmeans-cluster", function (root, opts, S) {
  const P = S.PALETTE;
  const COLORS = [P.blue, P.red, P.green, P.gold, P.purple, "#1f9e9e", "#b5651d"];

  root.appendChild(S.el("div", "sigma-int-hint", {
    text: "Кликни по полю — добавишь точку. Тяни звезду-центроид, чтобы выбить из равновесия. Меняй число кластеров k — алгоритм пересходится сам.",
  }));

  const stage = S.row(root);
  const W = 560, H = 400;
  const cv = S.makeCanvas(stage, W, H, { maxWidth: 560, pan: false });
  const ctx = cv.ctx;
  const controls = S.row(root, "controls");
  const out = S.readout(root);
  S.caption(root,
    "Алгоритм Ллойда чередует два шага: (1) приписать каждую точку ближайшему центроиду " +
    "(цвет), (2) сдвинуть центроид в среднее своих точек. Повторяя, он минимизирует инерцию — " +
    "сумму квадратов расстояний внутри кластеров. Светлая заливка — зоны влияния (ячейки " +
    "Вороного). Результат зависит от старта: перетащи центроид и увидишь другой минимум.");

  // ---------- мир→пиксели ----------
  const pad = 8;
  const wx = (x) => pad + x * (W - 2 * pad);
  const wy = (y) => pad + y * (H - 2 * pad);
  const ix = (sx) => (sx - pad) / (W - 2 * pad);
  const iy = (sy) => (sy - pad) / (H - 2 * pad);

  // ---------- детерминированный PRNG ----------
  let seed = 0x9e3779b9;
  function rnd() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; seed |= 0; return (seed >>> 0) / 4294967296; }
  function gauss(mx, my, s) { // приблизительно нормально (сумма равномерных)
    let u = 0, v = 0; for (let i = 0; i < 3; i++) { u += rnd(); v += rnd(); }
    return { x: mx + (u / 3 - 0.5) * s, y: my + (v / 3 - 0.5) * s };
  }

  let pts = [];      // {x,y, c} c=индекс кластера
  let cents = [];    // {x,y}
  let k = 3;

  function genData() {
    pts = [];
    const blobs = [[0.25, 0.30], [0.72, 0.28], [0.50, 0.74], [0.22, 0.72], [0.80, 0.70]];
    const nb = Math.max(3, k);
    for (let b = 0; b < nb; b++) {
      const c = blobs[b % blobs.length];
      const m = 26 + Math.floor(rnd() * 10);
      for (let i = 0; i < m; i++) {
        const g = gauss(c[0], c[1], 0.22);
        pts.push({ x: Math.max(0.02, Math.min(0.98, g.x)), y: Math.max(0.02, Math.min(0.98, g.y)), c: 0 });
      }
    }
  }
  function seedCentroids() {
    cents = [];
    for (let i = 0; i < k; i++) {
      // k-means++-ish: берём случайную точку
      const p = pts[Math.floor(rnd() * pts.length)] || { x: rnd(), y: rnd() };
      cents.push({ x: p.x + (rnd() - 0.5) * 0.05, y: p.y + (rnd() - 0.5) * 0.05 });
    }
  }

  function assign() {
    let changed = 0;
    for (const p of pts) {
      let best = 0, bd = Infinity;
      for (let j = 0; j < cents.length; j++) {
        const dx = p.x - cents[j].x, dy = p.y - cents[j].y, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = j; }
      }
      if (p.c !== best) changed++;
      p.c = best;
    }
    return changed;
  }
  function update() {
    const sx = new Float64Array(k), sy = new Float64Array(k), cnt = new Int32Array(k);
    for (const p of pts) { sx[p.c] += p.x; sy[p.c] += p.y; cnt[p.c]++; }
    let move = 0;
    for (let j = 0; j < k; j++) {
      if (cnt[j] === 0) continue;
      const nx = sx[j] / cnt[j], ny = sy[j] / cnt[j];
      move += Math.hypot(nx - cents[j].x, ny - cents[j].y);
      // плавный сдвиг к среднему — анимационная сходимость, видимая глазом
      cents[j].x += (nx - cents[j].x) * 0.25;
      cents[j].y += (ny - cents[j].y) * 0.25;
    }
    return move;
  }
  function inertia() {
    let s = 0;
    for (const p of pts) {
      const c = cents[p.c];
      if (!c) continue; // p.c мог устареть сразу после смены k — пропускаем до ближайшего assign()
      s += (p.x - c.x) ** 2 + (p.y - c.y) ** 2;
    }
    return s;
  }

  let iter = 0, settle = 0;

  // фон-ячейки Вороного (грубая сетка по ближайшему центроиду)
  function drawCells() {
    const GS = 7; // шаг сетки в пикселях
    for (let py = pad; py < H - pad; py += GS) {
      for (let px = pad; px < W - pad; px += GS) {
        const x = ix(px), y = iy(py);
        let best = 0, bd = Infinity;
        for (let j = 0; j < cents.length; j++) {
          const d = (x - cents[j].x) ** 2 + (y - cents[j].y) ** 2;
          if (d < bd) { bd = d; best = j; }
        }
        ctx.fillStyle = COLORS[best % COLORS.length];
        ctx.globalAlpha = 0.07;
        ctx.fillRect(px, py, GS, GS);
      }
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    drawCells();
    ctx.strokeStyle = P.grid; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

    // точки
    for (const p of pts) {
      ctx.fillStyle = COLORS[p.c % COLORS.length];
      ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.arc(wx(p.x), wy(p.y), 3.2, 0, 2 * Math.PI); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // центроиды-звёзды
    cents.forEach((c, j) => {
      drawStar(wx(c.x), wy(c.y), 9, COLORS[j % COLORS.length]);
    });

    const I = inertia();
    out.set([
      { k: "кластеров k", v: String(k), color: P.blue },
      { k: "точек", v: String(pts.length), color: P.mut },
      { k: "итерация", v: String(iter), color: P.mut },
      { k: "инерция", v: I.toFixed(4), color: P.red },
      { k: "статус", v: settle > 6 ? "сошлось" : "сходится…", color: settle > 6 ? P.green : P.gold },
    ]);
  }

  function drawStar(cx, cy, r, color) {
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const ang = -Math.PI / 2 + i * Math.PI / 5;
      const rr = i % 2 === 0 ? r : r * 0.45;
      ctx.lineTo(cx + rr * Math.cos(ang), cy + rr * Math.sin(ang));
    }
    ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = "#fffff8"; ctx.stroke();
    ctx.restore();
  }

  const redraw = S.rafThrottle(draw);

  // ---------- непрерывная сходимость ----------
  let tick = 0;
  const anim = S.loop(() => {
    tick++;
    if (tick % 8 === 0) { // шаг Ллойда ~7.5 раз/сек — видно глазом
      const changed = assign();
      update();
      iter++;
      // k-means сошёлся, когда приписывания перестали меняться (центроиды
      // при плавном сдвиге ещё микроскопически ползут к среднему — это не считаем).
      if (changed === 0) settle++; else settle = 0;
    }
    draw();
  });

  // ---------- взаимодействие ----------
  let drag = -1;
  function pickCentroid(p) {
    let best = -1, bd = 16;
    cents.forEach((c, j) => { const d = Math.hypot(p.x - wx(c.x), p.y - wy(c.y)); if (d < bd) { bd = d; best = j; } });
    return best;
  }
  S.dragify(cv.canvas, { w: W, h: H }, {
    onDown: (p) => {
      drag = pickCentroid(p);
      if (drag < 0) { // клик по пустому → добавить точку
        pts.push({ x: Math.max(0.02, Math.min(0.98, ix(p.x))), y: Math.max(0.02, Math.min(0.98, iy(p.y))), c: 0 });
        settle = 0; redraw();
      }
    },
    onMove: (p) => {
      if (drag >= 0) {
        cents[drag].x = Math.max(0, Math.min(1, ix(p.x)));
        cents[drag].y = Math.max(0, Math.min(1, iy(p.y)));
        settle = 0; redraw();
      }
    },
    onUp: () => { drag = -1; },
    onHover: (p) => { cv.canvas.style.cursor = pickCentroid(p) >= 0 ? "grab" : "crosshair"; },
  });

  // ---------- контролы ----------
  S.slider(controls, { label: "Число кластеров k", min: 2, max: 7, step: 1, value: k, fmt: (v) => v | 0 },
    (v) => { k = v | 0; seedCentroids(); assign(); iter = 0; settle = 0; redraw(); });
  S.button(controls, "Новые точки", () => { genData(); seedCentroids(); iter = 0; settle = 0; redraw(); }, "ghost");
  S.button(controls, "Переставить центроиды", () => { seedCentroids(); iter = 0; settle = 0; redraw(); });

  genData(); seedCentroids(); draw();
  anim.start();
});
