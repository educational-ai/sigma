// loss-landscape-3d — поворачиваемая мышью 3D-поверхность потерь L(x,y).
// Перетаскивай = крути камеру (yaw/pitch). Ползунки меняют неровность и
// разрешение сетки. Клик по поверхности роняет шарик градиентного спуска,
// который катится в ближайший минимум. Чистый canvas-3D, без three.js.
// Никаких кнопок «Запустить»: всё пересчитывается мгновенно в браузере.
SigmaInt.register("loss-landscape-3d", function (root, opts, S) {
  const P = S.PALETTE;

  root.appendChild(S.el("div", "sigma-int-hint", {
    text: "Тяни по поверхности — крути камеру. Кликни по ней — уронишь шарик градиентного спуска, он скатится в ближайший минимум.",
  }));

  const stage = S.row(root);
  const W = 760, H = 440;
  const cv = S.makeCanvas(stage, W, H, { maxWidth: 760, pan: false });
  const ctx = cv.ctx;

  const controls = S.row(root, "controls");
  const out = S.readout(root);
  S.caption(root,
    "Поверхность z = L(x, y) — двумерный срез ландшафта потерь. " +
    "Это лишь одна проекция из бесконечного числа возможных: в реальной сети " +
    "минимумы редки, а седловины (плоско вдоль одних направлений, круто вдоль других) " +
    "встречаются на порядки чаще. Покрути камеру, чтобы увидеть рельеф со всех сторон.");

  // ----------------------------------------------------------- состояние
  let yaw = -0.7, pitch = 0.62;     // углы камеры (радианы)
  let surface = "gaussians";        // тип ландшафта
  let rough = 1.0;                  // масштаб неровности
  let res = 40;                     // разрешение сетки (точек на сторону)
  const DOM = 2.6;                  // полудиапазон по x,y

  // случайные «ямы» для режима gaussians — детерминированы один раз
  const wells = [
    { x: -1.3, y: -0.9, d: 1.7, w: 0.9 },
    { x:  1.1, y:  1.3, d: 1.3, w: 0.7 },
    { x:  1.4, y: -1.2, d: 1.0, w: 0.55 },
    { x: -1.0, y:  1.4, d: 0.9, w: 0.6 },
    { x:  0.1, y:  0.0, d: 0.7, w: 0.5 },
    { x: -1.8, y:  0.3, d: 0.8, w: 0.5 },
  ];

  // ----------------------------------------------------------- функции L
  function L(x, y) {
    let z;
    if (surface === "gaussians") {
      z = 1.2;
      for (const g of wells) {
        const dx = x - g.x, dy = y - g.y;
        z -= g.d * Math.exp(-(dx * dx + dy * dy) / (2 * g.w * g.w));
      }
      // лёгкая чаша, чтобы края загибались вверх
      z += 0.06 * (x * x + y * y);
    } else if (surface === "saddle") {
      z = 0.45 * (x * x - y * y);
    } else { // rosenbrock (масштабированный, чтобы влезал)
      const a = 1, b = 12;
      z = ((a - x) * (a - x) + b * (y - x * x) * (y - x * x)) * 0.06;
    }
    // мелкая «рябь» оптимизационного шума, управляемая ползунком
    z += rough * 0.16 * (Math.sin(2.7 * x + 0.5) * Math.cos(2.3 * y - 0.3)
                       + 0.5 * Math.sin(4.1 * x - 1.0) * Math.cos(3.7 * y + 0.7));
    return z;
  }

  // численный градиент (для шарика)
  function grad(x, y) {
    const h = 1e-3;
    return [
      (L(x + h, y) - L(x - h, y)) / (2 * h),
      (L(x, y + h) - L(x, y - h)) / (2 * h),
    ];
  }

  // ----------------------------------------------------------- 3D → 2D
  // нормировка z в [0..1] вычисляется по выборке сетки на каждый кадр
  let zMin = 0, zMax = 1;
  const Z_VIS = 1.4; // вертикальный масштаб поверхности в мировых единицах

  // проекция мировой точки (wx,wy,wz) с центрированием куба [-1,1]^3-ish
  function project(wx, wy, wz) {
    // вращение вокруг оси Z (yaw), затем наклон (pitch)
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    // yaw в плоскости xy
    let X = wx * cy - wy * sy;
    let Y = wx * sy + wy * cy;
    let Zc = wz;
    // pitch: наклоняем (y,z)
    const Y2 = Y * cp - Zc * sp;
    const Z2 = Y * sp + Zc * cp;
    // ортографическая проекция с лёгкой перспективой по глубине
    const persp = 1 / (1 + 0.12 * (Y2 + 2.2));
    const scale = 132 * persp;
    return {
      sx: W * 0.5 + X * scale,
      sy: H * 0.52 - Z2 * scale * 0.95 + Y2 * scale * 0.18,
      depth: Y2, // больше = дальше (для сортировки)
    };
  }

  // мир: x,y в [-1,1] (нормированные от DOM), z в [-1,1] (нормированный L)
  function world(ix, iy, n) {
    const x = (ix / (n - 1)) * 2 - 1;       // [-1,1]
    const y = (iy / (n - 1)) * 2 - 1;
    return { x, y };
  }
  function worldZ(zval) {
    const t = (zval - zMin) / (zMax - zMin || 1); // 0..1
    return (t * 2 - 1) * (Z_VIS * 0.5);
  }

  // цвет грани по высоте (coolwarm: синий низ → жёлтый/красный верх)
  function heightColor(t, shade) {
    // t в [0,1]; распределённая палитра в духе coolwarm/viridis
    t = Math.max(0, Math.min(1, t));
    let r, g, b;
    if (t < 0.5) {
      const u = t / 0.5;
      r = 31 + (46 - 31) * u; g = 78 + (125 - 78) * u; b = 121 + (91 - 121) * u;
    } else {
      const u = (t - 0.5) / 0.5;
      r = 46 + (192 - 46) * u; g = 125 + (57 - 125) * u; b = 91 + (43 - 91) * u;
    }
    const s = shade; // 0.55..1.1 затенение по нормали
    r = Math.max(0, Math.min(255, r * s));
    g = Math.max(0, Math.min(255, g * s));
    b = Math.max(0, Math.min(255, b * s));
    return "rgb(" + (r | 0) + "," + (g | 0) + "," + (b | 0) + ")";
  }

  // ----------------------------------------------------------- шарик
  let ball = null; // {x,y,vx,vy} в координатах DOM
  function dropBall(wx, wy) {
    ball = { x: wx, y: wy, vx: 0, vy: 0, age: 0 };
  }
  function stepBall(dt) {
    if (!ball) return;
    const lr = 0.12, friction = 0.82;
    const g = grad(ball.x, ball.y);
    ball.vx = ball.vx * friction - lr * g[0];
    ball.vy = ball.vy * friction - lr * g[1];
    ball.x += ball.vx;
    ball.y += ball.vy;
    // удерживаем в области
    ball.x = Math.max(-DOM, Math.min(DOM, ball.x));
    ball.y = Math.max(-DOM, Math.min(DOM, ball.y));
    ball.age += dt;
  }

  // нормированные x,y (DOM) → world [-1,1]
  const toWorld = (v) => v / DOM;

  // ----------------------------------------------------------- отрисовка
  function computeZRange(n) {
    let mn = Infinity, mx = -Infinity;
    for (let iy = 0; iy < n; iy++) {
      for (let ix = 0; ix < n; ix++) {
        const w = world(ix, iy, n);
        const z = L(w.x * DOM, w.y * DOM);
        if (z < mn) mn = z; if (z > mx) mx = z;
      }
    }
    zMin = mn; zMax = mx;
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const n = res;
    computeZRange(n);

    // предвычислить сетку проекций
    const grid = new Array(n);
    for (let iy = 0; iy < n; iy++) {
      grid[iy] = new Array(n);
      for (let ix = 0; ix < n; ix++) {
        const w = world(ix, iy, n);
        const zval = L(w.x * DOM, w.y * DOM);
        const wz = worldZ(zval);
        const p = project(w.x, w.y, wz);
        grid[iy][ix] = { p, zval, wz, wx: w.x, wy: w.y };
      }
    }

    // собрать грани (квады) и отсортировать по глубине (painter's algorithm)
    const faces = [];
    for (let iy = 0; iy < n - 1; iy++) {
      for (let ix = 0; ix < n - 1; ix++) {
        const a = grid[iy][ix], b = grid[iy][ix + 1],
              c = grid[iy + 1][ix + 1], d = grid[iy + 1][ix];
        const depth = (a.p.depth + b.p.depth + c.p.depth + d.p.depth) / 4;
        const zAvg = (a.zval + b.zval + c.zval + d.zval) / 4;
        // нормаль для затенения: через высоты соседей
        const du = b.wz - a.wz, dv = d.wz - a.wz;
        // псевдо-нормаль; больше наклон → темнее
        const slope = Math.sqrt(du * du + dv * dv);
        const shade = 1.05 - Math.min(0.5, slope * 1.6);
        faces.push({ a, b, c, d, depth, zAvg, shade });
      }
    }
    faces.sort((f1, f2) => f2.depth - f1.depth); // дальние сначала

    // рисуем грани
    for (const f of faces) {
      const t = (f.zAvg - zMin) / (zMax - zMin || 1);
      ctx.fillStyle = heightColor(t, f.shade);
      ctx.strokeStyle = "rgba(40,40,30,0.18)";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(f.a.p.sx, f.a.p.sy);
      ctx.lineTo(f.b.p.sx, f.b.p.sy);
      ctx.lineTo(f.c.p.sx, f.c.p.sy);
      ctx.lineTo(f.d.p.sx, f.d.p.sy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // оси-подписи (плавающие угловые метки)
    drawAxisHints(n, grid);

    // шарик + его след
    if (ball) drawBall();

    // read-out
    out.set([
      { k: "yaw", v: (yaw * 180 / Math.PI).toFixed(0) + "°", color: P.blue },
      { k: "pitch", v: (pitch * 180 / Math.PI).toFixed(0) + "°", color: P.blue },
      { k: "min L", v: zMin.toFixed(3), color: P.green },
      { k: "max L", v: zMax.toFixed(3), color: P.red },
      ball
        ? { k: "шарик L", v: L(ball.x, ball.y).toFixed(3), color: P.gold }
        : { k: "шарик", v: "клик по поверхности", color: P.mut },
    ]);
  }

  function drawAxisHints(n, grid) {
    ctx.font = "13px Palatino, Georgia, serif";
    ctx.fillStyle = P.mut;
    ctx.textAlign = "center";
    // углы основания: (ix,iy) = (0,0),(n-1,0),(0,n-1)
    const c00 = grid[0][0].p, cN0 = grid[0][n - 1].p, c0N = grid[n - 1][0].p;
    // подпись α по ребру вдоль x, β вдоль y
    ctx.fillText("α (направление 1)", (cN0.sx + c00.sx) / 2, (cN0.sy + c00.sy) / 2 + 18);
    ctx.fillText("β (направление 2)", (c0N.sx + c00.sx) / 2 - 6, (c0N.sy + c00.sy) / 2 + 6);
  }

  function drawBall() {
    const wz = worldZ(L(ball.x, ball.y)) + 0.06; // чуть над поверхностью
    const p = project(toWorld(ball.x), toWorld(ball.y), wz);
    // тень на «дне»
    const sh = project(toWorld(ball.x), toWorld(ball.y), -Z_VIS * 0.5);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath(); ctx.ellipse(sh.sx, sh.sy, 5, 2.4, 0, 0, 2 * Math.PI); ctx.fill();
    // шарик
    const r = 7;
    const grd = ctx.createRadialGradient(p.sx - 2, p.sy - 2, 1, p.sx, p.sy, r);
    grd.addColorStop(0, "#fff");
    grd.addColorStop(1, P.gold);
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(p.sx, p.sy, r, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = "rgba(80,60,0,0.6)"; ctx.lineWidth = 1; ctx.stroke();
  }

  const redraw = S.rafThrottle(draw);

  // ----------------------------------------------------------- интеракция
  // различаем поворот и клик: маленькое смещение = клик (роняем шарик)
  let downPt = null, moved = 0;
  S.dragify(cv.canvas, { w: 1, h: 1 }, {
    onDown: (p) => { downPt = p; moved = 0; },
    onMove: (p) => {
      if (!downPt) return;
      const dx = p.px - downPt.px, dy = p.py - downPt.py;
      moved += Math.abs(dx) + Math.abs(dy);
      yaw -= dx * 3.0;
      pitch += dy * 2.4;
      pitch = Math.max(0.08, Math.min(1.45, pitch));
      downPt = p;
      redraw();
    },
    onUp: () => {
      // клик без заметного движения → попытаться уронить шарик
      if (downPt && moved < 0.012) dropFromScreen(downPt);
      downPt = null;
    },
  });

  // экранная точка (нормированная px,py) → ближайшая (x,y) сетки в DOM-координатах
  function dropFromScreen(p) {
    const sx = p.px * W, sy = p.py * H;
    const n = res;
    let best = Infinity, bx = 0, by = 0;
    for (let iy = 0; iy < n; iy += 1) {
      for (let ix = 0; ix < n; ix += 1) {
        const w = world(ix, iy, n);
        const wz = worldZ(L(w.x * DOM, w.y * DOM));
        const pr = project(w.x, w.y, wz);
        const dd = (pr.sx - sx) * (pr.sx - sx) + (pr.sy - sy) * (pr.sy - sy);
        if (dd < best) { best = dd; bx = w.x * DOM; by = w.y * DOM; }
      }
    }
    if (best < 60 * 60) { dropBall(bx, by); }
  }

  // непрерывная анимация шарика (только когда он есть и ещё движется)
  S.loop((t, ts, dt) => {
    if (ball) {
      stepBall(1);
      const speed = Math.hypot(ball.vx, ball.vy);
      redraw();
      if (speed < 1e-4 && ball.age > 0.5) { /* успокоился — продолжаем рисовать статично */ }
    }
  }).start();

  // ----------------------------------------------------------- контролы
  S.segmented(controls, {
    label: "Ландшафт",
    value: "gaussians",
    options: [
      { value: "gaussians", label: "много ям" },
      { value: "saddle", label: "седло" },
      { value: "rosenbrock", label: "Розенброк" },
    ],
  }, (v) => { surface = v; ball = null; redraw(); });

  S.slider(controls, {
    label: "Неровность (шум)", min: 0, max: 2, step: 0.05, value: rough,
    fmt: (v) => v.toFixed(2),
  }, (v) => { rough = v; redraw(); });

  S.slider(controls, {
    label: "Разрешение сетки", min: 16, max: 64, step: 2, value: res,
    fmt: (v) => v + "×" + v,
  }, (v) => { res = v | 0; redraw(); });

  // мгновенная первая отрисовка
  draw();
});
