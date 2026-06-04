// double-descent-nn — двойной спуск на НАСТОЯЩЕЙ нейросети (не полиномиальная игрушка).
// Предрасчёт: MLP (1 скрытый слой, ReLU, Adam) растущей ширины на load_digits с 18%
// шума меток (рецепт Belkin/Nakkiran). Данные — docs/assistant/data/double_descent_nn.json.
// Тяни/наводи по кривой — маркёр бежит по точкам; видно шпиль ровно на пороге train→0.
SigmaInt.register("double-descent-nn", function (root, opts, S) {
  const P = S.PALETTE;

  root.appendChild(S.el("div", "sigma-int-hint", {
    text: "Реальная нейросеть: MLP растущей ширины. Наводи/тяни по графику — маркёр бежит по точкам. " +
      "Тест-ошибка падает, взлетает в ШПИЛЬ ровно там, где сеть впервые идеально подгоняет шумную обучающую выборку " +
      "(train→0, порог интерполяции), а затем СНОВА падает — второй спуск.",
  }));

  const stage = S.row(root);
  const W = 720, H = 380;
  const cv = S.makeCanvas(stage, W, H, { maxWidth: 720, pan: false });
  const ctx = cv.ctx;
  const out = S.readout(root);
  S.caption(root,
    "Настоящий двойной спуск на нейросети (sklearn MLP, 1 скрытый слой ReLU, Adam). Данные: " +
    "load_digits (8×8 цифры), 1000 обучающих примеров, 18% меток зашумлено. Ёмкость = ширина " +
    "скрытого слоя (лог-шкала). Синяя — ошибка на обучении (падает до нуля = интерполяция), " +
    "красная — на тесте. Пик теста совпадает с порогом интерполяции; дальше — второй спуск " +
    "в переопределённом режиме, ниже первого минимума. Это не полином — это реальная сеть.");

  const padL = 58, padR = 16, padT = 28, padB = 48;
  const plot = { x: padL, y: padT, w: W - padL - padR, h: H - padT - padB };

  let rows = null, meta = null, thrIdx = 0, peakIdx = 0, mIdx = 0;
  let xS = null; // лог-шкала по ширине

  const lg = (v) => Math.log10(Math.max(v, 1));

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const b = plot;

    // диапазоны
    const ws = rows.map((r) => r.width);
    const wLo = lg(Math.min(...ws)), wHi = lg(Math.max(...ws));
    let eHi = 0;
    rows.forEach((r) => { eHi = Math.max(eHi, r.test_err, r.train_err); });
    eHi = Math.min(1, eHi * 1.12);
    xS = S.scale(wLo, wHi, b.x, b.x + b.w);
    const yS = S.scale(0, eHi, b.y + b.h, b.y);

    // заголовок
    ctx.fillStyle = P.ink; ctx.font = "13px Palatino, Georgia, serif"; ctx.textAlign = "center";
    ctx.fillText("Ошибка vs ширина сети (реальный MLP)", b.x + b.w / 2, b.y - 12);

    // сетка по y
    ctx.font = "10px Palatino, serif";
    for (let e = 0; e <= eHi + 1e-9; e += 0.1) {
      const Y = yS(e);
      ctx.strokeStyle = P.grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(b.x, Y); ctx.lineTo(b.x + b.w, Y); ctx.stroke();
      ctx.fillStyle = P.mut; ctx.textAlign = "right";
      ctx.fillText(e.toFixed(1), b.x - 5, Y + 3);
    }
    // тики по x (степени 10 + основные ширины)
    [1, 2, 5, 10, 20, 50, 100, 200, 500].forEach((wv) => {
      if (wv < ws[0] || wv > ws[ws.length - 1]) return;
      const X = xS(lg(wv));
      ctx.strokeStyle = P.grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X, b.y); ctx.lineTo(X, b.y + b.h); ctx.stroke();
      ctx.fillStyle = P.mut; ctx.textAlign = "center";
      ctx.fillText(String(wv), X, b.y + b.h + 14);
    });
    S.axes(ctx, b, { xlabel: "ширина скрытого слоя (ёмкость, лог)", ylabel: "ошибка" });

    // порог интерполяции
    const thrX = xS(lg(rows[thrIdx].width));
    ctx.strokeStyle = P.mut; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(thrX, b.y); ctx.lineTo(thrX, b.y + b.h); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = P.mut; ctx.font = "10px Palatino, serif"; ctx.textAlign = "left";
    ctx.fillText("порог интерполяции (train→0)", thrX + 4, b.y + 12);

    // кривые
    const curve = (key, color, lw) => {
      ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath();
      rows.forEach((r, i) => {
        const X = xS(lg(r.width)), Y = yS(r[key]);
        i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
      });
      ctx.stroke();
      rows.forEach((r) => {
        ctx.fillStyle = color; ctx.beginPath();
        ctx.arc(xS(lg(r.width)), yS(r[key]), 2.6, 0, 2 * Math.PI); ctx.fill();
      });
    };
    curve("test_err", P.red, 2.2);
    curve("train_err", P.blue, 1.8);

    // подпись «шпиль» у пика теста
    const pk = rows[peakIdx];
    ctx.fillStyle = P.red; ctx.font = "11px Palatino, serif"; ctx.textAlign = "center";
    ctx.fillText("шпиль", xS(lg(pk.width)), yS(pk.test_err) - 8);

    // легенда
    ctx.font = "11px Palatino, serif"; ctx.textAlign = "left";
    ctx.fillStyle = P.red; ctx.fillText("— test", b.x + b.w - 64, b.y + 14);
    ctx.fillStyle = P.blue; ctx.fillText("— train", b.x + b.w - 64, b.y + 28);

    // маркёр текущей точки
    const r = rows[mIdx], mx = xS(lg(r.width));
    ctx.strokeStyle = P.gold; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(mx, b.y); ctx.lineTo(mx, b.y + b.h); ctx.stroke();
    ctx.fillStyle = P.red; ctx.beginPath(); ctx.arc(mx, yS(r.test_err), 4.5, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = "#fffff8"; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = P.blue; ctx.beginPath(); ctx.arc(mx, yS(r.train_err), 4, 0, 2 * Math.PI); ctx.fill();
    ctx.strokeStyle = "#fffff8"; ctx.lineWidth = 1.2; ctx.stroke();

    const regime = mIdx < peakIdx ? "до пика (классич. переобучение)"
      : (mIdx === peakIdx ? "ШПИЛЬ — порог интерполяции" : "второй спуск (переопределение)");
    out.set([
      { k: "ширина", v: String(r.width), color: P.gold },
      { k: "параметров", v: r.n_params.toLocaleString("ru"), color: P.mut },
      { k: "train err", v: (r.train_err * 100).toFixed(1) + "%", color: P.blue },
      { k: "test err", v: (r.test_err * 100).toFixed(1) + "%", color: P.red },
      { k: "режим", v: regime, color: mIdx === peakIdx ? P.red : (mIdx > peakIdx ? P.green : P.blue) },
    ]);
  }

  function setFromX(pt) {
    if (!xS) return;
    const lw = xS.inv(pt.x);
    // ближайшая точка по лог-ширине
    let best = 0, bd = Infinity;
    rows.forEach((r, i) => { const d = Math.abs(lg(r.width) - lw); if (d < bd) { bd = d; best = i; } });
    if (best !== mIdx) { mIdx = best; draw(); }
  }

  S.loadData("double_descent_nn.json").then((d) => {
    meta = d; rows = d.rows;
    // порог интерполяции — первая ширина с train_err ≈ 0
    thrIdx = rows.findIndex((r) => r.train_err < 0.005);
    if (thrIdx < 0) thrIdx = 0;
    // ШПИЛЬ = локальный пик у порога интерполяции, НЕ глобальный максимум
    // (глобальный — в width=1, тривиальный недоучек; нам нужен пик второго горба).
    // 1) минимум первого спуска (в недопараметризованной зоне до порога)
    let firstMin = 0;
    for (let i = 1; i <= thrIdx; i++) if (rows[i].test_err < rows[firstMin].test_err) firstMin = i;
    // 2) максимум теста от этого минимума до чуть за порог
    peakIdx = firstMin;
    const hi = Math.min(thrIdx + 2, rows.length - 1);
    for (let i = firstMin; i <= hi; i++) if (rows[i].test_err > rows[peakIdx].test_err) peakIdx = i;
    mIdx = peakIdx; // стартуем на шпиле — сразу виден смысл
    S.dragify(cv.canvas, { w: W, h: H }, { onDown: setFromX, onMove: setFromX, onHover: setFromX });
    draw();
  }).catch((e) => {
    ctx.fillStyle = P.ink; ctx.font = "13px Palatino, serif"; ctx.textAlign = "center";
    ctx.fillText("не удалось загрузить данные эксперимента", W / 2, H / 2);
  });
});
