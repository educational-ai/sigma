// resonance-bridge — живой резонанс моста как цепочки масс на пружинах.
// Собственные частоты = корни собств. значений трёхдиаг. матрицы жёсткости K.
// Сверху — пролёт моста, колеблющийся по ближайшей моде; снизу — АЧХ с пиками
// на собственных частотах и бегущим маркером частоты ветра. Всё на чистом JS,
// непрерывная анимация через S.loop. Никаких кнопок.
SigmaInt.register("resonance-bridge", function (root, opts, S) {
  const P = S.PALETTE;

  root.appendChild(S.el("div", "sigma-int-hint", {
    text: "Тяни ползунок частоты ветра к красному пунктиру — мост влетает в резонанс и раскачивается всё сильнее. Меняй число масс и демпфирование.",
  }));

  const stage = S.row(root);
  const cv = S.makeCanvas(stage, 760, 405, { maxWidth: 760 });
  const ctx = cv.ctx;
  const W = 760, H = 405;

  const controls = S.row(root, "controls");
  const out = S.readout(root);
  S.caption(root,
    "Сверху — пролёт моста: цепочка масс на пружинах (концы закреплены), дека колеблется " +
    "по форме моды, ближайшей к частоте ветра. Снизу — амплитудно-частотная характеристика: " +
    "установившаяся амплитуда A(ω)=F/√((ω₀²−ω²)²+(2ζω₀ω)²) растёт в пики на собственных частотах. " +
    "Совпала частота ветра с собственной — резонанс, как у Такомского моста в 1940-м.");

  // --------- параметры ----------
  let n = 8;        // число масс
  let zeta = 0.05;  // демпфирование ζ
  let fWind = 0.12; // частота ветра, Гц
  const F = 1;      // амплитуда силы (нормированная)

  // Геометрия физической модели: длины пружин/масс безразмерны, единичные.
  // λ_m = 2 - 2cos(mπ/(n+1)). Собственная угловая частота ω_m = sqrt(λ_m).
  // Переводим в "Гц" для оси, нормируя по максимально возможной ω (при λ=4 → ω=2):
  // f = ω / (2π) * fScale; подбираем fScale так, чтобы частоты лежали в 0..~0.5 Гц.
  const F_SCALE = 0.5 / (2 / (2 * Math.PI)); // макс ω=2 → 0.5 Гц

  function eigenfreqs(nn) {
    // возвращает массив {lambda, omega, f, mode:m} для m=1..nn
    const arr = [];
    for (let m = 1; m <= nn; m++) {
      const lam = 2 - 2 * Math.cos((m * Math.PI) / (nn + 1));
      const omega = Math.sqrt(lam);
      const f = (omega / (2 * Math.PI)) * F_SCALE;
      arr.push({ m, lambda: lam, omega, f });
    }
    return arr;
  }

  function modeShape(nn, m, i) {
    // φ_m[i] = sin(i m π / (n+1)), i=0..nn+1 (концы 0 и nn+1 закреплены → 0)
    return Math.sin((i * m * Math.PI) / (nn + 1));
  }

  // Установившаяся амплитуда отклика моды на вынуждающую силу частоты ω (рад/с,
  // в той же шкале, что ω_m). A(ω) = F / sqrt((ω0²-ω²)² + (2 ζ ω0 ω)²)
  function modeAmp(omega0, omega, z) {
    const a = omega0 * omega0 - omega * omega;
    const b = 2 * z * omega0 * omega;
    const d = Math.sqrt(a * a + b * b);
    return d < 1e-9 ? F / 1e-9 : F / d;
  }

  // Суммарная (по всем модам) АЧХ амплитуды при частоте ветра f (Гц).
  // Каждая мода возбуждается с весом проекции равномерной силы на форму моды.
  function totalAmp(modes, fHz, z) {
    const omega = (fHz / F_SCALE) * 2 * Math.PI; // обратно в рад/с
    let s = 0;
    for (const md of modes) s += modeWeight(md.m, n) * modeAmp(md.omega, omega, z);
    return { amp: s, omega };
  }

  function modeWeight(m, nn) {
    // проекция равномерной нагрузки на форму моды: |Σ sin(iπm/(n+1))| / норма.
    // Нечётные моды откликаются сильно, чётные почти не возбуждаются равномерной силой.
    let acc = 0;
    for (let i = 1; i <= nn; i++) acc += Math.sin((i * m * Math.PI) / (nn + 1));
    const norm = Math.sqrt(nn / 2);
    return Math.abs(acc) / (norm || 1);
  }

  // ближайшая по частоте мода к ветру
  function nearestMode(modes, fHz) {
    let best = modes[0], bd = Infinity;
    for (const md of modes) {
      const d = Math.abs(md.f - fHz);
      if (d < bd) { bd = d; best = md; }
    }
    const detune = best.f > 1e-9 ? Math.abs(fHz - best.f) / best.f : 1;
    return { mode: best, detune };
  }

  // --------- геометрия рисунка ----------
  const bridge = { x: 50, y: 40, w: W - 100, h: 150 }; // верхний пролёт
  const deckY = bridge.y + bridge.h * 0.5;
  const ampBox = { x: 60, y: 235, w: W - 120, h: 130 }; // АЧХ

  // динамическое состояние колебаний
  let phase = 0;          // фаза колебаний
  let envelope = 0;       // огибающая амплитуды (растёт при резонансе)

  function fmtHz(v) { return v.toFixed(3); }

  // --------- отрисовка ----------
  function draw() {
    ctx.clearRect(0, 0, W, H);
    const modes = eigenfreqs(n);
    const fMaxAxis = 0.5;

    const { mode: near, detune } = nearestMode(modes, fWind);
    const resonance = detune < 0.08;

    // мгновенная амплитуда деки: огибающая × форма моды × cos(phase)
    // визуальный масштаб амплитуды
    const visAmp = Math.max(0.18, Math.min(envelope, 1)) * (bridge.h * 0.42);
    const deckColor = resonance
      ? mixColor(P.blue, P.red, Math.min(1, envelope))
      : P.blue;

    // ---- пролёт моста ----
    // пилоны/опоры по краям
    ctx.strokeStyle = P.mut; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bridge.x, deckY - 30); ctx.lineTo(bridge.x, deckY + 60);
    ctx.moveTo(bridge.x + bridge.w, deckY - 30); ctx.lineTo(bridge.x + bridge.w, deckY + 60);
    ctx.stroke();

    // узлы цепочки: i=0..n+1, концы закреплены
    const xs = [], ys = [];
    for (let i = 0; i <= n + 1; i++) {
      const x = bridge.x + (bridge.w * i) / (n + 1);
      const shape = modeShape(n, near.m, i);
      const y = deckY - visAmp * shape * Math.cos(phase);
      xs.push(x); ys.push(y);
    }

    // огибающая размаха моды: светлая полоса между крайними положениями деки
    // (deckY ∓ visAmp·φ). Видна всегда, даже когда дека проходит через ноль
    // (cos(phase)=0) — форма колебаний читается на любом кадре.
    ctx.fillStyle = resonance ? "rgba(192,57,43,0.12)" : "rgba(31,78,121,0.10)";
    ctx.beginPath();
    for (let i = 0; i <= n + 1; i++) ctx.lineTo(xs[i], deckY - visAmp * modeShape(n, near.m, i));
    for (let i = n + 1; i >= 0; i--) ctx.lineTo(xs[i], deckY + visAmp * modeShape(n, near.m, i));
    ctx.closePath(); ctx.fill();

    // тросы-подвесы (тонкие вертикали от верхней линии к деке) — даёт ощущение моста
    ctx.strokeStyle = "#cfc9b6"; ctx.lineWidth = 1;
    for (let i = 1; i <= n; i++) {
      ctx.beginPath();
      ctx.moveTo(xs[i], bridge.y);
      ctx.lineTo(xs[i], ys[i]);
      ctx.stroke();
    }
    // верхняя несущая
    ctx.strokeStyle = "#cfc9b6"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(bridge.x, bridge.y); ctx.lineTo(bridge.x + bridge.w, bridge.y); ctx.stroke();

    // дека (полотно) — гладкая кривая через узлы
    ctx.strokeStyle = deckColor; ctx.lineWidth = 3; ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(xs[0], ys[0]);
    for (let i = 1; i <= n + 1; i++) ctx.lineTo(xs[i], ys[i]);
    ctx.stroke();

    // массы
    for (let i = 1; i <= n; i++) {
      ctx.fillStyle = deckColor;
      ctx.beginPath(); ctx.arc(xs[i], ys[i], 5, 0, 2 * Math.PI); ctx.fill();
    }
    // закреплённые концы
    for (const i of [0, n + 1]) {
      ctx.fillStyle = P.ink;
      ctx.beginPath(); ctx.arc(xs[i], ys[i], 4, 0, 2 * Math.PI); ctx.fill();
    }

    // стрелки ветра слева
    ctx.strokeStyle = resonance ? P.red : P.mut;
    ctx.fillStyle = resonance ? P.red : P.mut;
    ctx.lineWidth = 1.5;
    for (let r = 0; r < 3; r++) {
      const ay = bridge.y - 8 + r * 12;
      const len = 22 + (resonance ? 8 * Math.abs(Math.cos(phase)) : 0);
      ctx.beginPath();
      ctx.moveTo(bridge.x - 38, ay); ctx.lineTo(bridge.x - 38 + len, ay); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bridge.x - 38 + len, ay);
      ctx.lineTo(bridge.x - 38 + len - 5, ay - 3);
      ctx.lineTo(bridge.x - 38 + len - 5, ay + 3);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = resonance ? P.red : P.mut; ctx.font = "12px Palatino, Georgia, serif"; ctx.textAlign = "left";
    ctx.fillText("ветер", bridge.x - 42, bridge.y - 16);

    // надпись резонанса
    if (resonance) {
      ctx.fillStyle = P.red; ctx.font = "bold 18px Palatino, Georgia, serif"; ctx.textAlign = "center";
      ctx.fillText("РЕЗОНАНС", W / 2, bridge.y - 14);
    }
    // подпись моды
    ctx.fillStyle = P.mut; ctx.font = "12px Palatino, Georgia, serif"; ctx.textAlign = "right";
    ctx.fillText("мода №" + near.m + " (форма колебаний деки)", bridge.x + bridge.w, bridge.y - 16);

    // ---- АЧХ ----
    const xF = S.scale(0, fMaxAxis, ampBox.x, ampBox.x + ampBox.w);
    // Референсный максимум оси — пик ближайшей моды при малом ζ. Ось фиксирована,
    // поэтому при росте ζ пик визуально ОПУСКАЕТСЯ (как и положено по 1/2ζ), а не
    // дёргается под потолком из-за поканадровой перенормировки.
    const A_REF = totalAmp(modes, near.f, 0.02).amp;
    const NPTS = 360;
    const curve = new Float64Array(NPTS + 1);
    for (let i = 0; i <= NPTS; i++) {
      const f = (fMaxAxis * i) / NPTS;
      curve[i] = totalAmp(modes, f, zeta).amp;
    }
    const yA = S.scale(0, A_REF, ampBox.y + ampBox.h, ampBox.y);

    // рамка/ось АЧХ
    S.axes(ctx, ampBox, { xlabel: "частота вынуждающей силы, Гц" });
    ctx.fillStyle = P.ink; ctx.font = "12px Palatino, Georgia, serif"; ctx.textAlign = "center";
    ctx.fillText("амплитуда установившихся колебаний", ampBox.x + ampBox.w / 2, ampBox.y - 12);

    // пунктиры собственных частот — только у реально возбуждаемых мод,
    // чтобы число красных линий совпадало с числом пиков зелёной кривой
    const wMax = Math.max(...modes.map((md) => modeWeight(md.m, n)));
    ctx.setLineDash([3, 4]); ctx.lineWidth = 1;
    for (const md of modes) {
      if (md.f > fMaxAxis) continue;
      if (modeWeight(md.m, n) < 0.05 * wMax) continue;
      ctx.strokeStyle = P.red;
      const X = xF(md.f);
      ctx.beginPath(); ctx.moveTo(X, ampBox.y); ctx.lineTo(X, ampBox.y + ampBox.h); ctx.stroke();
    }
    ctx.setLineDash([]);

    // деления оси X
    ctx.fillStyle = P.mut; ctx.font = "10px Palatino, serif"; ctx.textAlign = "center";
    for (let t = 0; t <= 5; t++) {
      const f = (fMaxAxis * t) / 5;
      ctx.fillText(f.toFixed(2), xF(f), ampBox.y + ampBox.h + 14);
    }

    // кривая АЧХ
    ctx.strokeStyle = P.green; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i <= NPTS; i++) {
      const f = (fMaxAxis * i) / NPTS;
      const X = xF(f), Y = yA(Math.min(curve[i], A_REF));
      i === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
    }
    ctx.stroke();

    // бегущий маркер частоты ветра
    const xw = xF(Math.min(fWind, fMaxAxis));
    const aWind = totalAmp(modes, fWind, zeta).amp;
    const yw = yA(Math.min(aWind, A_REF));
    ctx.strokeStyle = resonance ? P.red : P.blue; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(xw, ampBox.y + ampBox.h); ctx.lineTo(xw, ampBox.y); ctx.stroke();
    ctx.fillStyle = resonance ? P.red : P.blue;
    ctx.beginPath(); ctx.arc(xw, yw, 5, 0, 2 * Math.PI); ctx.fill();
    ctx.font = "11px Palatino, serif"; ctx.textAlign = "center";
    ctx.fillText("ветер", xw, ampBox.y + ampBox.h + 26);

    // read-out
    out.set([
      { k: "ближайшая мода", v: "№" + near.m, color: P.blue },
      { k: "её частота", v: fmtHz(near.f) + " Гц", color: P.red },
      { k: "частота ветра", v: fmtHz(fWind) + " Гц", color: resonance ? P.red : P.blue },
      { k: "расстройка", v: (detune * 100).toFixed(1) + "%", color: resonance ? P.red : P.mut },
      { k: "режим", v: resonance ? "РЕЗОНАНС" : "вне резонанса", color: resonance ? P.red : P.green },
    ]);

    return { near, detune, resonance, modes };
  }

  function mixColor(c1, c2, t) {
    const p = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    const a = p(c1), b = p(c2);
    const m = a.map((x, i) => Math.round(x + (b[i] - x) * t));
    return "rgb(" + m[0] + "," + m[1] + "," + m[2] + ")";
  }

  // --------- анимация ----------
  // Огибающая стремится к установившейся амплитуде; при резонансе быстро растёт,
  // вне резонанса спадает. Скорость колебаний пропорциональна частоте ветра.
  const anim = S.loop((t, ts) => {
    const modes = eigenfreqs(n);
    const { detune } = nearestMode(modes, fWind);
    // Целевая огибающая: видимая базовая раскачка формы моды ВСЕГДА (мост «живой»,
    // дека не лежит плашмя), с резким ростом к резонансу. Knob detune+0.5ζ задаёт
    // остроту резонансного пика.
    const target = Math.min(1, 0.28 + 0.10 / Math.max(0.05, detune + 0.5 * zeta));
    // dt ~ 1/60 c; сглаживание к target
    envelope += (target - envelope) * 0.04;
    // фаза колебаний — медленная, видимая глазом
    phase += (0.6 + fWind * 6) * (1 / 60) * 2 * Math.PI;
    if (phase > 1e6) phase = phase % (2 * Math.PI);
    draw();
  });

  // --------- контролы ----------
  S.slider(controls, {
    label: "Число масс n", min: 3, max: 20, step: 1, value: n, fmt: (v) => v | 0,
  }, (v) => { n = v | 0; });
  S.slider(controls, {
    label: "Демпфирование ζ", min: 0.01, max: 0.3, step: 0.01, value: zeta,
    fmt: (v) => v.toFixed(2),
  }, (v) => { zeta = v; });
  S.slider(controls, {
    label: "Частота ветра", min: 0.01, max: 0.5, step: 0.005, value: fWind, unit: " Гц",
    fmt: (v) => v.toFixed(3),
  }, (v) => { fWind = v; });

  draw();
  anim.start();
});
