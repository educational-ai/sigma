// mds-relax — восстановление карты Европы из одной таблицы расстояний.
// На входе только попарные расстояния между городами (км) — ни одной координаты.
// Метод минимизирует ошибку E = Σ(||yi-yj|| - Dij)² и раскладывает города на
// плоскости; результат прикладывается поворотом и отражением к настоящей
// географии, поэтому видно, что вышла именно карта Европы, а не облако точек.
// Одновременно считаются два метода — градиентный и безградиентный (Нелдера—Мида);
// чем больше городов, тем сильнее отстаёт безградиентный. Это и есть ответ на
// вопрос, почему большие модели учат градиентом.
// Данные: docs/assistant/data/mds_europe.json (расстояния — репозиторий optim
// Даниила Меркулова, координаты городов — OpenStreetMap).
SigmaInt.register("mds-relax", function (root, opts, S) {
  const P = S.PALETTE;

  root.appendChild(S.el("div", "sigma-int-hint", {
    text: "На входе — только таблица расстояний между городами. Ни широт, ни долгот. " +
      "Смотри, как из неё сама собой проступает карта Европы.",
  }));

  const stage = S.row(root);
  const W = 760, H = 400;
  const cv = S.makeCanvas(stage, W, H, { maxWidth: 760, pan: false });
  const ctx = cv.ctx;

  const controls = S.row(root, "controls");
  const out = S.readout(root);
  S.caption(root,
    "Слева — карта, восстановленная методом. Её приходится приложить поворотом и отражением " +
    "к настоящей географии (серые крестики): из одних расстояний нельзя понять, где север. " +
    "Справа — насколько расстояния на восстановленной карте расходятся с исходной таблицей. " +
    "Добавляй города: у градиентного метода кривая почти не меняется, у безградиентного — уползает.");

  const plot = { x: 24, y: 26, w: 400, h: 348 };
  const curve = { x: 480, y: 26, w: 252, h: 348 };

  // ---------- данные ----------
  let CITY = [], LAT = [], LON = [], DFULL = [];
  let n = 8;                 // сколько городов участвует (берём самые крупные)
  let method = "grad";
  let ready = false;

  let D = [];                // таблица расстояний для текущих n, км
  let Yg = [], Yz = [];      // конфигурации: градиентный и безградиентный
  let simplex = null;        // симплекс Нелдера—Мида
  let histG = [], histZ = [];
  let iter = 0;
  const HIST_MAX = 260;
  let scaleKm = 1;
  let stepG = 1e-7;   // размер градиентного шага, подбирается дроблением

  function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
  function dist(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy) || 1e-9;
  }

  // то, что минимизируем: сумма квадратов отклонений расстояний
  function err(Y) {
    let s = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = dist(Y[i], Y[j]) - D[i][j];
        s += d * d;
      }
    }
    return s;
  }

  // среднее отклонение на пару городов, км — величина, понятная человеку
  function kmErr(Y) {
    let s = 0, cnt = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) { s += Math.abs(dist(Y[i], Y[j]) - D[i][j]); cnt++; }
    }
    return cnt ? s / cnt : 0;
  }

  function grad(Y) {
    const g = Y.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = dist(Y[i], Y[j]);
        const c = 4 * (d - D[i][j]) / d;
        const dx = (Y[i].x - Y[j].x) * c, dy = (Y[i].y - Y[j].y) * c;
        g[i].x += dx; g[i].y += dy;
        g[j].x -= dx; g[j].y -= dy;
      }
    }
    return g;
  }

  // ---------- Нелдера—Мида на 2n переменных ----------
  function flat(Y) { const v = []; for (const p of Y) { v.push(p.x, p.y); } return v; }
  function unflat(v) {
    const Y = [];
    for (let i = 0; i < v.length; i += 2) Y.push({ x: v[i], y: v[i + 1] });
    return Y;
  }
  function fvec(v) { return err(unflat(v)); }

  function initSimplex(Y0) {
    const v0 = flat(Y0), dim = v0.length;
    const pts = [{ v: v0, f: fvec(v0) }];
    const step = 0.25 * scaleKm;
    for (let k = 0; k < dim; k++) {
      const v = v0.slice();
      v[k] += step;
      pts.push({ v, f: fvec(v) });
    }
    pts.sort((a, b) => a.f - b.f);
    return pts;
  }

  function nelderMeadStep(pts) {
    const dim = pts[0].v.length;
    pts.sort((a, b) => a.f - b.f);
    const best = pts[0], worst = pts[pts.length - 1], second = pts[pts.length - 2];
    const cen = new Array(dim).fill(0);
    for (let i = 0; i < pts.length - 1; i++) {
      for (let k = 0; k < dim; k++) cen[k] += pts[i].v[k] / (pts.length - 1);
    }
    const mix = (a, b, t) => a.map((x, k) => x + t * (b[k] - x));
    const refl = mix(cen, worst.v, -1), fr = fvec(refl);
    if (fr < best.f) {
      const exp = mix(cen, worst.v, -2), fe = fvec(exp);
      pts[pts.length - 1] = fe < fr ? { v: exp, f: fe } : { v: refl, f: fr };
    } else if (fr < second.f) {
      pts[pts.length - 1] = { v: refl, f: fr };
    } else {
      const con = mix(cen, worst.v, 0.5), fc = fvec(con);
      if (fc < worst.f) {
        pts[pts.length - 1] = { v: con, f: fc };
      } else {
        for (let i = 1; i < pts.length; i++) {
          const v = mix(best.v, pts[i].v, 0.5);
          pts[i] = { v, f: fvec(v) };
        }
      }
    }
    return pts;
  }

  // ---------- приложить результат к настоящей географии ----------
  // Из расстояний ориентация не восстанавливается, поэтому карту надо повернуть
  // и при необходимости отразить — иначе Европа выйдет вверх ногами и не узнается.
  function geoRef() {
    const la = LAT.slice(0, n), lo = LON.slice(0, n);
    const la0 = la.reduce((s, v) => s + v, 0) / n;
    const k = Math.cos((la0 * Math.PI) / 180);
    return la.map((v, i) => ({ x: 111.32 * k * lo[i], y: 111.32 * v }));
  }

  function align(Y, R) {
    const cy = { x: 0, y: 0 }, cr = { x: 0, y: 0 };
    for (let i = 0; i < n; i++) { cy.x += Y[i].x / n; cy.y += Y[i].y / n; cr.x += R[i].x / n; cr.y += R[i].y / n; }
    const A = Y.map((p) => sub(p, cy)), B = R.map((p) => sub(p, cr));
    let bestOut = null, bestSse = Infinity;
    for (const mir of [1, -1]) {
      const Am = A.map((p) => ({ x: p.x, y: mir * p.y }));
      let aa = 0, bb = 0;
      for (let i = 0; i < n; i++) {
        aa += Am[i].x * B[i].x + Am[i].y * B[i].y;
        bb += Am[i].x * B[i].y - Am[i].y * B[i].x;
      }
      const th = Math.atan2(bb, aa), c = Math.cos(th), s = Math.sin(th);
      const outp = Am.map((p) => ({ x: c * p.x - s * p.y + cr.x, y: s * p.x + c * p.y + cr.y }));
      let sse = 0;
      for (let i = 0; i < n; i++) sse += (outp[i].x - R[i].x) ** 2 + (outp[i].y - R[i].y) ** 2;
      if (sse < bestSse) { bestSse = sse; bestOut = outp; }
    }
    return bestOut;
  }

  // ---------- инициализация задачи ----------
  function reset() {
    D = [];
    for (let i = 0; i < n; i++) D.push(DFULL[i].slice(0, n));
    let mx = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) mx = Math.max(mx, D[i][j]);
    scaleKm = mx || 1;
    const R = 0.35 * scaleKm;
    Yg = []; Yz = [];
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n, r = R * (0.6 + 0.4 * ((i * 37) % 11) / 11);
      const p = { x: r * Math.cos(a), y: r * Math.sin(a) };
      Yg.push({ x: p.x, y: p.y });
      Yz.push({ x: p.x, y: p.y });
    }
    simplex = initSimplex(Yz);
    stepG = 1e-7;
    histG = []; histZ = []; iter = 0;
  }

  // Градиентный шаг с дроблением: фиксированный шаг на таких масштабах (тысячи
  // километров) заставляет метод перескакивать минимум и выглядеть хуже
  // безградиентного — что неправда и ломает весь смысл сравнения.
  function gradStep() {
    let f0 = err(Yg);
    const g = grad(Yg);
    let gn2 = 0;
    for (const q of g) gn2 += q.x * q.x + q.y * q.y;
    if (gn2 < 1e-14) return;
    let t = stepG;
    for (let k = 0; k < 30; k++) {
      const cand = Yg.map((p, i) => ({ x: p.x - t * g[i].x, y: p.y - t * g[i].y }));
      if (err(cand) < f0) { Yg = cand; stepG = t * 1.8; return; }
      t *= 0.5;
    }
    stepG = Math.max(t, 1e-16);
  }

  function step() {
    if (!ready) return;
    for (let s = 0; s < 2; s++) gradStep();
    for (let s = 0; s < 2; s++) simplex = nelderMeadStep(simplex);
    Yz = unflat(simplex[0].v);

    iter++;
    histG.push(kmErr(Yg)); histZ.push(kmErr(Yz));
    if (histG.length > HIST_MAX) { histG.shift(); histZ.shift(); }
  }

  // ---------- отрисовка ----------
  function draw() {
    ctx.clearRect(0, 0, W, H);
    if (!ready) {
      ctx.fillStyle = P.mut; ctx.font = "14px ui-sans-serif, system-ui";
      ctx.fillText("Загружаю таблицу расстояний…", 24, 40);
      return;
    }
    const Y = method === "grad" ? Yg : Yz;
    const R = geoRef();
    const A = align(Y, R);

    const xs = R.map((p) => p.x).concat(A.map((p) => p.x));
    const ys = R.map((p) => p.y).concat(A.map((p) => p.y));
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    const span = Math.max(x1 - x0, y1 - y0) * 1.16 || 1;
    const cx = (x0 + x1) / 2, cy2 = (y0 + y1) / 2;
    const sz = Math.min(plot.w, plot.h);
    const X = (v) => plot.x + plot.w / 2 + ((v - cx) / span) * sz;
    const Yp = (v) => plot.y + plot.h / 2 - ((v - cy2) / span) * sz;

    ctx.strokeStyle = "#e6e2d4"; ctx.lineWidth = 1;
    ctx.strokeRect(plot.x, plot.y, plot.w, plot.h);

    ctx.strokeStyle = "#c9c4b4"; ctx.lineWidth = 1;
    for (let i = 0; i < n; i++) {
      const px = X(R[i].x), py = Yp(R[i].y);
      ctx.beginPath();
      ctx.moveTo(px - 3, py); ctx.lineTo(px + 3, py);
      ctx.moveTo(px, py - 3); ctx.lineTo(px, py + 3);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(150,145,130,0.45)";
    for (let i = 0; i < n; i++) {
      ctx.beginPath(); ctx.moveTo(X(R[i].x), Yp(R[i].y)); ctx.lineTo(X(A[i].x), Yp(A[i].y)); ctx.stroke();
    }
    ctx.font = "11px ui-sans-serif, system-ui";
    // сначала все точки, потом подписи — иначе точка ляжет поверх чужого названия
    for (let i = 0; i < n; i++) {
      const px = X(A[i].x), py = Yp(A[i].y);
      ctx.fillStyle = method === "grad" ? P.blue : P.red;
      ctx.beginPath(); ctx.arc(px, py, 4, 0, 2 * Math.PI); ctx.fill();
    }
    // Подписи ставим только там, где они не налезают на уже поставленные:
    // при 34 городах Европа тесная, и «Нижний Новгород» затирает соседей.
    const taken = [];
    const free = (b) => !taken.some((q) =>
      b.x < q.x + q.w && b.x + b.w > q.x && b.y < q.y + q.h && b.y + b.h > q.y);
    ctx.fillStyle = "#2d2d31";
    for (let i = 0; i < n; i++) {
      const px = X(A[i].x), py = Yp(A[i].y);
      const label = CITY[i];
      const tw = ctx.measureText(label).width, th = 12;
      const cand = [
        { x: px + 7, y: py - 6 },
        { x: px - 7 - tw, y: py - 6 },
        { x: px - tw / 2, y: py + 6 },
        { x: px - tw / 2, y: py - 18 },
      ];
      for (const c of cand) {
        const box = { x: c.x, y: c.y, w: tw, h: th };
        if (box.x < plot.x || box.x + tw > plot.x + plot.w) continue;
        if (!free(box)) continue;
        taken.push(box);
        ctx.fillText(label, c.x, c.y + 9);
        break;
      }
    }
    ctx.fillStyle = P.mut; ctx.font = "12px ui-sans-serif, system-ui";
    ctx.fillText("восстановлено из расстояний · серое — где город на самом деле", plot.x, plot.y - 8);

    ctx.strokeStyle = "#e6e2d4"; ctx.lineWidth = 1;
    ctx.strokeRect(curve.x, curve.y, curve.w, curve.h);
    const all = histG.concat(histZ).filter((v) => v > 0);
    const hi = all.length ? Math.max(...all) : 1;
    const lo = all.length ? Math.max(Math.min(...all), hi * 1e-4) : 1e-3;
    const lg = (v) => Math.log10(Math.max(v, lo));
    const cxp = (i, len) => curve.x + (len < 2 ? 0 : (i / (len - 1)) * curve.w);
    const cyp = (v) => curve.y + curve.h - ((lg(v) - lg(lo)) / (lg(hi) - lg(lo) || 1)) * curve.h;

    const line = (h, color, wid) => {
      if (h.length < 2) return;
      ctx.save();
      ctx.strokeStyle = color; ctx.lineWidth = wid;
      ctx.beginPath();
      let started = false;
      h.forEach((v, i) => {
        const px = cxp(i, h.length), py = cyp(v);
        if (!isFinite(px) || !isFinite(py)) return;
        if (started) ctx.lineTo(px, py); else { ctx.moveTo(px, py); started = true; }
      });
      ctx.stroke();
      ctx.beginPath();          // не оставляем путь следующему примитиву
      ctx.restore();
    };
    line(histZ, P.red, 2);
    line(histG, P.blue, 2);

    ctx.font = "12px ui-sans-serif, system-ui";
    ctx.fillStyle = P.mut;
    ctx.fillText("насколько врут расстояния, км (лог-шкала)", curve.x, curve.y - 8);
    ctx.fillStyle = P.blue; ctx.fillText("градиентный", curve.x + 8, curve.y + 16);
    ctx.fillStyle = P.red; ctx.fillText("безградиентный", curve.x + 8, curve.y + 32);

    out.set([
      { k: "городов", v: String(n) },
      { k: "неизвестных", v: String(2 * n) },
      { k: "шаг", v: String(iter) },
      { k: "градиентный", v: histG.length ? histG[histG.length - 1].toFixed(0) + " км" : "—", color: P.blue },
      { k: "безградиентный", v: histZ.length ? histZ[histZ.length - 1].toFixed(0) + " км" : "—", color: P.red },
    ]);
  }

  // ---------- контролы ----------
  S.slider(controls, {
    label: "Городов", min: 4, max: 34, step: 1, value: n,
    fmt: (v) => String(v),
  }, (v) => { n = v; reset(); });

  S.segmented(controls, {
    label: "Показать",
    options: [{ value: "grad", label: "градиентный" }, { value: "zero", label: "безградиентный" }],
    value: method,
  }, (v) => { method = v; });

  S.button(controls, "заново", () => reset());

  S.loadData("mds_europe.json").then((d) => {
    CITY = d.cities; LAT = d.lat; LON = d.lon; DFULL = d.D;
    reset();
    ready = true;
  }).catch((e) => { ready = false; console.error("mds-relax:", e); });

  // S.loop только СОЗДАЁТ цикл — без .start() кадр застывает на заставке.
  S.loop(() => { step(); draw(); }).start();
  draw();
});
