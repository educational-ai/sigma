// double-descent — живая кривая двойного спуска + реальная полиномиальная
// подгонка. Двигаешь степень d / шум / число точек — обе панели мгновенно
// пересчитываются на чистом JS (без Pyodide, без кнопок).
SigmaInt.register("double-descent", function (root, opts, S) {
  const P = S.PALETTE;

  root.appendChild(S.el("div", "sigma-int-hint", {
    text: "Тяни ползунок «ёмкость d» (или кликай по левой кривой) — слева бежит маркёр по кривым train/test, " +
      "справа полиномиальная подгонка перестраивается в реальном времени. Пройди через порог интерполяции d = n.",
  }));

  const stage = S.row(root);
  const cv = S.makeCanvas(stage, 760, 360, { maxWidth: 760 });
  const ctx = cv.ctx;

  const controls = S.row(root, "controls");
  const out = S.readout(root);
  S.caption(root,
    "Слева — канонические кривые ошибки обучения (синяя) и теста (красная) от ёмкости модели: " +
    "U-образный спуск, «шпиль» переобучения на пороге интерполяции (число параметров ≈ числу точек), " +
    "затем второй спуск в сверхпараметризованном режиме. Справа — настоящая полиномиальная регрессия " +
    "минимальной нормы по зашумлённым точкам: при больших d решение снова становится гладким.");

  // -------------------------------------------------- параметры (состояние)
  let d = 6;        // текущая степень (ёмкость) — число параметров = d+1
  let noise = 0.18; // ст. отклонение шума
  let nPts = 15;    // число обучающих точек
  const DMAX = 40;
  const RIDGE = 1e-7; // лёгкая регуляризация для устойчивости псевдообратной

  // детерминированный ГПСЧ, чтобы данные не «прыгали» между перерисовками
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // стандартная нормаль из двух uniform (Box–Muller)
  function gauss(rnd) {
    let u = 0, v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // истинная (гладкая) функция, которую учим
  const trueF = (x) => Math.sin(2.3 * x) * 0.7 + 0.25 * x;

  // ---- данные: обучающая выборка (фикс. сид) + тестовая (другой сид) ----
  let train = null, test = null;
  function genData() {
    const rTr = mulberry32(12345), rNo = mulberry32(777);
    const xs = [], ys = [], yc = [];
    for (let i = 0; i < nPts; i++) {
      // равномерно по [-1,1] с лёгким джиттером — точки не сливаются
      const x = -1 + 2 * (i + 0.5) / nPts + (rTr() - 0.5) * (0.8 / nPts);
      xs.push(x); yc.push(trueF(x));
      ys.push(trueF(x) + noise * gauss(rNo));
    }
    train = { x: xs, y: ys, clean: yc };
    // тест: плотная регулярная сетка, чистые значения (мерим обобщение)
    const tx = [], ty = [];
    const M = 200;
    for (let i = 0; i < M; i++) {
      const x = -1 + 2 * i / (M - 1);
      tx.push(x); ty.push(trueF(x));
    }
    test = { x: tx, y: ty };
  }

  // ---- признаки: ОРТОНОРМИРОВАННЫЕ полиномы Лежандра на [-1,1] ----
  // Ортонормированный базис критичен: только в нём решение минимальной нормы
  // коэффициентов соответствует ГЛАДКОЙ функции → за порогом интерполяции
  // действительно виден второй спуск (на сыром мономиальном базисе xⁿ его нет).
  function feat(x, deg) {
    const row = new Array(deg + 1);
    let p0 = 1, p1 = x; // P_{j-1}, P_j (рекуррента Бонне)
    for (let j = 0; j <= deg; j++) {
      let Pj;
      if (j === 0) Pj = 1;
      else if (j === 1) Pj = x;
      else { Pj = ((2 * j - 1) * x * p1 - (j - 1) * p0) / j; p0 = p1; p1 = Pj; }
      row[j] = Pj * Math.sqrt((2 * j + 1) / 2); // L²-нормировка на [-1,1]
    }
    return row;
  }

  // решение линейной системы A w = b методом Гаусса с частичным выбором
  function solve(A, b) {
    const n = b.length;
    const M = A.map((r, i) => r.concat(b[i]));
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (piv !== c) { const t = M[piv]; M[piv] = M[c]; M[c] = t; }
      const d0 = M[c][c];
      if (Math.abs(d0) < 1e-12) continue; // вырождение — пропускаем
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / d0;
        if (f === 0) continue;
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    const w = new Array(n).fill(0);
    for (let c = 0; c < n; c++) { const dd = M[c][c]; w[c] = Math.abs(dd) < 1e-12 ? 0 : M[c][n] / dd; }
    return w;
  }

  // подгонка полинома степени deg к обучающим точкам.
  //   p = deg+1 параметров, n точек.
  //   p <= n (недо/идеально): обычный МНК через нормальное уравнение
  //                           (XᵀX + λI) w = Xᵀy.
  //   p  > n (сверхпарам.):   решение минимальной нормы w = Xᵀ (XXᵀ + λI)⁻¹ y.
  function fitPoly(deg) {
    const n = train.x.length, p = deg + 1;
    const X = train.x.map((x) => feat(x, deg)); // n×p
    const y = train.y;
    if (p <= n) {
      // XᵀX (p×p) + λI, Xᵀy (p)
      const G = [], g = new Array(p).fill(0);
      for (let i = 0; i < p; i++) G.push(new Array(p).fill(0));
      for (let i = 0; i < p; i++) {
        for (let j = 0; j < p; j++) {
          let s = 0;
          for (let k = 0; k < n; k++) s += X[k][i] * X[k][j];
          G[i][j] = s + (i === j ? RIDGE : 0);
        }
        let gs = 0;
        for (let k = 0; k < n; k++) gs += X[k][i] * y[k];
        g[i] = gs;
      }
      return solve(G, g);
    } else {
      // min-norm: a = (XXᵀ + λI)⁻¹ y  (n×n),  w = Xᵀ a
      const K = [];
      for (let i = 0; i < n; i++) {
        const rowI = new Array(n).fill(0);
        for (let j = 0; j < n; j++) {
          let s = 0;
          for (let t = 0; t < p; t++) s += X[i][t] * X[j][t];
          rowI[j] = s + (i === j ? RIDGE : 0);
        }
        K.push(rowI);
      }
      const a = solve(K, y);
      const w = new Array(p).fill(0);
      for (let t = 0; t < p; t++) {
        let s = 0;
        for (let i = 0; i < n; i++) s += X[i][t] * a[i];
        w[t] = s;
      }
      return w;
    }
  }

  function evalPoly(w, x) {
    const ph = feat(x, w.length - 1);
    let s = 0;
    for (let j = 0; j < w.length; j++) s += w[j] * ph[j];
    return s;
  }

  function mse(w, xs, ys) {
    let s = 0;
    for (let i = 0; i < xs.length; i++) { const e = evalPoly(w, xs[i]) - ys[i]; s += e * e; }
    return xs.length ? s / xs.length : 0;
  }
  function coefNorm(w) { let s = 0; for (let j = 0; j < w.length; j++) s += w[j] * w[j]; return Math.sqrt(s); }

  // ---- кривые train/test по всем степеням d = 0..DMAX (пересчёт на изм.) --
  let curves = null; // {trainE:[], testE:[]}
  function computeCurves() {
    const trE = [], teE = [];
    for (let dd = 0; dd <= DMAX; dd++) {
      const w = fitPoly(dd);
      trE.push(mse(w, train.x, train.y));        // ошибка на шумных точках
      teE.push(mse(w, test.x, test.y));          // ошибка против истинной функции
    }
    curves = { trE, teE };
  }

  function recompute() { genData(); computeCurves(); }

  // -------------------------------------------------- геометрия (760×360)
  const padL = 52, padR = 18, padT = 30, padB = 46;
  const gap = 40, midX = 380;
  const left = { x: padL, y: padT, w: midX - padL - gap / 2, h: 360 - padT - padB };
  const right = { x: midX + gap / 2, y: padT, w: 760 - padR - (midX + gap / 2), h: 360 - padT - padB };

  let xCap; // шкала ёмкости (левая панель), для кликов

  function logE(v) { return Math.log10(Math.max(v, 1e-4)); }

  function drawLeft() {
    const n = train.x.length;
    const b = left;
    // диапазон ошибок (лог-шкала)
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i <= DMAX; i++) {
      lo = Math.min(lo, curves.trE[i], curves.teE[i]);
      hi = Math.max(hi, curves.teE[i]);
    }
    lo = Math.max(lo, 1e-4);
    const yLo = logE(lo) - 0.15, yHi = logE(hi) + 0.15;
    xCap = S.scale(0, DMAX, b.x, b.x + b.w);
    const yS = S.scale(yLo, yHi, b.y + b.h, b.y);

    // заголовок
    ctx.fillStyle = P.ink; ctx.font = "13px Palatino, Georgia, serif"; ctx.textAlign = "center";
    ctx.fillText("Ошибка vs ёмкость модели", b.x + b.w / 2, b.y - 12);

    // горизонтальная сетка по декадам
    ctx.font = "10px Palatino, serif";
    for (let p = Math.ceil(yLo); p <= Math.floor(yHi); p++) {
      const Y = yS(p);
      ctx.strokeStyle = P.grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(b.x, Y); ctx.lineTo(b.x + b.w, Y); ctx.stroke();
      ctx.fillStyle = P.mut; ctx.textAlign = "right";
      ctx.fillText("1e" + p, b.x - 5, Y + 3);
    }
    S.axes(ctx, b, { xlabel: "степень d (число параметров)", ylabel: "MSE (лог)" });

    // порог интерполяции d ≈ n
    const thr = xCap(n);
    if (thr <= b.x + b.w + 1) {
      ctx.strokeStyle = P.mut; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(thr, b.y); ctx.lineTo(thr, b.y + b.h); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = P.mut; ctx.font = "10px Palatino, serif"; ctx.textAlign = "center";
      ctx.fillText("d = n", thr, b.y + 10);
    }

    // линия test (красная)
    const drawCurve = (arr, color, lw) => {
      ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath();
      for (let i = 0; i <= DMAX; i++) {
        const X = xCap(i), Y = yS(logE(arr[i]));
        i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
      }
      ctx.stroke();
    };
    drawCurve(curves.teE, P.red, 2.2);
    drawCurve(curves.trE, P.blue, 1.6);

    // подпись «шпиль» у пика test-кривой, если он рядом с порогом d ≈ n
    let iPeak = 0;
    for (let i = 1; i <= DMAX; i++) if (curves.teE[i] > curves.teE[iPeak]) iPeak = i;
    if (Math.abs(iPeak - n) <= 2) {
      ctx.fillStyle = P.red; ctx.font = "10px Palatino, serif"; ctx.textAlign = "center";
      ctx.fillText("шпиль", xCap(iPeak), yS(logE(curves.teE[iPeak])) - 6);
    }

    // легенда
    ctx.font = "11px Palatino, serif"; ctx.textAlign = "left";
    ctx.fillStyle = P.red; ctx.fillText("— test", b.x + 6, b.y + b.h - 20);
    ctx.fillStyle = P.blue; ctx.fillText("— train", b.x + 6, b.y + b.h - 6);

    // бегущий маркёр текущего d
    const mx = xCap(d);
    ctx.strokeStyle = P.gold; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(mx, b.y); ctx.lineTo(mx, b.y + b.h); ctx.stroke();
    const myTe = yS(logE(curves.teE[d])), myTr = yS(logE(curves.trE[d]));
    ctx.fillStyle = P.red; ctx.beginPath(); ctx.arc(mx, myTe, 4, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = P.blue; ctx.beginPath(); ctx.arc(mx, myTr, 3.5, 0, 2 * Math.PI); ctx.fill();
  }

  function drawRight() {
    const b = right;
    const w = fitPoly(d);
    const xS = S.scale(-1.05, 1.05, b.x, b.x + b.w);

    // y-диапазон: по чистой функции + точкам + немного запаса
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < train.x.length; i++) { lo = Math.min(lo, train.y[i]); hi = Math.max(hi, train.y[i]); }
    // привязка к истинной функции (амплитуда sin-сигнала), а не к жёстким ±1.2
    let loF = Infinity, hiF = -Infinity;
    for (let i = 0; i < test.x.length; i++) { loF = Math.min(loF, test.y[i]); hiF = Math.max(hiF, test.y[i]); }
    lo = Math.min(lo, loF); hi = Math.max(hi, hiF);
    const pad = (hi - lo) * 0.12;
    const yS = S.scale(lo - pad, hi + pad, b.y + b.h, b.y);

    ctx.fillStyle = P.ink; ctx.font = "13px Palatino, Georgia, serif"; ctx.textAlign = "center";
    ctx.fillText("Полиномиальная подгонка, d = " + d, b.x + b.w / 2, b.y - 12);

    S.axes(ctx, b, { xlabel: "x", ylabel: "y" });

    // числовые y-тики + горизонтальная сетка (линейная шкала, шаг 0.5)
    ctx.font = "10px Palatino, serif";
    const tLo = Math.ceil((lo - pad) / 0.5) * 0.5;
    const tHi = Math.floor((hi + pad) / 0.5) * 0.5;
    for (let t = tLo; t <= tHi + 1e-9; t += 0.5) {
      const Y = yS(t);
      ctx.strokeStyle = P.grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(b.x, Y); ctx.lineTo(b.x + b.w, Y); ctx.stroke();
      ctx.fillStyle = P.mut; ctx.textAlign = "right";
      ctx.fillText(t.toFixed(1), b.x - 5, Y + 3);
    }

    // нулевая линия
    if (yS.dom[0] < 0 && yS.dom[1] > 0) {
      ctx.strokeStyle = P.grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(b.x, yS(0)); ctx.lineTo(b.x + b.w, yS(0)); ctx.stroke();
    }

    // clip, чтобы дикие осцилляции не вылезали за панель
    ctx.save();
    ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip();

    // истинная функция (пунктир, серая)
    ctx.strokeStyle = P.mut; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.2; ctx.beginPath();
    for (let i = 0; i < test.x.length; i++) {
      const X = xS(test.x[i]), Y = yS(test.y[i]);
      i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
    }
    ctx.stroke(); ctx.setLineDash([]);

    // подогнанный полином (зелёный)
    ctx.strokeStyle = P.green; ctx.lineWidth = 2.2; ctx.beginPath();
    const STEP = 400;
    for (let i = 0; i <= STEP; i++) {
      const x = -1.05 + 2.1 * i / STEP;
      const X = xS(x), Y = yS(evalPoly(w, x));
      i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
    }
    ctx.stroke();
    ctx.restore();

    // обучающие точки
    for (let i = 0; i < train.x.length; i++) {
      ctx.fillStyle = P.red;
      ctx.beginPath(); ctx.arc(xS(train.x[i]), yS(train.y[i]), 3.2, 0, 2 * Math.PI); ctx.fill();
      ctx.strokeStyle = "#fffff8"; ctx.lineWidth = 0.8; ctx.stroke();
    }

    // легенда
    ctx.font = "11px Palatino, serif"; ctx.textAlign = "right";
    ctx.fillStyle = P.green; ctx.fillText("— подгонка", b.x + b.w - 6, b.y + 14);
    ctx.fillStyle = P.mut; ctx.fillText("- - истина", b.x + b.w - 6, b.y + 28);

    return w;
  }

  function draw() {
    ctx.clearRect(0, 0, 760, 360);
    drawLeft();
    const w = drawRight();

    const n = train.x.length, p = d + 1;
    const regime = p < n ? "недо­параметризация" : (p === n ? "порог интерполяции" : "сверхпараметризация");
    const regimeColor = p < n ? P.blue : (p === n ? P.red : P.green);
    out.set([
      { k: "d =", v: String(d) + " (p=" + p + ")", color: P.gold },
      { k: "train MSE", v: curves.trE[d].toExponential(2), color: P.blue },
      { k: "test MSE", v: curves.teE[d].toExponential(2), color: P.red },
      { k: "‖θ‖", v: coefNorm(w).toExponential(2), color: P.purple },
      { k: "режим", v: regime, color: regimeColor },
    ]);
  }

  const redraw = S.rafThrottle(draw);

  // клик/протяжка по левой панели → задать d
  S.dragify(cv.canvas, { w: 760, h: 360 }, {
    onDown: setDFromX, onMove: setDFromX,
  });
  function setDFromX(pt) {
    if (!xCap) return;
    if (pt.x < left.x - 12 || pt.x > left.x + left.w + 12 || pt.y < left.y - 12 || pt.y > left.y + left.h + 16) return;
    let nd = Math.round(xCap.inv(pt.x));
    nd = Math.max(0, Math.min(DMAX, nd));
    if (nd !== d) { d = nd; sldD.set(d); redraw(); }
  }

  // -------------------------------------------------- контролы
  recompute();

  const sldD = S.slider(controls, {
    label: "ёмкость d", min: 0, max: DMAX, step: 1, value: d, fmt: (v) => v,
  }, (v) => { d = v | 0; redraw(); });

  S.slider(controls, {
    label: "уровень шума σ", min: 0, max: 0.5, step: 0.01, value: noise, fmt: (v) => v.toFixed(2),
  }, (v) => { noise = v; recompute(); redraw(); });

  S.slider(controls, {
    label: "число точек n", min: 6, max: 30, step: 1, value: nPts, fmt: (v) => v,
  }, (v) => { nPts = v | 0; recompute(); redraw(); });

  draw();
});
