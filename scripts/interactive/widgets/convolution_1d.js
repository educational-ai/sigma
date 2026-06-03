// convolution-1d — свёртка как скользящее взвешенное окно.
// Сверху — сигнал и БЕГУЩЕЕ окно ядра; снизу — выход свёртки, который
// достраивается в точке окна. Тяни позицию окна по сигналу, выбирай ядро,
// перетаскивай сам сигнал (рисуй). Всё мгновенно, без кнопок.
SigmaInt.register("convolution-1d", function (root, opts, S) {
  const P = S.PALETTE;

  root.appendChild(S.el("div", "sigma-int-hint", {
    text: "Тяни окно ядра по сигналу — внизу видно, как выход в этой точке = взвешенная сумма под окном. Рисуй сам сигнал, двигая его мышью. Меняй ядро.",
  }));

  const stage = S.row(root);
  const W = 720, H = 420;
  const cv = S.makeCanvas(stage, W, H, { maxWidth: 720, pan: false });
  const ctx = cv.ctx;
  const controls = S.row(root, "controls");
  const out = S.readout(root);
  S.caption(root,
    "Свёртка $(x * k)[t] = \\sum_j x[t-j]\\,k[j]$ — это ядро, скользящее по сигналу: " +
    "в каждой точке берётся взвешенная сумма соседних отсчётов. Сглаживающее ядро " +
    "размывает, ядро-разность подсвечивает перепады (края), Гаусс мягко усредняет. " +
    "Так работает один канал свёрточной сети — только ядро там обучается.");

  const N = 96;            // длина сигнала
  const sig = new Float32Array(N);
  (function initSignal() {
    // ступенька + импульс + шум + плавный горб — богатый набор для демонстрации
    for (let i = 0; i < N; i++) {
      let v = 0;
      if (i > 20 && i < 45) v += 0.6;                       // ступенька
      v += 0.5 * Math.exp(-((i - 64) ** 2) / 18);           // горб
      if (i === 75) v += 0.8;                                // импульс
      sig[i] = v;
    }
  })();

  const KERNELS = {
    smooth: { label: "Сглаживание (box)", k: [1, 1, 1, 1, 1].map((v) => v / 5) },
    gauss: { label: "Гаусс", k: normalize([1, 4, 7, 4, 1]) },
    edge: { label: "Края (разность)", k: [-1, 0, 1] },
    sharpen: { label: "Резкость", k: [-0.5, 2, -0.5] },
  };
  function normalize(a) { const s = a.reduce((x, y) => x + y, 0); return a.map((v) => v / s); }
  let kkey = "smooth";
  let pos = 48; // позиция окна (центр) в отсчётах

  function kernel() { return KERNELS[kkey].k; }
  function half() { return (kernel().length - 1) / 2; }

  function convAt(t) {
    const k = kernel(), h = half(); let s = 0;
    for (let j = 0; j < k.length; j++) {
      const idx = t + (j - h);
      const xv = idx >= 0 && idx < N ? sig[idx] : 0;
      s += xv * k[k.length - 1 - j]; // корреляция по определению свёртки (отражённое ядро)
    }
    return s;
  }
  function fullConv() { const o = new Float32Array(N); for (let t = 0; t < N; t++) o[t] = convAt(t); return o; }

  // геометрия панелей
  const top = { x: 50, y: 36, w: W - 70, h: 150 };   // сигнал
  const bot = { x: 50, y: 246, w: W - 70, h: 150 };   // выход
  const xS = S.scale(0, N - 1, top.x, top.x + top.w);
  const yTop = S.scale(-0.6, 1.6, top.y + top.h, top.y);

  function panel(box, title) {
    ctx.strokeStyle = P.axis; ctx.lineWidth = 1;
    const y0 = box === top ? yTop(0) : yBot(0);
    ctx.beginPath(); ctx.moveTo(box.x, box.y); ctx.lineTo(box.x, box.y + box.h);
    ctx.moveTo(box.x, y0); ctx.lineTo(box.x + box.w, y0); ctx.stroke();
    ctx.fillStyle = P.mut; ctx.font = "12px Palatino, Georgia, serif"; ctx.textAlign = "left";
    ctx.fillText(title, box.x, box.y - 8);
  }
  let yBot = S.scale(-1, 1.6, bot.y + bot.h, bot.y);

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const o = fullConv();
    let omin = Infinity, omax = -Infinity;
    for (const v of o) { if (v < omin) omin = v; if (v > omax) omax = v; }
    omin = Math.min(omin, -0.2); omax = Math.max(omax, 0.6);
    yBot = S.scale(omin, omax, bot.y + bot.h, bot.y);

    panel(top, "сигнал x  +  окно ядра");
    panel(bot, "выход свёртки (x ∗ k)");

    const h = half();
    // подсветка окна под ядром (на сигнале)
    const x0 = xS(pos - h) - (xS(1) - xS(0)) / 2, x1 = xS(pos + h) + (xS(1) - xS(0)) / 2;
    ctx.fillStyle = "rgba(184,134,11,0.14)";
    ctx.fillRect(x0, top.y, x1 - x0, top.h);

    // сигнал (стебли + линия)
    ctx.strokeStyle = P.blue; ctx.lineWidth = 1.8; ctx.beginPath();
    for (let i = 0; i < N; i++) { const X = xS(i), Y = yTop(sig[i]); i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y); }
    ctx.stroke();

    // веса ядра поверх окна (золотые столбики, отражённые как в свёртке)
    const k = kernel();
    const kmax = Math.max.apply(null, k.map(Math.abs)) || 1;
    for (let j = 0; j < k.length; j++) {
      const idx = pos + (j - h);
      if (idx < 0 || idx >= N) continue;
      const X = xS(idx), wv = k[k.length - 1 - j];
      ctx.strokeStyle = P.gold; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(X, yTop(0)); ctx.lineTo(X, yTop(0) - (wv / kmax) * 36); ctx.stroke();
      ctx.fillStyle = P.gold; ctx.beginPath(); ctx.arc(X, yTop(0) - (wv / kmax) * 36, 2.5, 0, 2 * Math.PI); ctx.fill();
    }
    // вертикаль позиции окна
    ctx.strokeStyle = P.red; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(xS(pos), top.y); ctx.lineTo(xS(pos), bot.y + bot.h); ctx.stroke();
    ctx.setLineDash([]);

    // выход
    ctx.strokeStyle = P.green; ctx.lineWidth = 1.8; ctx.beginPath();
    for (let i = 0; i < N; i++) { const X = xS(i), Y = yBot(o[i]); i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y); }
    ctx.stroke();
    // точка выхода в позиции окна
    const ov = o[Math.round(pos)] || 0;
    ctx.fillStyle = P.red; ctx.beginPath(); ctx.arc(xS(pos), yBot(ov), 5, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = "#fffff8"; ctx.lineWidth = 1.5; ctx.stroke();

    out.set([
      { k: "ядро", v: KERNELS[kkey].label, color: P.gold },
      { k: "позиция t", v: String(Math.round(pos)), color: P.red },
      { k: "выход (x∗k)[t]", v: ov.toFixed(3), color: P.green },
      { k: "веса", v: "[" + k.map((v) => v.toFixed(2)).join(", ") + "]", color: P.mut },
    ]);
  }

  const redraw = S.rafThrottle(draw);

  // взаимодействие: тащить позицию окна (по верхней области) ИЛИ рисовать сигнал
  let mode = null; // "pos" | "draw"
  S.dragify(cv.canvas, { w: W, h: H }, {
    onDown: (p) => {
      // близко к красной вертикали или в нижней панели → двигаем позицию;
      // иначе в верхней панели → рисуем сигнал
      if (Math.abs(p.x - xS(pos)) < 14 || p.y > bot.y - 10) mode = "pos";
      else if (p.y < top.y + top.h + 10) mode = "draw";
      apply(p);
    },
    onMove: (p) => { if (mode) apply(p); },
    onUp: () => { mode = null; },
    onHover: (p) => { cv.canvas.style.cursor = (Math.abs(p.x - xS(pos)) < 14 || p.y > bot.y - 10) ? "ew-resize" : "crosshair"; },
  });
  function apply(p) {
    if (mode === "pos") {
      pos = Math.max(0, Math.min(N - 1, Math.round(xS.inv(p.x))));
    } else if (mode === "draw") {
      const i = Math.max(0, Math.min(N - 1, Math.round(xS.inv(p.x))));
      sig[i] = Math.max(-0.6, Math.min(1.6, yTop.inv(p.y)));
    }
    redraw();
  }

  // контролы
  S.select(controls, {
    label: "Ядро", value: kkey,
    options: Object.keys(KERNELS).map((kk) => ({ value: kk, label: KERNELS[kk].label })),
  }, (v) => { kkey = v; redraw(); });
  S.slider(controls, { label: "Позиция окна t", min: 0, max: N - 1, step: 1, value: pos, fmt: (v) => v | 0 },
    (v) => { pos = v | 0; redraw(); });
  S.button(controls, "Сбросить сигнал", () => {
    for (let i = 0; i < N; i++) {
      let v = 0;
      if (i > 20 && i < 45) v += 0.6;
      v += 0.5 * Math.exp(-((i - 64) ** 2) / 18);
      if (i === 75) v += 0.8;
      sig[i] = v;
    }
    redraw();
  }, "ghost");

  draw();
});
