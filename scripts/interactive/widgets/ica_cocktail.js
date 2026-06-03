// ica-cocktail — геометрия ICA vs PCA в реальном времени.
// Облако ≈1500 точек из равномерного квадрата [-1,1]² смешивается матрицей A,
// столбцы которой = два ДРАГ-вектора-стрелки из начала координат. Тянешь стрелку —
// квадрат мгновенно морфится в параллелограмм. Поверх: оси PCA (аналитическое
// собств. разложение 2×2 ковариации) и оси ICA (стороны параллелограмма = столбцы A).
// Никаких кнопок «Запустить»: всё пересчитывается при перетаскивании.
SigmaInt.register("ica-cocktail", function (root, opts, S) {
  const P = S.PALETTE;

  root.appendChild(S.el("div", "sigma-int-hint", {
    text: "Тяни синюю и красную стрелки — это столбцы матрицы смешивания A. Квадрат источников превращается в параллелограмм. Сравни оси PCA (декорреляция) и ICA (восстановленные стороны).",
  }));

  const stage = S.row(root);
  const W = 640, H = 440;
  const cv = S.makeCanvas(stage, W, H, { maxWidth: 640, pan: false });
  const ctx = cv.ctx;

  const controls = S.row(root, "controls");
  const out = S.readout(root);
  S.caption(root,
    "Слева невидимый квадрат [-1,1]² (два независимых равномерных источника). " +
    "После смешивания x = A·s он становится параллелограммом. Оси PCA (зелёные) " +
    "ортогональны и идут вдоль дисперсии эллипса — но не вдоль сторон. Оси ICA " +
    "(золотые) ловят сами стороны параллелограмма, то есть исходные источники. " +
    "Чтобы выделить отдельный источник, ICA проецирует данные вдоль направления, " +
    "перпендикулярного ДРУГОЙ стороне, — тогда вклад второго источника обнуляется. " +
    "Куртозис проекций показывает негауссовость: у источников он отрицателен, у смеси ближе к нулю.");

  // ---- источники: равномерный квадрат [-1,1]² (фиксированы, детерминированы) ----
  const Npts = 1500;
  const S0 = new Float32Array(Npts * 2);
  (function genSources() {
    // детерминированный PRNG, чтобы облако не «дрожало» между перерисовками
    let seed = 0x2545f491;
    const rnd = () => {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; seed |= 0;
      return ((seed >>> 0) / 4294967296);
    };
    for (let i = 0; i < Npts; i++) {
      S0[2 * i] = rnd() * 2 - 1;
      S0[2 * i + 1] = rnd() * 2 - 1;
    }
  })();

  // ---- матрица смешивания A = [[a11,a12],[a21,a22]] ----
  // Столбцы A — это куда отображаются базисные векторы источников e1,e2.
  // Храним столбцы как векторы (мировые координаты, единицы источника).
  let col1 = { x: 1.0, y: 0.3 };  // A[:,0]  (синяя стрелка)
  let col2 = { x: 0.4, y: 1.0 };  // A[:,1]  (красная стрелка)

  // ---- мировая система координат: world units → пиксели ----
  // Диапазон мира ~[-3,3] чтобы вместить вытянутые параллелограммы
  const WR = 2.6;
  const cx = W / 2, cy = H / 2;
  const px = S.scale(-WR, WR, cx - 215, cx + 215);  // x: world→px
  const py = S.scale(-WR, WR, cy + 215, cy - 215);  // y: world→px (инверсия)

  let mode = "ica"; // "mix" | "pca" | "ica"

  // -------------------- математика 2×2 --------------------
  // Смешивание точки источника s=(s1,s2): x = s1*col1 + s2*col2
  function mix(s1, s2) {
    return { x: s1 * col1.x + s2 * col2.x, y: s1 * col1.y + s2 * col2.y };
  }

  // Ковариация смешанного облака (аналитически из col1,col2).
  // Источники s1,s2 ~ U[-1,1] независимы: Var=1/3, Cov=0.
  // Cov(x) = (1/3) (col1 col1^T + col2 col2^T).
  function covMix() {
    const v = 1 / 3;
    const c11 = v * (col1.x * col1.x + col2.x * col2.x);
    const c22 = v * (col1.y * col1.y + col2.y * col2.y);
    const c12 = v * (col1.x * col1.y + col2.x * col2.y);
    return { c11, c12, c22 };
  }

  // Собственное разложение симметричной 2×2 → {l1,l2 (l1≥l2), v1,v2}
  function eig2(c11, c12, c22) {
    const tr = c11 + c22;
    const det = c11 * c22 - c12 * c12;
    const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const l1 = tr / 2 + disc;
    const l2 = tr / 2 - disc;
    let v1;
    if (Math.abs(c12) > 1e-9) {
      v1 = { x: l1 - c22, y: c12 };
    } else {
      v1 = c11 >= c22 ? { x: 1, y: 0 } : { x: 0, y: 1 };
    }
    const n1 = Math.hypot(v1.x, v1.y) || 1;
    v1 = { x: v1.x / n1, y: v1.y / n1 };
    const v2 = { x: -v1.y, y: v1.x }; // ортогональ
    return { l1: Math.max(0, l1), l2: Math.max(0, l2), v1, v2 };
  }

  // Куртозис проекции облака на единичный вектор u (excess kurtosis)
  function kurtosisOn(ux, uy) {
    let m2 = 0, m4 = 0;
    for (let i = 0; i < Npts; i++) {
      const X = mix(S0[2 * i], S0[2 * i + 1]);
      const p = X.x * ux + X.y * uy;
      const p2 = p * p;
      m2 += p2; m4 += p2 * p2;
    }
    m2 /= Npts; m4 /= Npts;
    if (m2 < 1e-12) return 0;
    return m4 / (m2 * m2) - 3;
  }

  // -------------------- рисование --------------------
  function arrow(x0, y0, x1, y1, color, lw) {
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    const ang = Math.atan2(y1 - y0, x1 - x0), a = 9;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - a * Math.cos(ang - 0.45), y1 - a * Math.sin(ang - 0.45));
    ctx.lineTo(x1 - a * Math.cos(ang + 0.45), y1 - a * Math.sin(ang + 0.45));
    ctx.closePath(); ctx.fill();
  }

  function line2(ux, uy, len, color, lw, dash) {
    const x0 = px(-ux * len), y0 = py(-uy * len);
    const x1 = px(ux * len), y1 = py(uy * len);
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = lw;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.restore();
  }

  // pixel-позиции концов драг-стрелок
  function tip1() { return { x: px(col1.x), y: py(col1.y) }; }
  function tip2() { return { x: px(col2.x), y: py(col2.y) }; }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // сетка
    ctx.strokeStyle = P.grid; ctx.lineWidth = 1;
    for (let g = -2; g <= 2; g++) {
      if (g === 0) continue;
      ctx.beginPath(); ctx.moveTo(px(g), py(-WR)); ctx.lineTo(px(g), py(WR)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px(-WR), py(g)); ctx.lineTo(px(WR), py(g)); ctx.stroke();
    }
    // оси координат
    ctx.strokeStyle = P.axis; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(px(-WR), py(0)); ctx.lineTo(px(WR), py(0)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(px(0), py(-WR)); ctx.lineTo(px(0), py(WR)); ctx.stroke();

    // облако смешанных точек
    ctx.fillStyle = "rgba(31,78,121,0.40)";
    for (let i = 0; i < Npts; i++) {
      const X = mix(S0[2 * i], S0[2 * i + 1]);
      ctx.fillRect(px(X.x) - 1.0, py(X.y) - 1.0, 2.0, 2.0);
    }

    // контур параллелограмма (углы квадрата (±1,±1) → смесь)
    const corners = [mix(-1, -1), mix(1, -1), mix(1, 1), mix(-1, 1)];
    ctx.strokeStyle = "rgba(17,17,17,0.45)"; ctx.lineWidth = 1.8;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    corners.forEach((c, i) => {
      const X = px(c.x), Y = py(c.y);
      i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
    });
    ctx.closePath(); ctx.stroke();
    ctx.setLineDash([]);

    const cov = covMix();
    const E = eig2(cov.c11, cov.c12, cov.c22);

    // оси PCA (зелёные, ортогональные, длина ∝ √λ)
    if (mode === "pca" || mode === "ica") {
      const s1 = Math.sqrt(E.l1) * 1.8, s2 = Math.sqrt(E.l2) * 1.8;
      const ghost = mode === "pca" ? 1 : 0.42;
      ctx.globalAlpha = ghost;
      arrow(px(0), py(0), px(E.v1.x * s1), py(E.v1.y * s1), P.green, mode === "pca" ? 2.6 : 1.8);
      arrow(px(0), py(0), px(E.v2.x * s2), py(E.v2.y * s2), P.green, mode === "pca" ? 2.6 : 1.8);
      // продолжение линий пунктиром
      line2(E.v1.x, E.v1.y, WR, P.green, 1, [2, 4]);
      line2(E.v2.x, E.v2.y, WR, P.green, 1, [2, 4]);
      ctx.globalAlpha = 1;
    }

    // оси ICA (золотые) = направления столбцов A (стороны параллелограмма)
    if (mode === "ica") {
      const n1 = Math.hypot(col1.x, col1.y) || 1;
      const n2 = Math.hypot(col2.x, col2.y) || 1;
      line2(col1.x / n1, col1.y / n1, WR, P.gold, 1.4, [6, 4]);
      line2(col2.x / n2, col2.y / n2, WR, P.gold, 1.4, [6, 4]);
    }

    // драг-стрелки = столбцы A (всегда видны и тянутся)
    const t1 = tip1(), t2 = tip2();
    arrow(px(0), py(0), t1.x, t1.y, P.blue, 3);
    arrow(px(0), py(0), t2.x, t2.y, P.red, 3);
    // ручки
    [[t1, P.blue, "a₁"], [t2, P.red, "a₂"]].forEach(([t, col, lab]) => {
      ctx.fillStyle = "#fffff8"; ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(t.x, t.y, 7, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      ctx.fillStyle = col; ctx.font = "bold 13px Palatino, Georgia, serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(lab, t.x, t.y - 16);
    });
    ctx.textBaseline = "alphabetic";

    // легенда осей
    ctx.font = "12px Palatino, Georgia, serif"; ctx.textAlign = "left";
    let ly = 22;
    const leg = (color, txt) => {
      ctx.strokeStyle = color; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(14, ly - 4); ctx.lineTo(34, ly - 4); ctx.stroke();
      ctx.fillStyle = P.ink; ctx.fillText(txt, 40, ly);
      ly += 18;
    };
    leg(P.blue, "столбцы A (тяни)");
    if (mode === "pca" || mode === "ica") leg(P.green, "оси PCA (декорреляция)");
    if (mode === "ica") leg(P.gold, "оси ICA (источники)");

    // -------- read-out --------
    // негауссовость: куртозис проекции вдоль строки A⁻¹ (восстановленный источник s1)
    // vs на ось PCA №1. Строка 1 A⁻¹ = нормаль к col2: проекция обнуляет вклад s2.
    const ni1 = Math.hypot(col1.x, col1.y) || 1;
    const detA = col1.x * col2.y - col1.y * col2.x;
    let kICA;
    if (Math.abs(detA) < 1e-6) {
      kICA = 0; // A вырождена — направление не определено
    } else {
      const ux = col2.y / detA, uy = -col2.x / detA;
      const nu = Math.hypot(ux, uy) || 1;
      kICA = kurtosisOn(ux / nu, uy / nu);
    }
    const kPCA = kurtosisOn(E.v1.x, E.v1.y);
    // угол между сторонами параллелограмма (мера «коллапса» A)
    const dotc = (col1.x * col2.x + col1.y * col2.y) / (ni1 * (Math.hypot(col2.x, col2.y) || 1));
    const angle = Math.acos(Math.max(-1, Math.min(1, dotc))) * 180 / Math.PI;
    const det = col1.x * col2.y - col1.y * col2.x;

    const f2 = (x) => (Math.abs(x) < 1e-3 ? "0.00" : x.toFixed(2));
    out.set([
      { k: "A =", v: "[[" + f2(col1.x) + ", " + f2(col2.x) + "], [" + f2(col1.y) + ", " + f2(col2.y) + "]]", color: P.ink },
      { k: "det A", v: f2(det) + (Math.abs(det) < 0.05 ? " ⚠ вырождена" : ""), color: Math.abs(det) < 0.05 ? P.red : P.mut },
      { k: "угол сторон", v: angle.toFixed(0) + "°", color: P.gold },
      { k: "куртозис ICA-проекции", v: kICA.toFixed(2), color: P.gold },
      { k: "куртозис PCA-проекции", v: kPCA.toFixed(2), color: P.green },
      { k: "(гаусс)", v: "0.00", color: P.mut },
    ]);
  }

  const redraw = S.rafThrottle(draw);

  // -------------------- перетаскивание стрелок --------------------
  let dragging = null; // "c1" | "c2" | null
  function pick(p) {
    const t1 = tip1(), t2 = tip2();
    const d1 = Math.hypot(p.x - t1.x, p.y - t1.y);
    const d2 = Math.hypot(p.x - t2.x, p.y - t2.y);
    if (d1 < 22 && d1 <= d2) return "c1";
    if (d2 < 22) return "c2";
    return null;
  }
  function setFrom(p) {
    // p в логических координатах канваса (w×h) → мировые
    let wx = px.inv(p.x), wy = py.inv(p.y);
    wx = Math.max(-WR + 0.05, Math.min(WR - 0.05, wx));
    wy = Math.max(-WR + 0.05, Math.min(WR - 0.05, wy));
    if (dragging === "c1") col1 = { x: wx, y: wy };
    else if (dragging === "c2") col2 = { x: wx, y: wy };
    redraw();
  }

  S.dragify(cv.canvas, { w: W, h: H }, {
    onDown: (p) => { dragging = pick(p); if (dragging) setFrom(p); },
    onMove: (p) => { if (dragging) setFrom(p); },
    onUp: () => { dragging = null; },
    onHover: (p) => {
      cv.canvas.style.cursor = pick(p) ? "grab" : "default";
    },
  });

  // -------------------- контролы --------------------
  S.segmented(controls, {
    label: "Показать",
    value: "ica",
    options: [
      { value: "mix", label: "смесь" },
      { value: "pca", label: "PCA-оси" },
      { value: "ica", label: "ICA-оси" },
    ],
  }, (v) => { mode = v; redraw(); });

  S.button(controls, "Сбросить A", () => {
    col1 = { x: 1.0, y: 0.3 };
    col2 = { x: 0.4, y: 1.0 };
    redraw();
  });

  draw();
});
