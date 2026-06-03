// mds-relax — живой MDS: набор «истинных» точек задаёт целевую матрицу
// попарных расстояний D. Случайный эмбеддинг НЕПРЕРЫВНО релаксирует к D,
// минимизируя стресс σ=Σ(||yi-yj||-Dij)². Точки можно перетаскивать —
// система выводится из равновесия и снова сходится. Сравниваются два метода:
// градиентный (первый порядок) и безградиентный (случайные пробы). Никакой
// кнопки «Запустить» — анимация и пересчёт идут постоянно.
SigmaInt.register("mds-relax", function (root, opts, S) {
  const P = S.PALETTE;

  root.appendChild(S.el("div", "sigma-int-hint", {
    text: "Точки релаксируют сами: эмбеддинг сходится к целевой геометрии. " +
      "Перетащи любую точку — и смотри, как стресс снова падает. Переключи метод и сравни скорость.",
  }));

  const stage = S.row(root);
  // левая панель — эмбеддинг (квадрат), правая — кривая стресса
  const W = 760, H = 380;
  const cv = S.makeCanvas(stage, W, H, { maxWidth: 760, pan: false });
  const ctx = cv.ctx;

  const controls = S.row(root, "controls");
  const out = S.readout(root);
  S.caption(root,
    "Слева — текущий эмбеддинг (его двигаем), серым показана цель (с точностью до поворота/отражения). " +
    "Справа — стресс σ во времени в лог-шкале. Градиентный метод срывается вниз за десятки шагов; " +
    "безградиентный (случайные пробы) сходится заметно медленнее.");

  // --- геометрия панелей (логические координаты 760×380) ---
  const plot = { x: 30, y: 30, w: 330, h: 330 };          // эмбеддинг
  const curve = { x: 430, y: 30, w: 300, h: 330 };        // кривая стресса

  // ---------- модель ----------
  let N = 8;            // число точек
  let lr = 0.05;        // скорость / размер шага
  let method = "grad";  // "grad" | "zero"

  let truth = [];       // «истинные» координаты (для отрисовки цели и D)
  let D = [];           // целевая матрица расстояний
  let Y = [];           // текущий эмбеддинг [{x,y}]
  let dragIdx = -1;     // индекс перетаскиваемой точки
  let iter = 0;
  let histGrad = [];    // история стресса градиентного метода
  let histZero = [];    // история стресса безградиентного метода
  const HIST_MAX = 240;

  function rnd(a, b) { return a + Math.random() * (b - a); }

  // расстояние с защитой от деления на ноль
  function dist(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy) || 1e-9;
  }

  // целевая геометрия: точки по кругу + лёгкий шум — стабильная, узнаваемая форма
  function buildTruth(n) {
    truth = [];
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      truth.push({ x: Math.cos(a) + rnd(-0.12, 0.12), y: Math.sin(a) + rnd(-0.12, 0.12) });
    }
    // целевая матрица расстояний
    D = [];
    for (let i = 0; i < n; i++) {
      D[i] = [];
      for (let j = 0; j < n; j++) D[i][j] = i === j ? 0 : dist(truth[i], truth[j]);
    }
  }

  function buildEmbedding(n) {
    Y = [];
    for (let i = 0; i < n; i++) Y.push({ x: rnd(-1.2, 1.2), y: rnd(-1.2, 1.2) });
  }

  function reset(n) {
    N = n;
    buildTruth(n);
    buildEmbedding(n);
    iter = 0;
    histGrad = [];
    histZero = [];
  }

  // стресс σ = Σ_{i<j} (||yi-yj|| - Dij)²
  function stressOf(pts) {
    let s = 0;
    for (let i = 0; i < N; i++)
      for (let j = i + 1; j < N; j++) {
        const e = dist(pts[i], pts[j]) - D[i][j];
        s += e * e;
      }
    return s;
  }

  // один шаг градиентного спуска (первый порядок)
  function stepGrad() {
    const gx = new Array(N).fill(0), gy = new Array(N).fill(0);
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        if (i === j) continue;
        const dx = Y[i].x - Y[j].x, dy = Y[i].y - Y[j].y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1e-9;
        // dσ/dyi от пары (i,j): 2(d - Dij) * (yi-yj)/d  (учитываем оба порядка → коэф 2)
        const c = 2 * (d - D[i][j]) / d;
        gx[i] += c * dx;
        gy[i] += c * dy;
      }
    }
    for (let i = 0; i < N; i++) {
      if (i === dragIdx) continue;       // перетаскиваемую точку не двигаем
      Y[i].x -= lr * gx[i];
      Y[i].y -= lr * gy[i];
    }
  }

  // один шаг безградиентного метода: двухточечная случайная проба (ZO-GD).
  // Берём случайное направление u, оцениваем (f(Y+μu)-f(Y-μu))/(2μ) как градиент.
  function stepZero() {
    const mu = 0.08;
    // случайное направление по всем координатам (2N-мерное)
    const u = [];
    let nrm = 0;
    for (let i = 0; i < 2 * N; i++) { const r = rnd(-1, 1); u.push(r); nrm += r * r; }
    nrm = Math.sqrt(nrm) || 1e-9;
    for (let i = 0; i < 2 * N; i++) u[i] /= nrm;

    const plus = Y.map((p, i) => ({ x: p.x + mu * u[2 * i], y: p.y + mu * u[2 * i + 1] }));
    const minus = Y.map((p, i) => ({ x: p.x - mu * u[2 * i], y: p.y - mu * u[2 * i + 1] }));
    const g = (stressOf(plus) - stressOf(minus)) / (2 * mu); // скалярная оценка вдоль u
    // шаг масштабируем размерностью — честно отражает «проклятие размерности»
    const step = lr * g * N;
    for (let i = 0; i < N; i++) {
      if (i === dragIdx) continue;
      Y[i].x -= step * u[2 * i];
      Y[i].y -= step * u[2 * i + 1];
    }
  }

  // несколько микрошагов за кадр — чтобы движение было живым, но плавным
  function advance() {
    const sub = method === "grad" ? 1 : 3; // безградиентному даём больше проб
    for (let s = 0; s < sub; s++) {
      if (method === "grad") stepGrad(); else stepZero();
      iter++;
    }
    const st = stressOf(Y);
    const h = method === "grad" ? histGrad : histZero;
    h.push(st);
    if (h.length > HIST_MAX) h.shift();
    return st;
  }

  // ---------- отрисовка ----------
  // авто-масштаб эмбеддинга, чтобы всё помещалось в панель
  function dataExtent() {
    let mn = -1.5, mx = 1.5;
    for (const p of Y.concat(truth)) {
      mn = Math.min(mn, p.x, p.y);
      mx = Math.max(mx, p.x, p.y);
    }
    const pad = 0.15 * (mx - mn || 1);
    return [mn - pad, mx + pad];
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    const [d0, d1] = dataExtent();
    const sx = S.scale(d0, d1, plot.x, plot.x + plot.w);
    const sy = S.scale(d0, d1, plot.y + plot.h, plot.y); // y вверх

    // рамка панели эмбеддинга
    ctx.strokeStyle = P.grid; ctx.lineWidth = 1;
    ctx.strokeRect(plot.x + 0.5, plot.y + 0.5, plot.w, plot.h);
    ctx.fillStyle = P.mut; ctx.font = "12px Palatino, Georgia, serif"; ctx.textAlign = "left";
    ctx.fillText("Эмбеддинг (тяни точки)", plot.x, plot.y - 10);

    // целевые точки (серый ореол) — для интуиции «куда сходимся»
    ctx.fillStyle = "#cfc9b6";
    for (const p of truth) {
      ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), 4, 0, 2 * Math.PI); ctx.fill();
    }

    // рёбра эмбеддинга, окрашенные по знаку ошибки ||y||-D
    for (let i = 0; i < N; i++)
      for (let j = i + 1; j < N; j++) {
        const e = dist(Y[i], Y[j]) - D[i][j];
        const a = Math.min(0.5, Math.abs(e) * 0.6);
        ctx.strokeStyle = (e > 0 ? "192,57,43" : "31,78,121"); // red / blue rgb
        ctx.strokeStyle = "rgba(" + (e > 0 ? "192,57,43" : "31,78,121") + "," + a.toFixed(3) + ")";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(sx(Y[i].x), sy(Y[i].y)); ctx.lineTo(sx(Y[j].x), sy(Y[j].y)); ctx.stroke();
      }

    // точки эмбеддинга
    for (let i = 0; i < N; i++) {
      const X = sx(Y[i].x), Yp = sy(Y[i].y);
      ctx.fillStyle = i === dragIdx ? P.gold : P.blue;
      ctx.beginPath(); ctx.arc(X, Yp, i === dragIdx ? 8 : 6, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = P.bg;
      ctx.font = "10px Palatino, serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), X, Yp);
      ctx.textBaseline = "alphabetic";
    }

    // ---------- кривая стресса ----------
    ctx.strokeStyle = P.grid; ctx.lineWidth = 1;
    ctx.strokeRect(curve.x + 0.5, curve.y + 0.5, curve.w, curve.h);
    ctx.fillStyle = P.mut; ctx.font = "12px Palatino, Georgia, serif"; ctx.textAlign = "left";
    ctx.fillText("Стресс σ(t), лог-шкала", curve.x, curve.y - 10);

    // подпись оси x
    ctx.fillStyle = P.mut; ctx.font = "11px Palatino, Georgia, serif"; ctx.textAlign = "center";
    ctx.fillText("итерация t", curve.x + curve.w / 2, curve.y + curve.h + 18);

    if (histGrad.length > 1 || histZero.length > 1) {
      // лог-шкала по y по объединению обеих историй
      let lo = Infinity, hi = -Infinity;
      for (const v of histGrad.concat(histZero)) {
        const lv = Math.log10(Math.max(v, 1e-6));
        if (lv < lo) lo = lv; if (lv > hi) hi = lv;
      }
      if (hi - lo < 1.0) { hi += 0.5; lo -= 0.5; }
      const span = Math.max(20, histGrad.length, histZero.length) - 1;
      const tx = S.scale(0, span, curve.x, curve.x + curve.w);
      const ty = S.scale(lo, hi, curve.y + curve.h, curve.y);

      // горизонтальные грид-линии по степеням 10
      ctx.fillStyle = P.mut; ctx.font = "10px Palatino, serif"; ctx.textAlign = "right";
      const loE = Math.floor(lo), hiE = Math.ceil(hi);
      for (let e = loE; e <= hiE; e++) {
        const y = ty(e);
        if (y < curve.y || y > curve.y + curve.h) continue;
        ctx.strokeStyle = P.grid; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(curve.x, y); ctx.lineTo(curve.x + curve.w, y); ctx.stroke();
        ctx.fillStyle = P.mut;
        ctx.fillText("10" + (e >= 0 ? "" : "⁻") + Math.abs(e), curve.x - 4, y + 3);
      }

      // числовые тики по оси x (0 … текущий span) — читаемый «стресс vs шаги».
      // края диапазона выровнены к панели (left/right), чтобы не наезжать
      // на центральную подпись «итерация t».
      ctx.fillStyle = P.mut; ctx.font = "10px Palatino, Georgia, serif";
      const tickY = curve.y + curve.h + 18;
      ctx.textAlign = "left";
      ctx.fillText("0", curve.x, tickY);
      ctx.textAlign = "right";
      ctx.fillText(String(span), curve.x + curve.w, tickY);
      ctx.textAlign = "center";

      // две кривые: grad (зелёная) и zero (фиолетовая); неактивная — с alpha 0.35
      const drawCurve = (hist, color, active) => {
        if (hist.length < 2) return;
        const off = Math.max(0, hist.length - HIST_MAX);
        ctx.globalAlpha = active ? 1 : 0.35;
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
        for (let i = off; i < hist.length; i++) {
          const X = tx(i - off), Yp = ty(Math.log10(Math.max(hist[i], 1e-6)));
          i === off ? ctx.moveTo(X, Yp) : ctx.lineTo(X, Yp);
        }
        ctx.stroke();
        // текущая точка
        const lastIdx = hist.length - 1;
        const lastX = tx(lastIdx - off);
        const lastY = ty(Math.log10(Math.max(hist[lastIdx], 1e-6)));
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(lastX, lastY, 3.5, 0, 2 * Math.PI); ctx.fill();
        ctx.globalAlpha = 1;
      };
      drawCurve(histGrad, P.green, method === "grad");
      drawCurve(histZero, P.purple, method === "zero");
    }
  }

  const redraw = S.rafThrottle(draw);

  function updateReadout(st) {
    out.set([
      { k: "метод", v: method === "grad" ? "градиентный" : "безградиентный",
        color: method === "grad" ? P.green : P.purple },
      { k: "точек N =", v: String(N), color: P.blue },
      { k: "итерация", v: String(iter), color: P.mut },
      { k: "стресс σ =", v: st.toFixed(3), color: P.red },
    ]);
  }

  // ---------- перетаскивание точек ----------
  function nearestIdx(p) {
    const [d0, d1] = dataExtent();
    const sx = S.scale(d0, d1, plot.x, plot.x + plot.w);
    const sy = S.scale(d0, d1, plot.y + plot.h, plot.y);
    let best = -1, bestD = 1e9;
    for (let i = 0; i < N; i++) {
      const dx = sx(Y[i].x) - p.x, dy = sy(Y[i].y) - p.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return bestD < 22 * 22 ? best : -1;
  }
  function setFromPointer(p) {
    if (dragIdx < 0) return;
    const [d0, d1] = dataExtent();
    const sx = S.scale(d0, d1, plot.x, plot.x + plot.w);
    const sy = S.scale(d0, d1, plot.y + plot.h, plot.y);
    Y[dragIdx].x = sx.inv(Math.max(plot.x, Math.min(plot.x + plot.w, p.x)));
    Y[dragIdx].y = sy.inv(Math.max(plot.y, Math.min(plot.y + plot.h, p.y)));
  }

  S.dragify(cv.canvas, { w: W, h: H }, {
    onDown: (p) => { dragIdx = nearestIdx(p); setFromPointer(p); },
    onMove: (p) => { setFromPointer(p); },
    onUp: () => { dragIdx = -1; },
  });

  // ---------- контролы ----------
  S.segmented(controls, {
    label: "Метод",
    value: "grad",
    options: [
      { value: "grad", label: "градиентный" },
      { value: "zero", label: "безградиентный" },
    ],
  }, (v) => { method = v; });

  S.slider(controls, {
    label: "Число точек N", min: 4, max: 16, step: 1, value: N, fmt: (v) => v | 0,
  }, (v) => { reset(v | 0); });

  S.slider(controls, {
    label: "Скорость / размер шага", min: 0.005, max: 0.15, step: 0.005, value: lr,
    fmt: (v) => v.toFixed(3),
  }, (v) => { lr = v; });

  // ---------- старт: немедленная инициализация + непрерывная анимация ----------
  reset(N);
  draw();

  S.loop(() => {
    const st = advance();
    updateReadout(st);
    redraw();
  }).start();
});
