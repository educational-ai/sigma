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
  const W = 760, H = 486;
  const cv = S.makeCanvas(stage, W, H, { maxWidth: 760, pan: false });
  const ctx = cv.ctx;

  const controls = S.row(root, "controls");
  const out = S.readout(root);
  S.caption(root,
    "Цветной след — путь города из случайного начального положения на своё место. Карту " +
    "приходится приложить поворотом и отражением к настоящей географии (крестики): из одних " +
    "расстояний не понять, где север. Внизу — насколько расстояния на восстановленной карте " +
    "расходятся с исходной таблицей. Добавляй города: градиентному методу почти всё равно, " +
    "безградиентный сдаётся.");

  const plot = { x: 20, y: 24, w: 720, h: 352 };
  const curve = { x: 20, y: 400, w: 720, h: 74 };

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

  // Траектория считается ЦЕЛИКОМ заранее, а потом разворачивается одним
  // поворотом по финальному положению — как в визуализации на fmin.xyz.
  // Иначе ориентацию приходится подбирать на ходу: решение MDS определено
  // с точностью до движения, и карта то и дело переворачивалась бы на лету.
  let traj = { grad: [], zero: [] };   // выровненные позиции по шагам
  let errs = { grad: [], zero: [] };   // средняя ошибка расстояний, км
  let cursor = 0;                      // какой шаг проигрываем
  let tween = 0;                       // 0..1 внутри шага
  // След копится на отдельном слое: раньше он хранился списком и ПЕРЕРИСОВЫВАЛСЯ
  // целиком каждый кадр — к концу схождения это тысячи вызовов stroke на кадр,
  // то есть стоимость кадра росла снежным комом. Теперь новые отрезки
  // дорисовываются на слой один раз, а в кадре — один drawImage.
  let trailCv = null, trailCtx = null;
  const STEPS = 260;               // столько шагов считаем вперёд
  let drawnUpTo = 0;               // до какого шага след уже нанесён на слой
  // цвета городов — как в d3.schemeCategory20 у fmin
  const CC = ["#1f77b4","#aec7e8","#ff7f0e","#ffbb78","#2ca02c","#98df8a",
              "#d62728","#ff9896","#9467bd","#c5b0d5","#8c564b","#c49c94",
              "#e377c2","#f7b6d2","#7f7f7f","#c7c7c7","#bcbd22","#dbdb8d",
              "#17becf","#9edae5"];

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

  // Прокруст: поворот + отражение + масштаб + сдвиг. Решение MDS определено
  // с точностью до движения, поэтому «правильной» ориентации у него нет —
  // её приходится назначать, прикладывая результат к настоящей географии.
  // Зеркало НЕ фиксируем: раньше оно выбиралось на первом шаге, когда точки
  // ещё лежали случайным кругом, и карта навсегда оставалась перевёрнутой,
  // хотя сами расстояния были восстановлены верно.
  function align(Y, R) {
    const cy = { x: 0, y: 0 }, cr = { x: 0, y: 0 };
    for (let i = 0; i < n; i++) { cy.x += Y[i].x / n; cy.y += Y[i].y / n; cr.x += R[i].x / n; cr.y += R[i].y / n; }
    const A = Y.map((p) => sub(p, cy)), B = R.map((p) => sub(p, cr));
    let best = null, bestSse = Infinity;
    for (const mir of [1, -1]) {
      let aa = 0, bb = 0, na = 0;
      for (let i = 0; i < n; i++) {
        const ax = A[i].x, ay = mir * A[i].y;
        aa += ax * B[i].x + ay * B[i].y;
        bb += ax * B[i].y - ay * B[i].x;
        na += ax * ax + ay * ay;
      }
      const th = Math.atan2(bb, aa);
      const s = na > 1e-12 ? Math.sqrt(aa * aa + bb * bb) / na : 1;
      const c = Math.cos(th) * s, sn = Math.sin(th) * s;
      const outp = A.map((p) => {
        const ax = p.x, ay = mir * p.y;
        return { x: c * ax - sn * ay + cr.x, y: sn * ax + c * ay + cr.y };
      });
      let sse = 0;
      for (let i = 0; i < n; i++) sse += (outp[i].x - R[i].x) ** 2 + (outp[i].y - R[i].y) ** 2;
      if (sse < bestSse) {
        bestSse = sse;
        best = { pts: outp, tf: { mir, th, s, cy, cr } };
      }
    }
    return best;
  }

  // Градиентный шаг с дроблением: фиксированный шаг на таких масштабах (тысячи
  // километров) заставляет метод перескакивать минимум и выглядеть хуже
  // безградиентного — что неправда и ломает весь смысл сравнения.
  function gradStep() {
    const f0 = err(Yg);
    const g = grad(Yg);
    let gn2 = 0;
    for (const q of g) gn2 += q.x * q.x + q.y * q.y;
    if (gn2 < 1e-14) return;
    let st = stepG;
    for (let k = 0; k < 30; k++) {
      const cand = Yg.map((p, i) => ({ x: p.x - st * g[i].x, y: p.y - st * g[i].y }));
      if (err(cand) < f0) { Yg = cand; stepG = st * 1.8; return; }
      st *= 0.5;
    }
    stepG = Math.max(st, 1e-16);
  }

  // ---------- предпросчёт всей траектории ----------
  // Один раз считаем оба метода до конца, затем разворачиваем каждую траекторию
  // ОДНИМ преобразованием, найденным по её финальному положению. Во время
  // анимации не остаётся ни одной операции оптимизации — только отрисовка.
  function precompute() {
    D = [];
    for (let i = 0; i < n; i++) D.push(DFULL[i].slice(0, n));
    let mx = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) mx = Math.max(mx, D[i][j]);
    scaleKm = mx || 1;

    const R = 0.35 * scaleKm;
    const start = [];
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n, r = R * (0.55 + 0.45 * ((i * 37) % 11) / 11);
      start.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
    }

    Yg = start.map((p) => ({ x: p.x, y: p.y }));
    Yz = start.map((p) => ({ x: p.x, y: p.y }));
    simplex = initSimplex(Yz);
    stepG = 1e-7;

    const rawG = [], rawZ = [];
    errs = { grad: [], zero: [] };
    for (let s = 0; s < STEPS; s++) {
      gradStep(); gradStep();
      simplex = nelderMeadStep(nelderMeadStep(simplex));
      Yz = unflat(simplex[0].v);
      rawG.push(Yg.map((p) => ({ x: p.x, y: p.y })));
      rawZ.push(Yz.map((p) => ({ x: p.x, y: p.y })));
      errs.grad.push(kmErr(Yg));
      errs.zero.push(kmErr(Yz));
    }

    // Разворот считаем по последнему кадру и применяем ко всем — тогда
    // траектория едет как единое целое и ничего не переворачивается по пути.
    const geo = geoRef();
    traj = { grad: applyFinalAlign(rawG, geo), zero: applyFinalAlign(rawZ, geo) };
    cursor = 0; tween = 0; drawnUpTo = 0;
    clearTrail();
  }

  function applyFinalAlign(raw, geo) {
    const fin = align(raw[raw.length - 1], geo);
    const { mir, th, s, cy, cr } = fin.tf;
    const c = Math.cos(th) * s, sn = Math.sin(th) * s;
    return raw.map((pos) => pos.map((p) => {
      const ax = p.x - cy.x, ay = mir * (p.y - cy.y);
      return { x: c * ax - sn * ay + cr.x, y: sn * ax + c * ay + cr.y };
    }));
  }

  // ---------- отрисовка ----------
  let frameCache = null, frameKey = "";
  function frame() {
    const key = n + ":" + (ready ? 1 : 0);
    if (frameCache && frameKey === key) return frameCache;
    const R = geoRef();
    const xs = R.map((p) => p.x), ys = R.map((p) => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    const spanX = (x1 - x0) * 1.16 || 1, spanY = (y1 - y0) * 1.22 || 1;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const k = Math.min(plot.w / spanX, plot.h / spanY);
    frameKey = key;
    frameCache = {
      R,
      X: (v) => plot.x + plot.w / 2 + (v - cx) * k,
      Y: (v) => plot.y + plot.h / 2 - (v - cy) * k,
    };
    return frameCache;
  }

  function ensureTrailLayer() {
    if (trailCv) return;
    trailCv = document.createElement("canvas");
    trailCv.width = W; trailCv.height = H;
    trailCtx = trailCv.getContext("2d");
    // Обрезаем по рамке: безградиентный метод уносит точки далеко за карту,
    // и его след иначе расчерчивает весь виджет, залезая в график ошибки.
    trailCtx.beginPath();
    trailCtx.rect(plot.x, plot.y, plot.w, plot.h);
    trailCtx.clip();
    trailCtx.lineCap = "round";
    trailCtx.lineWidth = 5;
    trailCtx.globalAlpha = 0.18;
  }

  function clearTrail() {
    if (trailCtx) trailCtx.clearRect(0, 0, W, H);
    drawnUpTo = 0;
  }

  // Дорисовываем след только на новые шаги — стоимость кадра постоянная.
  function extendTrail(fr, upTo) {
    const path = traj[method];
    if (!path.length) return;
    ensureTrailLayer();
    for (let s = Math.max(1, drawnUpTo); s <= upTo && s < path.length; s++) {
      const a = path[s - 1], bpt = path[s];
      for (let i = 0; i < n; i++) {
        trailCtx.strokeStyle = CC[i % CC.length];
        trailCtx.beginPath();
        trailCtx.moveTo(fr.X(a[i].x), fr.Y(a[i].y));
        trailCtx.lineTo(fr.X(bpt[i].x), fr.Y(bpt[i].y));
        trailCtx.stroke();
      }
    }
    drawnUpTo = Math.max(drawnUpTo, upTo);
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    if (!ready) {
      ctx.fillStyle = P.mut; ctx.font = "14px ui-sans-serif, system-ui";
      ctx.fillText("Загружаю таблицу расстояний…", 24, 40);
      return;
    }
    const fr = frame();
    const path = traj[method];
    if (!path.length) return;

    ctx.save();
    ctx.strokeStyle = "#e6e2d4"; ctx.lineWidth = 1;
    ctx.strokeRect(plot.x, plot.y, plot.w, plot.h);
    ctx.restore();

    // где город на самом деле
    ctx.save();
    ctx.strokeStyle = "#cfcabb"; ctx.lineWidth = 1;
    for (let i = 0; i < n; i++) {
      const px = fr.X(fr.R[i].x), py = fr.Y(fr.R[i].y);
      ctx.beginPath();
      ctx.moveTo(px - 3.5, py); ctx.lineTo(px + 3.5, py);
      ctx.moveTo(px, py - 3.5); ctx.lineTo(px, py + 3.5);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.restore();

    extendTrail(fr, cursor);
    if (trailCv) ctx.drawImage(trailCv, 0, 0, W, H);

    const i0 = Math.min(cursor, path.length - 1);
    const i1 = Math.min(cursor + 1, path.length - 1);
    const now = path[i0].map((p, i) => ({
      x: p.x + (path[i1][i].x - p.x) * tween,
      y: p.y + (path[i1][i].y - p.y) * tween,
    }));

    ctx.save();
    ctx.beginPath(); ctx.rect(plot.x, plot.y, plot.w, plot.h); ctx.clip();
    for (let i = 0; i < n; i++) {
      const px = fr.X(now[i].x), py = fr.Y(now[i].y);
      ctx.fillStyle = CC[i % CC.length];
      ctx.shadowColor = "rgba(0,0,0,0.25)"; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1;
      ctx.beginPath(); ctx.arc(px, py, 5, 0, 2 * Math.PI); ctx.fill();
    }
    ctx.restore();
    ctx.beginPath();

    ctx.save();
    ctx.beginPath(); ctx.rect(plot.x, plot.y, plot.w, plot.h); ctx.clip();
    ctx.font = "12px ui-sans-serif, system-ui";
    ctx.fillStyle = "#2d2d31";
    ctx.textAlign = "center";
    const taken = [];
    const free = (bx) => !taken.some((q) =>
      bx.x < q.x + q.w && bx.x + bx.w > q.x && bx.y < q.y + q.h && bx.y + bx.h > q.y);
    for (let i = 0; i < n; i++) {
      const px = fr.X(now[i].x), py = fr.Y(now[i].y);
      const label = CITY[i];
      const tw = ctx.measureText(label).width;
      for (const dy of [-16, 12, -28]) {
        const box = { x: px - tw / 2, y: py + dy - 9, w: tw, h: 13 };
        if (box.x < plot.x || box.x + tw > plot.x + plot.w) break;
        if (!free(box)) continue;
        taken.push(box);
        ctx.fillText(label, px, py + dy);
        break;
      }
    }
    ctx.restore();

    ctx.save();
    ctx.fillStyle = P.mut; ctx.font = "12px ui-sans-serif, system-ui";
    ctx.fillText("восстановлено из расстояний · крестики — где город на самом деле", plot.x, plot.y - 8);
    ctx.restore();

    // ---------- полоса ошибки ----------
    ctx.save();
    ctx.strokeStyle = "#e6e2d4"; ctx.lineWidth = 1;
    ctx.strokeRect(curve.x, curve.y, curve.w, curve.h);
    const shown = cursor + 1;
    const hg = errs.grad.slice(0, shown), hz = errs.zero.slice(0, shown);
    const all = errs.grad.concat(errs.zero).filter((v) => v > 0);
    const hi = all.length ? Math.max(...all) : 1;
    const lo = all.length ? Math.max(Math.min(...all), hi * 1e-4) : 1e-3;
    const lg = (v) => Math.log10(Math.max(v, lo));
    const cxp = (i) => curve.x + (i / Math.max(1, STEPS - 1)) * curve.w;
    const cyp = (v) => curve.y + curve.h - ((lg(v) - lg(lo)) / (lg(hi) - lg(lo) || 1)) * curve.h;
    const line = (h, color) => {
      if (h.length < 2) return;
      ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.beginPath();
      let started = false;
      h.forEach((v, i) => {
        const px = cxp(i), py = cyp(v);
        if (!isFinite(px) || !isFinite(py)) return;
        if (started) ctx.lineTo(px, py); else { ctx.moveTo(px, py); started = true; }
      });
      ctx.stroke();
      ctx.beginPath();
    };
    line(hz, P.red);
    line(hg, P.blue);
    ctx.fillStyle = P.mut; ctx.font = "12px ui-sans-serif, system-ui";
    ctx.fillText("насколько врут расстояния, км (лог-шкала)", curve.x, curve.y - 6);
    ctx.restore();

    const cur = (h) => (h.length ? h[Math.min(cursor, h.length - 1)] : null);
    out.set([
      { k: "городов", v: String(n) },
      { k: "неизвестных", v: String(2 * n) },
      { k: "шаг", v: `${Math.min(cursor + 1, STEPS)}/${STEPS}` },
      { k: "градиентный", v: cur(errs.grad) != null ? cur(errs.grad).toFixed(0) + " км" : "—", color: P.blue },
      { k: "безградиентный", v: cur(errs.zero) != null ? cur(errs.zero).toFixed(0) + " км" : "—", color: P.red },
    ]);
  }

  // ---------- контролы ----------
  S.slider(controls, {
    label: "Городов", min: 4, max: 34, step: 1, value: n,
    fmt: (v) => String(v),
  }, (v) => { n = v; if (ready) precompute(); });

  S.segmented(controls, {
    label: "Показать",
    options: [{ value: "grad", label: "градиентный" }, { value: "zero", label: "безградиентный" }],
    value: method,
  }, (v) => { method = v; clearTrail(); });

  S.button(controls, "заново", () => { if (ready) { cursor = 0; tween = 0; clearTrail(); } });

  S.loadData("mds_europe.json").then((d) => {
    CITY = d.cities; LAT = d.lat; LON = d.lon; DFULL = d.D;
    precompute();
    ready = true;
  }).catch((e) => { ready = false; console.error("mds-relax:", e); });

  // S.loop только СОЗДАЁТ цикл — без .start() кадр застывает на заставке.
  const STEP_MS = 70;   // темп проигрывания траектории
  let lastMs = 0;
  S.loop((elapsed) => {
    if (ready) {
      const ms = elapsed * 1000;
      const path = traj[method];
      if (cursor < path.length - 1) {
        const d = ms - lastMs;
        tween = Math.min(1, d / STEP_MS);
        if (d >= STEP_MS) { cursor++; lastMs = ms; tween = 0; }
      } else { tween = 0; lastMs = ms; }
    }
    draw();
  }).start();
  draw();
});
