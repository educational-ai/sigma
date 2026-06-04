// heavy-tails — когда среднее обманывает. Бегущее выборочное среднее у
// тяжёлохвостого распределения (Стьюдент-t с ν степенями свободы) НЕ сходится:
// редкие гигантские выбросы дёргают его снова и снова. У гаусса — сходится к 0.
// ν=1 — Коши (среднего НЕТ), ν≤2 — бесконечная дисперсия, ν→∞ — гаусс.
SigmaInt.register("heavy-tails", function (root, opts, S) {
  const P = S.PALETTE;

  root.appendChild(S.el("div", "sigma-int-hint", {
    text: "Тяни ν (степени свободы Стьюдента). Сверху — бегущее среднее: у тяжёлого хвоста (красное) " +
      "оно скачет и не сходится, у гаусса (серое) быстро садится на 0. Снизу — сами выборки: видно " +
      "редкие гигантские выбросы, которые и дёргают среднее. ν=1 — Коши (среднего нет), ν≤2 — дисперсия бесконечна.",
  }));

  const stage = S.row(root);
  const W = 720, H = 400;
  const cv = S.makeCanvas(stage, W, H, { maxWidth: 720, pan: false });
  const ctx = cv.ctx;
  const controls = S.row(root, "controls");
  const out = S.readout(root);
  S.caption(root,
    "Стьюдентово t с ν степенями свободы: при больших ν — почти гаусс, при малых — тяжёлые хвосты. " +
    "Среднее существует только при ν>1, дисперсия конечна только при ν>2. Когда их нет, выборочное " +
    "среднее не сходится — закон больших чисел и ЦПТ не работают, и один редкий выброс важнее тысячи " +
    "обычных. Мораль: у тяжёлохвостых данных (доходы, размеры городов, потери на рынке, задержки сети) " +
    "«среднее» обманчиво — смотри на медиану, хвост и максимум.");

  let nu = 2;          // степени свободы
  let seed = 20260604;
  const N = 2000;      // число выборок

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

  let ht = null, gs = null, runHT = null, runG = null, maxAbs = 0;
  function compute() {
    const g = gaussGen(mulberry32(seed));
    ht = new Float64Array(N); gs = new Float64Array(N);
    runHT = new Float64Array(N); runG = new Float64Array(N);
    let sH = 0, sG = 0; maxAbs = 0;
    for (let i = 0; i < N; i++) {
      // t_ν = Z / sqrt(χ²_ν / ν),  χ²_ν = сумма ν квадратов N(0,1)
      const z = g();
      let chi = 0; for (let k = 0; k < nu; k++) { const e = g(); chi += e * e; }
      const t = z / Math.sqrt(chi / nu);
      ht[i] = t; gs[i] = g();
      sH += t; sG += gs[i];
      runHT[i] = sH / (i + 1); runG[i] = sG / (i + 1);
      if (Math.abs(t) > maxAbs) maxAbs = Math.abs(t);
    }
  }

  const padL = 50, padR = 14;
  const top = { x: padL, y: 24, w: W - padL - padR, h: 200 };
  const bot = { x: padL, y: 256, w: W - padL - padR, h: 110 };

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // --- верх: бегущее среднее ---
    // y-диапазон по фактическому размаху бегущего среднего тяжёлого хвоста (клампим)
    let lo = 0, hi = 0;
    for (let i = 0; i < N; i++) { lo = Math.min(lo, runHT[i]); hi = Math.max(hi, runHT[i]); }
    const span = Math.max(0.6, Math.min(20, Math.max(Math.abs(lo), Math.abs(hi)) * 1.15));
    const xS = S.scale(0, N, top.x, top.x + top.w);
    const yT = S.scale(-span, span, top.y + top.h, top.y);

    ctx.fillStyle = P.ink; ctx.font = "13px Palatino, Georgia, serif"; ctx.textAlign = "center";
    ctx.fillText("Бегущее выборочное среднее", top.x + top.w / 2, top.y - 8);
    // сетка y
    ctx.font = "10px Palatino, serif";
    for (let k = -Math.floor(span); k <= Math.floor(span); k++) {
      if (Math.floor(span) > 6 && k % 2 !== 0) continue;
      const Y = yT(k);
      ctx.strokeStyle = (k === 0) ? P.mut : P.grid; ctx.lineWidth = (k === 0) ? 1.2 : 1;
      ctx.beginPath(); ctx.moveTo(top.x, Y); ctx.lineTo(top.x + top.w, Y); ctx.stroke();
      ctx.fillStyle = P.mut; ctx.textAlign = "right"; ctx.fillText(String(k), top.x - 5, Y + 3);
    }
    S.axes(ctx, top, { xlabel: "число выборок n", ylabel: "среднее" });

    const curve = (run, color, lw) => {
      ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath();
      for (let i = 0; i < N; i++) {
        const Y = yT(Math.max(-span, Math.min(span, run[i])));
        i === 0 ? ctx.moveTo(xS(i), Y) : ctx.lineTo(xS(i), Y);
      }
      ctx.stroke();
    };
    curve(runG, P.mut, 1.3);     // гаусс (опорный, серый)
    curve(runHT, P.red, 2);      // тяжёлый хвост

    ctx.font = "11px Palatino, serif"; ctx.textAlign = "left";
    ctx.fillStyle = P.red; ctx.fillText("— t_ν (тяжёлый хвост)", top.x + 6, top.y + 14);
    ctx.fillStyle = P.mut; ctx.fillText("— гаусс", top.x + 6, top.y + 28);

    // --- низ: поток выборок (стебли), общий масштаб для гиганта ---
    const sMax = Math.max(4, Math.min(maxAbs, 200));
    const yB = S.scale(-sMax, sMax, bot.y + bot.h, bot.y);
    ctx.fillStyle = P.ink; ctx.font = "13px Palatino, Georgia, serif"; ctx.textAlign = "center";
    ctx.fillText("Сами выборки (редкие гиганты дёргают среднее)", bot.x + bot.w / 2, bot.y - 6);
    ctx.strokeStyle = P.grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(bot.x, yB(0)); ctx.lineTo(bot.x + bot.w, yB(0)); ctx.stroke();
    ctx.fillStyle = P.mut; ctx.font = "10px Palatino, serif"; ctx.textAlign = "right";
    ctx.fillText("±" + Math.round(sMax), bot.x - 5, bot.y + 8);
    for (let i = 0; i < N; i += 1) {
      const X = xS(i), Y = yB(Math.max(-sMax, Math.min(sMax, ht[i])));
      const big = Math.abs(ht[i]) > 6;
      ctx.strokeStyle = big ? P.red : "rgba(31,78,121,0.5)"; ctx.lineWidth = big ? 1.4 : 0.6;
      ctx.beginPath(); ctx.moveTo(X, yB(0)); ctx.lineTo(X, Y); ctx.stroke();
    }

    const meanExists = nu > 1, varFinite = nu > 2;
    out.set([
      { k: "ν", v: nu === 12 ? "12 (≈гаусс)" : String(nu) + (nu === 1 ? " (Коши)" : ""), color: P.gold },
      { k: "среднее", v: meanExists ? "существует" : "НЕ существует", color: meanExists ? P.green : P.red },
      { k: "дисперсия", v: varFinite ? "конечна" : "бесконечна", color: varFinite ? P.green : P.red },
      { k: "ср. при n=" + N, v: runHT[N - 1].toFixed(3), color: P.red },
      { k: "max|x|", v: maxAbs.toFixed(1), color: P.mut },
    ]);
  }

  function recompute() { compute(); draw(); }
  recompute();

  S.slider(controls, { label: "ν (степени свободы)", min: 1, max: 12, step: 1, value: nu,
    fmt: (v) => (v === 1 ? "1 (Коши)" : v === 12 ? "12≈гаусс" : String(v)) },
    (v) => { nu = v | 0; recompute(); });
  S.button(controls, "пересэмплировать", () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; recompute(); }, "ghost");

  draw();
});
