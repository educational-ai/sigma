// optimal-transport — дешевле всего перевезти одну «кучу массы» в другую.
// Классическая транспортная задача (Монж–Канторович): найти план перевозки
// P (сколько массы из источника i едет в сток j), минимизирующий суммарную
// стоимость Σ P_ij·‖x_i−y_j‖². Это линейная программа; её энтропийное
// сглаживание решается Синкхорном за десяток умножений матриц. Стоимость
// оптимального плана — расстояние Вассерштейна, метрика между распределениями
// (Wasserstein GAN, диффузия, сравнение гистограмм). Тяни регуляризацию ε.
SigmaInt.register("optimal-transport", function (root, opts, S) {
  const P = S.PALETTE;

  root.appendChild(S.el("div", "sigma-int-hint", {
    text: "Синие источники нужно перевезти в красные стоки с минимальной суммарной стоимостью " +
      "(стоимость = квадрат расстояния). Линии показывают план перевозки, толщина ∝ перевозимой массе. " +
      "Тяни ε: при малом ε план резкий (каждый источник → почти один сток, как в ЛП), при большом " +
      "масса размазывается. Тяни точки. Стоимость плана это расстояние Вассерштейна.",
  }));

  const stage = S.row(root);
  const W = 640, H = 420;
  const cv = S.makeCanvas(stage, W, H, { maxWidth: 640, pan: false });
  const ctx = cv.ctx;
  const controls = S.row(root, "controls");
  const out = S.readout(root);
  S.caption(root,
    "Транспортная задача это линейная программа: минимизировать $\\sum_{ij} P_{ij} C_{ij}$ при " +
    "фиксированных суммах по строкам и столбцам ($P\\mathbf 1=a$, $P^\\top\\mathbf 1=b$). " +
    "Энтропийная регуляризация $-\\varepsilon H(P)$ делает её гладкой, и решение даёт алгоритм Синкхорна: " +
    "поочерёдная нормировка строк и столбцов матрицы $K_{ij}=e^{-C_{ij}/\\varepsilon}$. При $\\varepsilon\\to0$ " +
    "план стремится к резкому ЛП-оптимуму, при больших $\\varepsilon$ к размазанному. Стоимость плана это " +
    "расстояние Вассерштейна $W_2^2$: метрика, которая «чувствует» геометрию, в отличие от поэлементных " +
    "сравнений. На ней стоят Wasserstein GAN, сравнение распределений и оптимально-транспортная диффузия.");

  const n = 7, m = 7;
  let eps = 0.05, seed = 3;
  let src = null, dst = null, P2 = null, cost = 0;

  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  function genData() {
    const r = mulberry32(seed);
    // источники — слева-снизу облако, стоки — справа-сверху облако
    src = []; dst = [];
    for (let i = 0; i < n; i++) src.push([0.15 + r() * 0.32, 0.12 + r() * 0.5]);
    for (let j = 0; j < m; j++) dst.push([0.55 + r() * 0.32, 0.40 + r() * 0.5]);
  }
  genData();

  function sinkhorn() {
    const a = new Array(n).fill(1 / n), b = new Array(m).fill(1 / m);
    const C = [], K = [];
    for (let i = 0; i < n; i++) {
      C.push(new Array(m)); K.push(new Array(m));
      for (let j = 0; j < m; j++) {
        const dx = src[i][0] - dst[j][0], dy = src[i][1] - dst[j][1];
        const c = dx * dx + dy * dy;
        C[i][j] = c; K[i][j] = Math.exp(-c / eps);
      }
    }
    let u = new Array(n).fill(1), v = new Array(m).fill(1);
    for (let it = 0; it < 200; it++) {
      // v = b / (Kᵀ u)
      for (let j = 0; j < m; j++) { let s = 0; for (let i = 0; i < n; i++) s += K[i][j] * u[i]; v[j] = b[j] / (s + 1e-300); }
      // u = a / (K v)
      for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < m; j++) s += K[i][j] * v[j]; u[i] = a[i] / (s + 1e-300); }
    }
    P2 = []; cost = 0;
    for (let i = 0; i < n; i++) {
      P2.push(new Array(m));
      for (let j = 0; j < m; j++) { const p = u[i] * K[i][j] * v[j]; P2[i][j] = p; cost += p * C[i][j]; }
    }
  }

  function recompute() { sinkhorn(); draw(); }

  const pad = 30;
  const wx = (x) => pad + x * (W - 2 * pad);
  const wy = (y) => H - pad - y * (H - 2 * pad);

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = P.ink; ctx.font = "12px Palatino, Georgia, serif"; ctx.textAlign = "center";
    ctx.fillText("План перевозки: источники → стоки", W / 2, 16);

    // линии плана (толщина/прозрачность ∝ массе)
    let pmax = 0; for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) pmax = Math.max(pmax, P2[i][j]);
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
      const w = P2[i][j] / pmax;
      if (w < 0.04) continue;
      ctx.strokeStyle = `rgba(120,110,150,${0.15 + 0.75 * w})`;
      ctx.lineWidth = 0.5 + 4 * w;
      ctx.beginPath(); ctx.moveTo(wx(src[i][0]), wy(src[i][1])); ctx.lineTo(wx(dst[j][0]), wy(dst[j][1])); ctx.stroke();
    }
    // точки
    for (const s of src) { ctx.fillStyle = P.blue; ctx.beginPath(); ctx.arc(wx(s[0]), wy(s[1]), 6, 0, 2 * Math.PI); ctx.fill(); ctx.strokeStyle = "#fffff8"; ctx.lineWidth = 1.4; ctx.stroke(); }
    for (const d of dst) { ctx.fillStyle = P.red; ctx.beginPath(); ctx.arc(wx(d[0]), wy(d[1]), 6, 0, 2 * Math.PI); ctx.fill(); ctx.strokeStyle = "#fffff8"; ctx.lineWidth = 1.4; ctx.stroke(); }
    ctx.font = "11px Palatino, serif"; ctx.textAlign = "left";
    ctx.fillStyle = P.blue; ctx.fillText("● источники", pad, H - 8);
    ctx.fillStyle = P.red; ctx.fillText("● стоки", pad + 90, H - 8);

    // «резкость» плана: средняя доля массы источника, идущая в его главный сток
    let sharp = 0;
    for (let i = 0; i < n; i++) { let mx = 0, row = 0; for (let j = 0; j < m; j++) { mx = Math.max(mx, P2[i][j]); row += P2[i][j]; } sharp += mx / (row + 1e-300); }
    sharp /= n;
    out.set([
      { k: "ε (регуляризация)", v: eps.toFixed(3), color: P.gold },
      { k: "стоимость (W₂²)", v: cost.toFixed(4), color: P.green },
      { k: "резкость плана", v: (sharp * 100).toFixed(0) + "%", color: eps < 0.02 ? P.green : P.mut },
      { k: "режим", v: eps < 0.02 ? "почти ЛП (резкое назначение)" : eps < 0.1 ? "сглаженный" : "размазанный (большой ε)", color: P.mut },
    ]);
  }

  recompute();

  // перетаскивание точек
  let drag = null;
  S.dragify(cv.canvas, { w: W, h: H }, {
    onDown: (p) => {
      const all = [...src.map((s, i) => ({ s, k: 'src', i })), ...dst.map((s, i) => ({ s, k: 'dst', i }))];
      for (const o of all) if (Math.hypot(p.x - wx(o.s[0]), p.y - wy(o.s[1])) < 12) { drag = o; break; }
    },
    onMove: (p) => {
      if (!drag) return;
      const x = Math.max(0, Math.min(1, (p.x - pad) / (W - 2 * pad)));
      const y = Math.max(0, Math.min(1, (H - pad - p.y) / (H - 2 * pad)));
      (drag.k === 'src' ? src : dst)[drag.i] = [x, y];
      recompute();
    },
    onUp: () => { drag = null; },
  });

  S.slider(controls, { label: "регуляризация ε", min: 0.005, max: 0.3, step: 0.005, value: eps, fmt: (v) => v.toFixed(3) },
    (v) => { eps = v; recompute(); });
  S.button(controls, "новые точки", () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; genData(); recompute(); }, "ghost");

  draw();
});
