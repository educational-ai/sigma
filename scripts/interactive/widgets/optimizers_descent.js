// optimizers-descent — гонка first-order методов по 2D-ландшафту потерь.
// Тяни точку старта — GD / Momentum / Adam стартуют оттуда и наперегонки катятся
// вниз живыми траекториями. Меняй learning rate, momentum β и сам ландшафт.
// Сердце курса оптимизации: видно, как momentum пробивает овраг, а Adam адаптируется.
SigmaInt.register("optimizers-descent", function (root, opts, S) {
  const P = S.PALETTE;

  root.appendChild(S.el("div", "sigma-int-hint", {
    text: "Тяни белую точку старта по карте — три метода побегут вниз из неё. Крути learning rate, β и выбирай ландшафт.",
  }));

  const stage = S.row(root);
  const W = 720, H = 460;
  const cv = S.makeCanvas(stage, W, H, { maxWidth: 720, pan: false });
  const ctx = cv.ctx;
  const controls = S.row(root, "controls");
  const out = S.readout(root);
  S.caption(root,
    "Карта высот — поверхность потерь L(x,y) (тёмное — дно). Градиентный спуск (синий) " +
    "медлит в оврагах; momentum (золотой) разгоняется вдоль дна и проскакивает; Adam " +
    "(зелёный) подстраивает шаг по координатам. Тяни старт, меняй шаг — и смотри, кто застрянет.");

  // ---------- ландшафты: f(x,y) и градиент ----------
  const SURFACES = {
    ravine: {
      label: "Овраг (плохо обусловлен)",
      f: (x, y) => 0.5 * (0.06 * x * x + 3.0 * y * y),
      g: (x, y) => [0.06 * x, 3.0 * y],
      min: [0, 0], dom: 6,
    },
    rosenbrock: {
      label: "Розенброк (банан)",
      f: (x, y) => { const a = 1 - x, b = y - x * x; return (a * a + 8 * b * b) * 0.04; },
      g: (x, y) => { const b = y - x * x; return [(-2 * (1 - x) - 32 * x * b) * 0.04, (16 * b) * 0.04]; },
      min: [1, 1], dom: 2.2,
    },
    saddle: {
      label: "Седло",
      f: (x, y) => 0.12 * (x * x - y * y) + 0.0008 * (x * x + y * y) * (x * x + y * y),
      g: (x, y) => {
        const r2 = x * x + y * y;
        return [0.24 * x + 0.0032 * x * r2, -0.24 * y + 0.0032 * y * r2];
      },
      min: [0, 0], dom: 6,
    },
    bumps: {
      label: "Много ям",
      f: (x, y) => {
        let s = 0.02 * (x * x + y * y);
        s -= 1.2 * Math.exp(-((x - 2) ** 2 + (y - 1.5) ** 2) / 1.2);
        s -= 1.0 * Math.exp(-((x + 2.2) ** 2 + (y + 1) ** 2) / 1.0);
        s -= 0.9 * Math.exp(-((x - 0.5) ** 2 + (y + 2.4) ** 2) / 0.9);
        return s;
      },
      g: (x, y) => {
        let gx = 0.04 * x, gy = 0.04 * y;
        const bump = (cx, cy, A, s) => {
          const e = A * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / s);
          gx -= e * (-2 * (x - cx) / s); gy -= e * (-2 * (y - cy) / s);
        };
        bump(2, 1.5, 1.2, 1.2); bump(-2.2, -1, 1.0, 1.0); bump(0.5, -2.4, 0.9, 0.9);
        return [gx, gy];
      },
      min: [2, 1.5], dom: 4.5,
    },
  };

  let surfKey = "ravine";
  let lr = 0.18, beta = 0.85;
  let start = { x: -4.2, y: 2.4 };

  // ---------- world↔pixel ----------
  let DOM = SURFACES[surfKey].dom;
  const cx = W / 2, cy = H / 2, SCALE = () => (Math.min(W, H) * 0.46) / DOM;
  const wx = (x) => cx + x * SCALE();
  const wy = (y) => cy - y * SCALE();
  const ix = (sx) => (sx - cx) / SCALE();
  const iy = (sy) => (cy - sy) / SCALE();

  // ---------- фон-карта высот (с контурными полосами) ----------
  let field = null, fieldKey = "";
  function buildField() {
    const surf = SURFACES[surfKey];
    const GW = 240, GH = Math.round(GW * H / W);
    const off = document.createElement("canvas");
    off.width = GW; off.height = GH;
    const octx = off.getContext("2d");
    const img = octx.createImageData(GW, GH);
    let lo = Infinity, hi = -Infinity;
    const vals = new Float32Array(GW * GH);
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const x = ix((i / (GW - 1)) * W), y = iy((j / (GH - 1)) * H);
      const v = surf.f(x, y); vals[j * GW + i] = v;
      if (v < lo) lo = v; if (v > hi) hi = v;
    }
    for (let p = 0; p < GW * GH; p++) {
      let t = (vals[p] - lo) / (hi - lo + 1e-9);
      t = Math.pow(t, 0.55);                  // подчёркиваем дно
      const band = (Math.sin(t * Math.PI * 9) * 0.5 + 0.5) * 0.10; // контурные полосы
      // террейн: дно тёмно-синее → верх тёплый песочный
      const r = 32 + t * 210 + band * 30;
      const g = 60 + t * 180 + band * 30;
      const b = 90 + (1 - t) * 110 - band * 20;
      img.data[p * 4] = r; img.data[p * 4 + 1] = g; img.data[p * 4 + 2] = b; img.data[p * 4 + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
    field = off; fieldKey = surfKey;
  }

  // ---------- оптимизаторы ----------
  function makeRunners() {
    const s = { x: start.x, y: start.y };
    return {
      gd: { x: s.x, y: s.y, path: [[s.x, s.y]], color: P.blue, label: "GD" },
      mom: { x: s.x, y: s.y, vx: 0, vy: 0, path: [[s.x, s.y]], color: P.gold, label: "momentum" },
      adam: { x: s.x, y: s.y, mx: 0, my: 0, vx: 0, vy: 0, t: 0, path: [[s.x, s.y]], color: P.green, label: "Adam" },
    };
  }
  let R = makeRunners();

  function clampDom(o) {
    const lim = DOM * 1.3;
    o.x = Math.max(-lim, Math.min(lim, o.x));
    o.y = Math.max(-lim, Math.min(lim, o.y));
  }

  function step() {
    const surf = SURFACES[surfKey];
    // GD
    {
      const [gx, gy] = surf.g(R.gd.x, R.gd.y);
      R.gd.x -= lr * gx; R.gd.y -= lr * gy; clampDom(R.gd);
      if (R.gd.path.length < 4000) R.gd.path.push([R.gd.x, R.gd.y]);
    }
    // momentum
    {
      const [gx, gy] = surf.g(R.mom.x, R.mom.y);
      R.mom.vx = beta * R.mom.vx - lr * gx; R.mom.vy = beta * R.mom.vy - lr * gy;
      R.mom.x += R.mom.vx; R.mom.y += R.mom.vy; clampDom(R.mom);
      if (R.mom.path.length < 4000) R.mom.path.push([R.mom.x, R.mom.y]);
    }
    // Adam
    {
      const a = R.adam, b1 = 0.9, b2 = 0.999, eps = 1e-8, alpha = lr * 1.6;
      const [gx, gy] = surf.g(a.x, a.y); a.t++;
      a.mx = b1 * a.mx + (1 - b1) * gx; a.my = b1 * a.my + (1 - b1) * gy;
      a.vx = b2 * a.vx + (1 - b2) * gx * gx; a.vy = b2 * a.vy + (1 - b2) * gy * gy;
      const mhx = a.mx / (1 - Math.pow(b1, a.t)), mhy = a.my / (1 - Math.pow(b1, a.t));
      const vhx = a.vx / (1 - Math.pow(b2, a.t)), vhy = a.vy / (1 - Math.pow(b2, a.t));
      a.x -= alpha * mhx / (Math.sqrt(vhx) + eps); a.y -= alpha * mhy / (Math.sqrt(vhy) + eps);
      clampDom(a);
      if (a.path.length < 4000) a.path.push([a.x, a.y]);
    }
  }

  function drawPath(o) {
    ctx.strokeStyle = o.color; ctx.lineWidth = 2; ctx.globalAlpha = 0.9;
    ctx.beginPath();
    o.path.forEach((p, i) => { const X = wx(p[0]), Y = wy(p[1]); i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y); });
    ctx.stroke(); ctx.globalAlpha = 1;
    const X = wx(o.x), Y = wy(o.y);
    ctx.fillStyle = o.color; ctx.beginPath(); ctx.arc(X, Y, 5, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = "#fffff8"; ctx.lineWidth = 1.5; ctx.stroke();
  }

  function draw() {
    if (fieldKey !== surfKey || !field) buildField();
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(field, 0, 0, W, H);

    // минимум
    const surf = SURFACES[surfKey];
    const mX = wx(surf.min[0]), mY = wy(surf.min[1]);
    ctx.strokeStyle = "#fffff8"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(mX - 6, mY); ctx.lineTo(mX + 6, mY); ctx.moveTo(mX, mY - 6); ctx.lineTo(mX, mY + 6); ctx.stroke();

    drawPath(R.gd); drawPath(R.mom); drawPath(R.adam);

    // точка старта (ручка)
    const sX = wx(start.x), sY = wy(start.y);
    ctx.fillStyle = "#fffff8"; ctx.strokeStyle = P.ink; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sX, sY, 7, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    ctx.fillStyle = P.ink; ctx.font = "12px Palatino, Georgia, serif"; ctx.textAlign = "center";
    ctx.fillText("старт", sX, sY - 14);

    // легенда
    ctx.textAlign = "left"; ctx.font = "12px Palatino, Georgia, serif";
    let ly = 20;
    [R.gd, R.mom, R.adam].forEach((o) => {
      ctx.fillStyle = o.color; ctx.beginPath(); ctx.arc(20, ly - 4, 5, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = "#fffff8"; ctx.fillRect(30, ly - 11, 96, 15);
      ctx.fillStyle = P.ink; ctx.fillText(o.label, 32, ly);
      ly += 19;
    });

    out.set([
      { k: "ландшафт", v: surf.label, color: P.mut },
      { k: "L(GD)", v: surf.f(R.gd.x, R.gd.y).toFixed(3), color: P.blue },
      { k: "L(momentum)", v: surf.f(R.mom.x, R.mom.y).toFixed(3), color: P.gold },
      { k: "L(Adam)", v: surf.f(R.adam.x, R.adam.y).toFixed(3), color: P.green },
      { k: "шагов", v: String(R.gd.path.length - 1), color: P.mut },
    ]);
  }

  function reset() { R = makeRunners(); }

  // ---------- анимация ----------
  let frame = 0;
  const anim = S.loop(() => {
    // несколько шагов за кадр, пока траектории не «успокоились»
    const moved = Math.abs(R.gd.path.length) < 4000;
    if (moved) for (let s = 0; s < 2; s++) step();
    draw();
    frame++;
  });

  // ---------- перетаскивание старта ----------
  let dragging = false;
  S.dragify(cv.canvas, { w: W, h: H }, {
    onDown: (p) => {
      const sX = wx(start.x), sY = wy(start.y);
      if (Math.hypot(p.x - sX, p.y - sY) < 28) { dragging = true; setStart(p); }
      else { setStart(p); }  // клик в любом месте тоже переносит старт
    },
    onMove: (p) => { if (dragging) setStart(p); },
    onUp: () => { dragging = false; },
    onHover: (p) => {
      const sX = wx(start.x), sY = wy(start.y);
      cv.canvas.style.cursor = Math.hypot(p.x - sX, p.y - sY) < 28 ? "grab" : "crosshair";
    },
  });
  function setStart(p) {
    const lim = DOM * 1.25;
    start = { x: Math.max(-lim, Math.min(lim, ix(p.x))), y: Math.max(-lim, Math.min(lim, iy(p.y))) };
    reset();
  }

  // ---------- контролы ----------
  S.select(controls, {
    label: "Ландшафт", value: surfKey,
    options: Object.keys(SURFACES).map((k) => ({ value: k, label: SURFACES[k].label })),
  }, (v) => { surfKey = v; DOM = SURFACES[surfKey].dom; field = null; reset(); });
  S.slider(controls, { label: "Learning rate", min: 0.01, max: 0.6, step: 0.01, value: lr, fmt: (v) => v.toFixed(2) },
    (v) => { lr = v; reset(); });
  S.slider(controls, { label: "Momentum β", min: 0, max: 0.97, step: 0.01, value: beta, fmt: (v) => v.toFixed(2) },
    (v) => { beta = v; reset(); });
  S.button(controls, "Перезапустить", () => reset(), "ghost");

  draw();
  anim.start();
});
