// kmeans-minibatch — full k-means vs mini-batch k-means: цена качества.
// Полный Ллойд трогает ВСЕ точки на каждой итерации (дорого), мини-батч — лишь
// маленькую случайную пачку (дёшево, но шумно). Слева — кластеры и центроиды обоих,
// справа — инерция vs число вычислений расстояний: minibatch падает к почти-оптимуму
// за в разы меньший бюджет. Это рецепт масштабирования k-means на миллионы точек.
SigmaInt.register("kmeans-minibatch", function (root, opts, S) {
  const P = S.PALETTE;
  const COLORS = [P.blue, P.red, P.green, P.gold, P.purple || "#6b4e9e"];

  root.appendChild(S.el("div", "sigma-int-hint", {
    text: "Слева точки и центроиды: ◆ полный k-means, ★ мини-батч. Справа инерция от числа " +
      "вычислений расстояний (лог-ось). Полный идёт большими дорогими шагами, мини-батч множеством " +
      "дешёвых. Меняй размер батча b: меньше b, дешевле шаг, но шумнее путь.",
  }));

  const stage = S.row(root);
  const W = 720, H = 360;
  const cv = S.makeCanvas(stage, W, H, { maxWidth: 720, pan: false });
  const ctx = cv.ctx;
  const controls = S.row(root, "controls");
  const out = S.readout(root);
  S.caption(root,
    "Мини-батч k-means (Sculley, 2010) на каждом шаге берёт случайную пачку из b точек, " +
    "приписывает их к ближайшим центроидам и сдвигает центроиды скользящим средним. Стоимость " +
    "шага составляет b·k вычислений расстояний вместо N·k у полного Ллойда. На больших N это даёт " +
    "порядки ускорения при почти той же инерции, поэтому именно мини-батч стоит за k-means в " +
    "промышленных библиотеках. Цена: чуть более высокая итоговая инерция и шумный путь сходимости.");

  const N = 1500, K = 4;
  let batch = 60, seed = 7;

  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function gaussGen(rnd) { return function () { let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }; }

  let pts = null, centersTrue = null;
  function genData() {
    const rnd = mulberry32(seed), g = gaussGen(rnd);
    centersTrue = [[-1.4, 1.2], [1.5, 1.3], [-1.2, -1.3], [1.3, -1.2]];
    pts = [];
    for (let i = 0; i < N; i++) {
      const c = centersTrue[i % K];
      pts.push([c[0] + g() * 0.45, c[1] + g() * 0.45]);
    }
  }
  const d2 = (a, b) => { const dx = a[0] - b[0], dy = a[1] - b[1]; return dx * dx + dy * dy; };
  function inertia(cs) { let s = 0; for (let i = 0; i < N; i++) { let m = Infinity; for (let k = 0; k < K; k++) m = Math.min(m, d2(pts[i], cs[k])); s += m; } return s / N; }
  function initCenters(rnd) { const cs = []; const used = {}; while (cs.length < K) { const j = Math.floor(rnd() * N); if (!used[j]) { used[j] = 1; cs.push(pts[j].slice()); } } return cs; }

  // полный Ллойд: записываем (накопл. вычислений, инерция) после каждой итерации
  function runFull(rnd) {
    let cs = initCenters(rnd);
    const traj = [{ cost: 0, J: inertia(cs) }];
    let cost = 0;
    for (let it = 0; it < 30; it++) {
      const sum = Array.from({ length: K }, () => [0, 0, 0]);
      for (let i = 0; i < N; i++) {
        let bk = 0, bd = Infinity;
        for (let k = 0; k < K; k++) { const dd = d2(pts[i], cs[k]); if (dd < bd) { bd = dd; bk = k; } }
        sum[bk][0] += pts[i][0]; sum[bk][1] += pts[i][1]; sum[bk][2]++;
      }
      cost += N * K;
      let moved = 0;
      for (let k = 0; k < K; k++) if (sum[k][2]) { const nx = sum[k][0] / sum[k][2], ny = sum[k][1] / sum[k][2]; moved += Math.abs(nx - cs[k][0]) + Math.abs(ny - cs[k][1]); cs[k] = [nx, ny]; }
      traj.push({ cost, J: inertia(cs) });
      if (moved < 1e-4) break;
    }
    return { cs, traj };
  }

  // мини-батч: b случайных точек/шаг, центроид = скользящее среднее (lr=1/count)
  function runMB(rnd, b, steps) {
    let cs = initCenters(rnd);
    const cnt = new Array(K).fill(0);
    const traj = [{ cost: 0, J: inertia(cs) }];
    let cost = 0;
    for (let s = 0; s < steps; s++) {
      for (let t = 0; t < b; t++) {
        const i = Math.floor(rnd() * N);
        let bk = 0, bd = Infinity;
        for (let k = 0; k < K; k++) { const dd = d2(pts[i], cs[k]); if (dd < bd) { bd = dd; bk = k; } }
        cnt[bk]++; const lr = 1 / cnt[bk];
        cs[bk][0] += lr * (pts[i][0] - cs[bk][0]); cs[bk][1] += lr * (pts[i][1] - cs[bk][1]);
      }
      cost += b * K;
      if (s % 2 === 0 || s === steps - 1) traj.push({ cost, J: inertia(cs) });
    }
    return { cs, traj };
  }

  let full = null, mb = null, Jbest = 0;
  function compute() {
    const rnd = mulberry32(seed * 2654435761 & 0x7fffffff);
    // одинаковый старт центроидов для честного сравнения
    const startSeed = (seed * 40503) & 0x7fffffff;
    full = runFull(mulberry32(startSeed));
    // батчей столько, чтобы суммарный бюджет ~ как у полного ×1.2 (для наглядного хвоста)
    const steps = Math.max(40, Math.round(full.traj[full.traj.length - 1].cost * 1.3 / (batch * K)));
    mb = runMB(mulberry32(startSeed), batch, steps);
    Jbest = Math.min(full.traj[full.traj.length - 1].J, mb.traj[mb.traj.length - 1].J);
  }

  const left = { x: 36, y: 28, w: 300, h: 300 };
  const right = { x: 396, y: 28, w: 308, h: 290 };

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // --- слева: кластеры ---
    let lo0 = Infinity, hi0 = -Infinity, lo1 = Infinity, hi1 = -Infinity;
    for (const p of pts) { lo0 = Math.min(lo0, p[0]); hi0 = Math.max(hi0, p[0]); lo1 = Math.min(lo1, p[1]); hi1 = Math.max(hi1, p[1]); }
    const sx = S.scale(lo0 - 0.3, hi0 + 0.3, left.x, left.x + left.w);
    const sy = S.scale(lo1 - 0.3, hi1 + 0.3, left.y + left.h, left.y);
    ctx.fillStyle = P.ink; ctx.font = "13px Palatino, Georgia, serif"; ctx.textAlign = "center";
    ctx.fillText("Точки и центроиды", left.x + left.w / 2, left.y - 10);
    for (const pt of pts) {
      let bk = 0, bd = Infinity; for (let k = 0; k < K; k++) { const dd = d2(pt, mb.cs[k]); if (dd < bd) { bd = dd; bk = k; } }
      ctx.fillStyle = COLORS[bk]; ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.arc(sx(pt[0]), sy(pt[1]), 2.4, 0, 2 * Math.PI); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // центроиды: полный ◆, мини-батч ★
    for (let k = 0; k < K; k++) {
      const fX = sx(full.cs[k][0]), fY = sy(full.cs[k][1]);
      ctx.fillStyle = P.ink; ctx.strokeStyle = "#fffff8"; ctx.lineWidth = 1.5;
      ctx.save(); ctx.translate(fX, fY); ctx.rotate(Math.PI / 4); ctx.fillRect(-5, -5, 10, 10); ctx.strokeRect(-5, -5, 10, 10); ctx.restore();
      const mX = sx(mb.cs[k][0]), mY = sy(mb.cs[k][1]);
      star(mX, mY, 7, COLORS[k]);
    }
    ctx.font = "11px Palatino, serif"; ctx.textAlign = "left";
    ctx.fillStyle = P.ink; ctx.fillText("◆ полный", left.x + 4, left.y + left.h + 14);
    ctx.fillText("★ мини-батч", left.x + 80, left.y + left.h + 14);

    // --- справа: инерция vs вычисления (лог-x) ---
    let cmax = Math.max(full.traj[full.traj.length - 1].cost, mb.traj[mb.traj.length - 1].cost);
    let Jmax = 0, Jmin = Infinity;
    [full.traj, mb.traj].forEach((tr) => tr.forEach((p) => { Jmax = Math.max(Jmax, p.J); Jmin = Math.min(Jmin, p.J); }));
    const lg = (c) => Math.log10(Math.max(c, N * K * 0.3));
    const xR = S.scale(lg(N * K * 0.3), lg(cmax * 1.05), right.x, right.x + right.w);
    const yR = S.scale(Jmin * 0.95, Jmax * 1.02, right.y + right.h, right.y);
    ctx.fillStyle = P.ink; ctx.font = "13px Palatino, Georgia, serif"; ctx.textAlign = "center";
    ctx.fillText("Инерция vs вычисления расстояний", right.x + right.w / 2, right.y - 10);
    S.axes(ctx, right, { xlabel: "вычислений расстояний (лог)", ylabel: "инерция J" });
    const plot = (tr, color, lw, dash) => {
      ctx.strokeStyle = color; ctx.lineWidth = lw; if (dash) ctx.setLineDash(dash); else ctx.setLineDash([]);
      ctx.beginPath();
      tr.forEach((p, i) => { const X = xR(lg(p.cost || N * K * 0.3)), Y = yR(p.J); i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y); });
      ctx.stroke(); ctx.setLineDash([]);
    };
    plot(full.traj, P.ink, 2, [5, 3]);
    plot(mb.traj, P.gold, 2.2);
    ctx.font = "11px Palatino, serif"; ctx.textAlign = "right";
    ctx.fillStyle = P.ink; ctx.fillText("- - полный", right.x + right.w - 6, right.y + 14);
    ctx.fillStyle = P.gold; ctx.fillText("— мини-батч", right.x + right.w - 6, right.y + 28);

    // бюджет до достижения 1.05×Jbest
    const reach = (tr) => { for (const p of tr) if (p.J <= Jbest * 1.05) return p.cost; return tr[tr.length - 1].cost; };
    const cF = reach(full.traj), cM = reach(mb.traj);
    const Jf = full.traj[full.traj.length - 1].J, Jm = mb.traj[mb.traj.length - 1].J;
    out.set([
      { k: "размер батча b", v: batch + " из " + N, color: P.gold },
      { k: "J полный", v: Jf.toFixed(3), color: P.ink },
      { k: "J мини-батч", v: Jm.toFixed(3) + " (+" + ((Jm / Jf - 1) * 100).toFixed(0) + "%)", color: P.gold },
      { k: "вычислений до 1.05·J*", v: Math.round(cF).toLocaleString("ru") + " vs " + Math.round(cM).toLocaleString("ru"), color: P.mut },
      { k: "ускорение", v: (cF / Math.max(1, cM)).toFixed(1) + "×", color: P.green },
    ]);
  }

  function star(x, y, r, color) {
    ctx.fillStyle = color; ctx.strokeStyle = P.ink; ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const ang = -Math.PI / 2 + i * Math.PI / 5; const rad = i % 2 ? r * 0.45 : r; const X = x + Math.cos(ang) * rad, Y = y + Math.sin(ang) * rad; i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y); }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#fffff8"; ctx.lineWidth = 1; ctx.stroke();
  }

  function recompute() { genData(); compute(); draw(); }
  recompute();

  S.slider(controls, { label: "размер батча b", min: 5, max: 200, step: 5, value: batch, fmt: (v) => v | 0 },
    (v) => { batch = v | 0; compute(); draw(); });
  S.button(controls, "пересэмплировать", () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; recompute(); }, "ghost");

  draw();
});
