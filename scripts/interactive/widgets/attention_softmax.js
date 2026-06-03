// attention-softmax — внимание как мягкий поиск по схожести.
// Токены живут в 2D «пространстве смысла». Выбираешь запрос (query), и он
// распределяет внимание по ключам через softmax(q·k/τ). Тяни любой токен или
// крути температуру τ — веса пересчитываются мгновенно. Низкая τ → острое
// внимание на ближайшем; высокая → размытое, почти равномерное.
SigmaInt.register("attention-softmax", function (root, opts, S) {
  const P = S.PALETTE;

  root.appendChild(S.el("div", "sigma-int-hint", {
    text: "Кликни токен — он станет запросом (query). Тяни токены по карте смысла и крути температуру τ — веса внимания пересчитываются мгновенно.",
  }));

  const stage = S.row(root);
  const W = 720, H = 440;
  const cv = S.makeCanvas(stage, W, H, { maxWidth: 720, pan: false });
  const ctx = cv.ctx;
  const controls = S.row(root, "controls");
  const out = S.readout(root);
  S.caption(root,
    "Толщина и яркость связи — вес внимания: запрос (синий) сильнее «смотрит» на близкие " +
    "по смыслу токены (большое скалярное произведение q·k). Снизу — распределение весов " +
    "после softmax. Температура τ управляет резкостью: τ→0 — жёсткий выбор одного соседа, " +
    "τ→∞ — равномерное размазывание по всем. Это и есть один «голова внимания» трансформера.");

  // токены в 2D пространстве смысла (мир ~[-1,1]); расставлены смысловыми кластерами
  const tokens = [
    { w: "кошка", x: -0.62, y: 0.55 },
    { w: "собака", x: -0.42, y: 0.74 },
    { w: "мяукнула", x: -0.80, y: 0.10 },
    { w: "село", x: 0.55, y: 0.62 },
    { w: "солнце", x: 0.72, y: 0.40 },
    { w: "за", x: 0.10, y: -0.30 },
    { w: "горизонт", x: 0.60, y: -0.55 },
    { w: "тепло", x: 0.30, y: -0.10 },
  ];
  let query = 0;     // индекс токена-запроса
  let tau = 0.35;    // температура

  // мир→пиксели (квадратная область слева, бары справа)
  const map = { x: 40, y: 30, w: 420, h: 330 };
  const wx = (x) => map.x + (x + 1) / 2 * map.w;
  const wy = (y) => map.y + (1 - (y + 1) / 2) * map.h;
  const ix = (sx) => (sx - map.x) / map.w * 2 - 1;
  const iy = (sy) => (1 - (sy - map.y) / map.h) * 2 - 1;
  const barBox = { x: 500, y: 30, w: 200, h: 330 };

  function dot(a, b) { return a.x * b.x + a.y * b.y; }

  function weights() {
    const q = tokens[query];
    // self-внимание маскируем: запрос распределяет внимание по ДРУГИМ токенам
    // (иначе q·q максимально и токен всегда «смотрит на себя» — педагогически мутно).
    const sc = tokens.map((t, i) => i === query ? -Infinity : dot(q, t) / Math.SQRT2 / Math.max(0.01, tau));
    const mx = Math.max.apply(null, sc.filter((s) => isFinite(s)));
    const ex = sc.map((s) => isFinite(s) ? Math.exp(s - mx) : 0);
    const Z = ex.reduce((a, b) => a + b, 0) || 1;
    return ex.map((e) => e / Z);
  }

  function entropy(ws) {
    let e = 0; for (const w of ws) if (w > 1e-9) e -= w * Math.log(w);
    return e / Math.log(Math.max(2, ws.length - 1)); // нормированная 0..1 (self замаскирован)
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const ws = weights();
    const q = tokens[query];

    // рамка карты
    ctx.strokeStyle = P.grid; ctx.lineWidth = 1; ctx.strokeRect(map.x, map.y, map.w, map.h);
    ctx.fillStyle = P.mut; ctx.font = "12px Palatino, Georgia, serif"; ctx.textAlign = "left";
    ctx.fillText("пространство смысла (тяни токены)", map.x, map.y - 10);

    // связи запрос→ключи (толщина/яркость ∝ вес)
    const qX = wx(q.x), qY = wy(q.y);
    tokens.forEach((t, i) => {
      if (i === query) return;
      const a = ws[i];
      ctx.strokeStyle = "rgba(31,78,121," + (0.12 + 0.85 * a).toFixed(3) + ")";
      ctx.lineWidth = 0.6 + a * 11;
      ctx.beginPath(); ctx.moveTo(qX, qY); ctx.lineTo(wx(t.x), wy(t.y)); ctx.stroke();
    });

    // токены
    tokens.forEach((t, i) => {
      const X = wx(t.x), Y = wy(t.y), isQ = i === query;
      ctx.beginPath(); ctx.arc(X, Y, isQ ? 9 : 6, 0, 2 * Math.PI);
      ctx.fillStyle = isQ ? P.blue : "#fffff8";
      ctx.fill();
      ctx.strokeStyle = isQ ? P.blue : P.mut; ctx.lineWidth = isQ ? 2.5 : 1.5; ctx.stroke();
      ctx.fillStyle = isQ ? P.blue : P.ink;
      ctx.font = (isQ ? "bold " : "") + "13px Palatino, Georgia, serif";
      ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      ctx.fillText(t.w, X, Y - 11);
      ctx.textBaseline = "alphabetic";
    });

    // бары весов справа
    ctx.fillStyle = P.mut; ctx.font = "12px Palatino, Georgia, serif"; ctx.textAlign = "left";
    ctx.fillText("вес внимания (softmax)", barBox.x, barBox.y - 10);
    const n = tokens.length, rowH = barBox.h / n, maxW = Math.max.apply(null, ws);
    tokens.forEach((t, i) => {
      const y = barBox.y + i * rowH + 3, bh = rowH - 8;
      const isQ = i === query;
      // подпись
      ctx.fillStyle = isQ ? P.blue : P.ink; ctx.textAlign = "left";
      ctx.font = (isQ ? "bold " : "") + "12px Palatino, Georgia, serif";
      ctx.fillText(t.w, barBox.x, y + bh - 1);
      // бар (для запроса self замаскирован — показываем пометку вместо бара)
      const bx = barBox.x + 78;
      if (isQ) {
        ctx.fillStyle = P.mut; ctx.font = "italic 11px Palatino, Georgia, serif"; ctx.textAlign = "left";
        ctx.fillText("(запрос — себя не считает)", bx, y + bh - 1);
      } else {
        const bw = (barBox.w - 110) * (ws[i] / (maxW || 1));
        ctx.fillStyle = P.blue;
        ctx.globalAlpha = 0.4 + 0.6 * (ws[i] / (maxW || 1));
        ctx.fillRect(bx, y, Math.max(1, bw), bh);
        ctx.globalAlpha = 1;
        ctx.fillStyle = P.mut; ctx.font = "11px JetBrains Mono, monospace"; ctx.textAlign = "right";
        ctx.fillText((ws[i] * 100).toFixed(0) + "%", barBox.x + barBox.w, y + bh - 1);
      }
    });

    // read-out
    let top = 0; for (let i = 1; i < ws.length; i++) if (ws[i] > ws[top]) top = i;
    const H01 = entropy(ws);
    out.set([
      { k: "запрос", v: q.w, color: P.blue },
      { k: "сильнее всего смотрит на", v: tokens[top].w + " (" + (ws[top] * 100).toFixed(0) + "%)", color: P.red },
      { k: "температура τ", v: tau.toFixed(2), color: P.gold },
      { k: "внимание", v: H01 < 0.45 ? "острое" : (H01 > 0.8 ? "размытое" : "среднее"), color: P.green },
    ]);
  }

  const redraw = S.rafThrottle(draw);

  // перетаскивание токенов + клик-выбор запроса
  let drag = -1, moved = false;
  function pick(p) {
    let best = -1, bd = 18;
    tokens.forEach((t, i) => { const d = Math.hypot(p.x - wx(t.x), p.y - wy(t.y)); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  S.dragify(cv.canvas, { w: W, h: H }, {
    onDown: (p) => { drag = pick(p); moved = false; },
    onMove: (p) => {
      if (drag < 0) return;
      moved = true;
      tokens[drag].x = Math.max(-1, Math.min(1, ix(p.x)));
      tokens[drag].y = Math.max(-1, Math.min(1, iy(p.y)));
      redraw();
    },
    onUp: () => {
      if (drag >= 0 && !moved) { query = drag; seg && seg.set(query); redraw(); } // клик без движения = выбрать запрос
      drag = -1;
    },
    onHover: (p) => { cv.canvas.style.cursor = pick(p) >= 0 ? "grab" : "default"; },
  });

  // контролы
  let seg;
  seg = S.segmented(controls, {
    label: "Запрос (query)", value: query,
    options: tokens.map((t, i) => ({ value: i, label: t.w })),
  }, (v) => { query = +v; redraw(); });
  S.slider(controls, {
    label: "Температура τ", min: 0.02, max: 2.5, step: 0.02, value: tau, fmt: (v) => v.toFixed(2),
  }, (v) => { tau = v; redraw(); });

  draw();
});
