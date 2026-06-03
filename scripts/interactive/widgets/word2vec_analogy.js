// word2vec-analogy — игрушечный 2D-словарь, где семантика закодирована
// направлениями. Тащи любое слово-точку мышью — вектор t = a − b + c,
// параллелограмм аналогии и ближайшее слово пересчитываются мгновенно.
// Никакой кнопки, вся арифметика на чистом JS.
SigmaInt.register("word2vec-analogy", function (root, opts, S) {
  const P = S.PALETTE;

  root.appendChild(S.el("div", "sigma-int-hint", {
    text: "Тащи любую точку-слово мышью — t = a − b + c и параллелограмм аналогии " +
          "пересчитываются мгновенно, ближайшее слово подсвечивается красным.",
  }));

  // ---- игрушечный 2D-эмбеддинг ----------------------------------------
  // Ось X ≈ «королевский статус → столичность/страна»,
  // ось Y ≈ «пол / роль». Координаты подобраны так, чтобы работали
  // параллелограммы: король−мужчина+женщина≈королева,
  // Париж−Франция+Германия≈Берлин и т.д.
  // Два смысловых кластера разнесены, чтобы аналогии оставались
  // параллельными внутри каждого.
  const VOCAB = [
    // королевская семья: gender по Y, статус по X
    { w: "мужчина",   x: -2.6, y:  1.4 },
    { w: "женщина",   x: -2.6, y: -1.4 },
    { w: "король",    x: -1.2, y:  1.4 },
    { w: "королева",  x: -1.2, y: -1.4 },
    { w: "принц",     x: -0.4, y:  1.4 },
    { w: "принцесса", x: -0.4, y: -1.4 },
    // страны (нижний ряд) и столицы (верхний ряд): «столичность» по Y
    { w: "Франция",   x:  0.7, y: -2.0 },
    { w: "Париж",     x:  0.7, y:  0.2 },
    { w: "Германия",  x:  1.7, y: -2.0 },
    { w: "Берлин",    x:  1.7, y:  0.2 },
    { w: "Италия",    x:  2.7, y: -2.0 },
    { w: "Рим",       x:  2.7, y:  0.2 },
    { w: "Япония",    x:  3.7, y: -2.0 },
    { w: "Токио",     x:  3.7, y:  0.2 },
  ];
  // позиции мутируем при перетаскивании
  const pos = VOCAB.map((d) => ({ x: d.x, y: d.y }));
  const idxOf = (w) => VOCAB.findIndex((d) => d.w === w);

  // ---- состояние выбора -----------------------------------------------
  let ia = idxOf("король"), ib = idxOf("мужчина"), ic = idxOf("женщина");

  // ---- холст ----------------------------------------------------------
  const stage = S.row(root);
  const W = 720, H = 460;
  const cv = S.makeCanvas(stage, W, H, { maxWidth: 720, pan: false, onResize: () => redraw() });
  const ctx = cv.ctx;

  // ---- контролы -------------------------------------------------------
  const controls = S.row(root, "controls");
  const wordOpts = VOCAB.map((d) => ({ value: d.w, label: d.w }));
  const selA = S.select(controls, { label: "a", options: wordOpts, value: VOCAB[ia].w }, (v) => { ia = idxOf(v); redraw(); });
  const selB = S.select(controls, { label: "− b", options: wordOpts, value: VOCAB[ib].w }, (v) => { ib = idxOf(v); redraw(); });
  const selC = S.select(controls, { label: "+ c", options: wordOpts, value: VOCAB[ic].w }, (v) => { ic = idxOf(v); redraw(); });
  S.button(controls, "Сбросить позиции", () => {
    VOCAB.forEach((d, i) => { pos[i].x = d.x; pos[i].y = d.y; });
    redraw();
  });

  const out = S.readout(root);

  S.caption(root,
    "Каждое слово — точка в игрушечном 2D-пространстве, где направления " +
    "несут смысл (пол, статус, «город↔страна»). Аналогия a − b + c строит " +
    "параллелограмм; красным помечено ближайшее реальное слово к результату t. " +
    "Перетащи точку — и геометрия аналогии перестроится у тебя на глазах.");

  // ---- геометрия / шкалы ---------------------------------------------
  const box = { x: 56, y: 28, w: W - 56 - 16, h: H - 28 - 40 };
  // фиксированные домены с запасом
  const DX = [-3.2, 4.4], DY = [-3.0, 2.6];
  const sx = S.scale(DX[0], DX[1], box.x, box.x + box.w);
  const sy = S.scale(DY[0], DY[1], box.y + box.h, box.y); // y вверх

  function toPx(p) { return { px: sx(p.x), py: sy(p.y) }; }
  function dataFromPx(px, py) { return { x: sx.inv(px), y: sy.inv(py) }; }

  // ---- ближайшие к t слова -------------------------------------------
  function nearest(t, excludeSet) {
    const cand = [];
    for (let i = 0; i < pos.length; i++) {
      if (excludeSet && excludeSet.has(i)) continue;
      const dx = pos[i].x - t.x, dy = pos[i].y - t.y;
      cand.push({ i, d: Math.sqrt(dx * dx + dy * dy) });
    }
    cand.sort((p, q) => p.d - q.d);
    return cand;
  }

  // ---- рисование точки-слова -----------------------------------------
  function dot(p, color, label, opts2) {
    opts2 = opts2 || {};
    const q = toPx(p);
    const r = opts2.r || 5;
    ctx.beginPath();
    ctx.arc(q.px, q.py, r, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.globalAlpha = opts2.alpha == null ? 1 : opts2.alpha;
    ctx.fill();
    ctx.globalAlpha = 1;
    if (opts2.ring) {
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(q.px, q.py, r + 4, 0, 2 * Math.PI); ctx.stroke();
    }
    if (label != null) {
      ctx.font = (opts2.bold ? "bold " : "") + (opts2.fs || 12) + "px Palatino, Georgia, serif";
      ctx.fillStyle = opts2.labelColor || P.ink;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      // подпись справа, чтобы не залезать на точку
      ctx.fillText(label, q.px + r + 5, q.py - (opts2.up ? 8 : 0));
    }
    return q;
  }

  function arrow(p0, p1, color, dash) {
    const a = toPx(p0), b = toPx(p1);
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.setLineDash(dash || []);
    ctx.beginPath(); ctx.moveTo(a.px, a.py); ctx.lineTo(b.px, b.py); ctx.stroke();
    ctx.setLineDash([]);
    // наконечник
    const ang = Math.atan2(b.py - a.py, b.px - a.px);
    const hl = 12;
    ctx.beginPath();
    ctx.moveTo(b.px, b.py);
    ctx.lineTo(b.px - hl * Math.cos(ang - 0.4), b.py - hl * Math.sin(ang - 0.4));
    ctx.lineTo(b.px - hl * Math.cos(ang + 0.4), b.py - hl * Math.sin(ang + 0.4));
    ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.textBaseline = "alphabetic";

    // фон-сетка
    ctx.strokeStyle = P.grid; ctx.lineWidth = 1;
    for (let gx = Math.ceil(DX[0]); gx <= DX[1]; gx++) {
      ctx.beginPath(); ctx.moveTo(sx(gx), box.y); ctx.lineTo(sx(gx), box.y + box.h); ctx.stroke();
    }
    for (let gy = Math.ceil(DY[0]); gy <= DY[1]; gy++) {
      ctx.beginPath(); ctx.moveTo(box.x, sy(gy)); ctx.lineTo(box.x + box.w, sy(gy)); ctx.stroke();
    }
    // подписи осей
    ctx.fillStyle = P.mut; ctx.font = "italic 12px Palatino, Georgia, serif";
    ctx.textAlign = "center"; ctx.fillText("статус  ·  страна → столица  (ось X)", box.x + box.w / 2, box.y + box.h + 30);
    ctx.save();
    ctx.translate(box.x - 40, box.y + box.h / 2); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center"; ctx.fillText("пол / роль  (ось Y)", 0, 0);
    ctx.restore();

    // вычисляем t = a − b + c
    const A = pos[ia], B = pos[ib], C = pos[ic];
    const t = { x: A.x - B.x + C.x, y: A.y - B.y + C.y };

    // параллелограмм: A, A−B (как смещение), ... визуализируем как
    // A → (A−B) → t и стрелку аналогии B→A параллельную C→t.
    // Удобнее показать: стрелка B→A (направление отношения) и
    // та же стрелка отложенная от C → даёт t.
    // Параллелограмм с вершинами B, A, t, C.
    const pb = toPx(B), pa = toPx(A), pt = toPx(t), pc = toPx(C);
    ctx.beginPath();
    ctx.moveTo(pb.px, pb.py); ctx.lineTo(pa.px, pa.py);
    ctx.lineTo(pt.px, pt.py); ctx.lineTo(pc.px, pc.py); ctx.closePath();
    ctx.fillStyle = "rgba(106,76,147,0.12)"; // purple wash
    ctx.fill();

    // рёбра-стрелки: отношение b→a и c→t (параллельны = аналогия)
    arrow(B, A, P.purple);          // направление "отношения"
    arrow(C, t, P.purple);          // то же отношение, приложенное к c
    // соединительные пунктиры b→c и a→t
    ctx.strokeStyle = P.purple; ctx.globalAlpha = 0.4; ctx.lineWidth = 1.4;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(pb.px, pb.py); ctx.lineTo(pc.px, pc.py); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pa.px, pa.py); ctx.lineTo(pt.px, pt.py); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;

    // ближайшее слово к t (исключаем сами a,b,c — ответ аналогии
    // никогда не должен быть одним из входов)
    const ranked = nearest(t, new Set([ia, ib, ic]));
    const best = ranked[0];

    // все точки-слова
    for (let i = 0; i < pos.length; i++) {
      let color = P.blue, alpha = 0.9, bold = false, ring = false, lc = P.ink;
      if (i === ia) { color = P.green; bold = true; ring = true; }
      else if (i === ib) { color = P.gold; bold = true; ring = true; }
      else if (i === ic) { color = P.green; bold = true; ring = true; }
      if (i === best.i) { color = P.red; bold = true; ring = true; lc = P.red; }
      dot(pos[i], color, VOCAB[i].w, { bold, ring, labelColor: lc, alpha });
    }

    // целевая точка t (полая, ink) — результат арифметики
    const qt = toPx(t);
    // соединитель t → ближайшее слово: «ближайшее» = эта линия, dist = её длина
    const pbest = toPx(pos[best.i]);
    ctx.strokeStyle = P.red; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.4;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(qt.px, qt.py); ctx.lineTo(pbest.px, pbest.py); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(qt.px, qt.py, 6, 0, 2 * Math.PI);
    ctx.strokeStyle = P.ink; ctx.lineWidth = 2; ctx.setLineDash([2, 2]); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = "bold italic 12px Palatino, Georgia, serif"; ctx.fillStyle = P.ink;
    ctx.textAlign = "left"; ctx.textBaseline = "middle";
    ctx.fillText("t", qt.px + 9, qt.py + 9);
    ctx.textBaseline = "alphabetic";

    // легенда вверху
    ctx.font = "12px Palatino, Georgia, serif"; ctx.textAlign = "left";
    const aw = VOCAB[ia].w, bw = VOCAB[ib].w, cw = VOCAB[ic].w;
    const eq = aw + " − " + bw + " + " + cw + " ≈ " + VOCAB[best.i].w;
    ctx.fillStyle = P.ink;
    ctx.fillText(eq, box.x + 4, box.y - 10);

    // read-out
    const top3 = ranked.slice(0, 3)
      .map((c, j) => VOCAB[c.i].w + " (" + c.d.toFixed(3) + ")")
      .join(", ");
    out.set([
      { k: "t =", v: aw + " − " + bw + " + " + cw, color: P.purple },
      { k: "≈", v: VOCAB[best.i].w, color: P.red },
      { k: "dist =", v: best.d.toFixed(3), color: P.mut },
      { k: "топ-3:", v: top3, color: P.blue },
    ]);
  }

  const redraw = S.rafThrottle(draw);

  // ---- перетаскивание точек ------------------------------------------
  let dragIdx = -1;
  function hitTest(p) {
    // p.x, p.y — логические координаты холста (W×H)
    let best = -1, bestD = 16; // радиус захвата в px
    for (let i = 0; i < pos.length; i++) {
      const q = toPx(pos[i]);
      const d = Math.hypot(q.px - p.x, q.py - p.y);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  S.dragify(cv.canvas, { w: W, h: H }, {
    onDown: (p) => {
      dragIdx = hitTest(p);
      if (dragIdx >= 0) {
        cv.canvas.style.cursor = "grabbing";
        moveTo(p);
      }
    },
    onMove: (p) => { if (dragIdx >= 0) moveTo(p); },
    onUp: () => { dragIdx = -1; cv.canvas.style.cursor = "grab"; },
    onHover: (p) => {
      cv.canvas.style.cursor = hitTest(p) >= 0 ? "grab" : "default";
    },
  });

  function moveTo(p) {
    if (dragIdx < 0) return;
    const d = dataFromPx(p.x, p.y);
    // держим в пределах домена с небольшим запасом
    pos[dragIdx].x = Math.max(DX[0] + 0.1, Math.min(DX[1] - 0.1, d.x));
    pos[dragIdx].y = Math.max(DY[0] + 0.1, Math.min(DY[1] - 0.1, d.y));
    redraw();
  }

  draw();
});
