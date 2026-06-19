// pca-noise — PCA на ЧИСТОМ шуме: ловушка спурьезных компонент.
// Даже у случайной гауссовой матрицы без всякой структуры собственные значения
// выборочной ковариации НЕ равны единице — они растекаются по [λ-,λ+] (закон
// Марченко–Пастура). Верхнее с.з. заметно > 1 → выглядит как «сильная первая
// компонента», хотя сигнала нет. Двигаешь «сигнал» — встраиваешь rank-1; он
// виден, только если пробивает край bulk (BBP-переход).
SigmaInt.register("pca-noise", function (root, opts, S) {
  const P = S.PALETTE;

  root.appendChild(S.el("div", "sigma-int-hint", {
    text: "Слева ЧИСТЫЙ гауссов шум (никакой структуры). Справа гистограмма собственных значений его " +
      "выборочной ковариации и теоретическая кривая Марченко–Пастура. Меняй p/n (форма bulk) и встраивай " +
      "rank-1 сигнал: он отделяется от шума, только если пробивает правый край λ₊.",
  }));

  const stage = S.row(root);
  const W = 720, H = 360;
  const cv = S.makeCanvas(stage, W, H, { maxWidth: 720, pan: false });
  const ctx = cv.ctx;
  const controls = S.row(root, "controls");
  const out = S.readout(root);
  S.caption(root,
    "Собственные значения ковариации чистого шума ложатся в «полумесяц» Марченко–Пастура на " +
    "[λ₋,λ₊], λ± = (1±√γ)², γ = p/n. Чем меньше наблюдений n на признак p (больше γ), тем шире " +
    "разброс и тем выше «первая компонента»: чистый артефакт. Встроенный сигнал виден лишь когда " +
    "его собственное значение выходит за λ₊ (фазовый переход BBP). Мораль: scree-график шума не плоский, " +
    "сравнивай с нулевой моделью (Марченко–Пастур или перемешивание), прежде чем верить в «структуру».");

  // ----------- состояние -----------
  let p = 40;       // признаки
  let n = 120;      // наблюдения
  let signal = 0;   // сила rank-1 сигнала (0 = чистый шум)
  let seed = 12345;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gaussGen(rnd) {
    return function () {
      let u = 0, v = 0;
      while (u === 0) u = rnd();
      while (v === 0) v = rnd();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
  }

  // ----------- симметричный eigensolver: Якоби -----------
  function jacobiEig(A0, dim) {
    // A0 — плоский dim*dim симметричный; возвращает отсортированные с.з. (убыв.)
    const a = A0.slice();
    const idx = (i, j) => i * dim + j;
    for (let sweep = 0; sweep < 60; sweep++) {
      // off-diagonal норма
      let off = 0;
      for (let i = 0; i < dim; i++) for (let j = i + 1; j < dim; j++) off += a[idx(i, j)] * a[idx(i, j)];
      if (off < 1e-12) break;
      for (let p1 = 0; p1 < dim; p1++) {
        for (let q = p1 + 1; q < dim; q++) {
          const apq = a[idx(p1, q)];
          if (Math.abs(apq) < 1e-14) continue;
          const app = a[idx(p1, p1)], aqq = a[idx(q, q)];
          const phi = 0.5 * Math.atan2(2 * apq, aqq - app);
          const c = Math.cos(phi), s = Math.sin(phi);
          for (let k = 0; k < dim; k++) {
            const akp = a[idx(k, p1)], akq = a[idx(k, q)];
            a[idx(k, p1)] = c * akp - s * akq;
            a[idx(k, q)] = s * akp + c * akq;
          }
          for (let k = 0; k < dim; k++) {
            const apk = a[idx(p1, k)], aqk = a[idx(q, k)];
            a[idx(p1, k)] = c * apk - s * aqk;
            a[idx(q, k)] = s * apk + c * aqk;
          }
        }
      }
    }
    const ev = [];
    for (let i = 0; i < dim; i++) ev.push(a[idx(i, i)]);
    ev.sort((x, y) => y - x);
    return ev;
  }

  let eig = null, mp = null;
  function compute() {
    const rnd = mulberry32(seed);
    const g = gaussGen(rnd);
    // X (n×p) шум; + опционально rank-1 сигнал signal * u vᵀ (u по наблюдениям, v по признакам)
    const X = [];
    const u = [], v = [];
    for (let j = 0; j < p; j++) v.push(g());
    let vn = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    for (let j = 0; j < p; j++) v[j] /= vn;
    for (let i = 0; i < n; i++) u.push(g());
    let un = Math.sqrt(u.reduce((s, x) => s + x * x, 0)) || 1;
    for (let i = 0; i < n; i++) u[i] /= un;
    const amp = signal * Math.sqrt(n); // масштаб, чтобы сигнал-с.з. ~ signal²
    for (let i = 0; i < n; i++) {
      const row = new Array(p);
      for (let j = 0; j < p; j++) row[j] = g() + amp * u[i] * v[j];
      X.push(row);
    }
    // C = (1/n) XᵀX  (p×p)
    const C = new Float64Array(p * p);
    for (let i = 0; i < p; i++) {
      for (let j = i; j < p; j++) {
        let s = 0;
        for (let k = 0; k < n; k++) s += X[k][i] * X[k][j];
        s /= n; C[i * p + j] = s; C[j * p + i] = s;
      }
    }
    eig = jacobiEig(C, p);
    const gamma = p / n;
    const lm = Math.pow(1 - Math.sqrt(gamma), 2), lp = Math.pow(1 + Math.sqrt(gamma), 2);
    mp = { gamma, lm, lp };
  }

  // плотность М–П
  function mpDensity(lam) {
    const { gamma, lm, lp } = mp;
    if (lam <= lm || lam >= lp) return 0;
    return Math.sqrt((lp - lam) * (lam - lm)) / (2 * Math.PI * gamma * lam);
  }

  const pad = { l: 52, r: 16, t: 26, b: 46 };
  function draw() {
    ctx.clearRect(0, 0, W, H);
    const bx = pad.l, by = pad.t, bw = W - pad.l - pad.r, bh = H - pad.t - pad.b;

    const { lm, lp, gamma } = mp;
    const xMax = Math.max(lp * 1.05, eig[0] * 1.05);
    const xS = S.scale(0, xMax, bx, bx + bw);

    // гистограмма с.з.
    const NB = Math.max(16, Math.round(Math.sqrt(p) * 4));
    const bins = new Array(NB).fill(0);
    eig.forEach((l) => { const b = Math.min(NB - 1, Math.max(0, Math.floor(l / xMax * NB))); bins[b]++; });
    const binW = xMax / NB;
    // нормировка гистограммы в плотность
    const histScaleToDens = (cnt) => cnt / (eig.length * binW);
    let yMax = 0;
    for (let lam = lm + 1e-3; lam < lp; lam += (lp - lm) / 80) yMax = Math.max(yMax, mpDensity(lam));
    for (let b = 0; b < NB; b++) yMax = Math.max(yMax, histScaleToDens(bins[b]));
    yMax *= 1.15;
    const yS = S.scale(0, yMax, by + bh, by);

    // оси + сетка
    ctx.fillStyle = P.ink; ctx.font = "13px Palatino, Georgia, serif"; ctx.textAlign = "center";
    ctx.fillText("Спектр собственных значений ковариации шума", bx + bw / 2, by - 12);
    S.axes(ctx, { x: bx, y: by, w: bw, h: bh }, { xlabel: "собственное значение λ", ylabel: "плотность" });
    ctx.font = "10px Palatino, serif"; ctx.fillStyle = P.mut; ctx.textAlign = "center";
    [0, 1, 2, 3, 4].forEach((t) => { if (t <= xMax) { const X = xS(t); ctx.fillText(String(t), X, by + bh + 14); } });

    // бары гистограммы
    for (let b = 0; b < NB; b++) {
      if (!bins[b]) continue;
      const x0 = xS(b * binW), x1 = xS((b + 1) * binW);
      const yv = yS(histScaleToDens(bins[b]));
      ctx.fillStyle = "rgba(31,78,121,0.35)";
      ctx.fillRect(x0 + 0.5, yv, Math.max(1, x1 - x0 - 1), by + bh - yv);
    }

    // кривая Марченко–Пастура
    ctx.strokeStyle = P.red; ctx.lineWidth = 2.2; ctx.beginPath();
    let started = false;
    for (let i = 0; i <= 240; i++) {
      const lam = lm + (lp - lm) * i / 240;
      const X = xS(lam), Y = yS(mpDensity(lam));
      if (!started) { ctx.moveTo(X, Y); started = true; } else ctx.lineTo(X, Y);
    }
    ctx.stroke();

    // края bulk λ±
    [["λ₋", lm], ["λ₊", lp]].forEach(([lbl, val]) => {
      const X = xS(val);
      ctx.strokeStyle = P.mut; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X, by); ctx.lineTo(X, by + bh); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = P.mut; ctx.font = "10px Palatino, serif"; ctx.textAlign = "center";
      ctx.fillText(lbl, X, by + 10);
    });

    // верхнее наблюдаемое с.з. — маркёр (сигнал или артефакт шума)
    const top = eig[0];
    const escapes = top > lp * 1.02;
    const tX = xS(top);
    ctx.strokeStyle = escapes ? P.green : P.gold; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(tX, by); ctx.lineTo(tX, by + bh); ctx.stroke();
    ctx.fillStyle = escapes ? P.green : P.gold; ctx.font = "11px Palatino, serif"; ctx.textAlign = "center";
    ctx.fillText(escapes ? "сигнал ↑" : "λmax (шум)", tX, by + bh - 4);

    out.set([
      { k: "p / n", v: p + " / " + n, color: P.mut },
      { k: "γ = p/n", v: gamma.toFixed(2), color: P.blue },
      { k: "λ₊ (край M-P)", v: lp.toFixed(2), color: P.red },
      { k: "λmax (набл.)", v: top.toFixed(2), color: escapes ? P.green : P.gold },
      { k: "вердикт", v: signal > 0 ? (escapes ? "сигнал виден" : "сигнал тонет в шуме") : "чистый шум, структуры нет", color: escapes ? P.green : P.mut },
    ]);
  }

  function recompute() { compute(); draw(); }
  const redraw = S.rafThrottle(draw);

  recompute();

  S.slider(controls, { label: "признаков p", min: 5, max: 80, step: 1, value: p, fmt: (v) => v | 0 },
    (v) => { p = v | 0; if (n < p + 2) n = p + 2; recompute(); });
  S.slider(controls, { label: "наблюдений n", min: 10, max: 400, step: 1, value: n, fmt: (v) => v | 0 },
    (v) => { n = Math.max(p + 2, v | 0); recompute(); });
  S.slider(controls, { label: "сигнал (rank-1)", min: 0, max: 2.5, step: 0.05, value: signal, fmt: (v) => v.toFixed(2) },
    (v) => { signal = v; recompute(); });
  S.button(controls, "пересэмплировать шум", () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; recompute(); }, "ghost");

  draw();
});
