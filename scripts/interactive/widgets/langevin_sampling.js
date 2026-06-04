// langevin-sampling — как шум превращает оптимизацию в сэмплирование.
// Облако частиц делает overdamped-Ланжевен: x ← x − ∇U·dt + √(2·T·dt)·ξ.
// При T=0 это обычный градиентный спуск — все скатываются в ближайшую яму.
// При T>0 частицы исследуют ВСЕ моды и заселяют их пропорционально e^{−U/T}
// (распределение Больцмана). −∇U — это «score» ∇log p; на нём и стоят
// диффузионные модели. Тяни T: слева — оптимизация, справа — генерация.
SigmaInt.register("langevin-sampling", function (root, opts, S) {
  const P = S.PALETTE;

  root.appendChild(S.el("div", "sigma-int-hint", {
    text: "Облако частиц катится по ландшафту энергии U. Тяни температуру T. При T=0 — чистый " +
      "градиентный спуск: все падают в ближайший минимум. Добавь шум (T>0) — частицы перепрыгивают " +
      "барьеры и заселяют все ямы пропорционально глубине (распределение Больцмана e^{−U/T}). " +
      "Это и есть сэмплирование: оптимизация + шум = генерация.",
  }));

  const stage = S.row(root);
  const W = 720, H = 420;
  const cv = S.makeCanvas(stage, W, H, { maxWidth: 720, pan: false });
  const ctx = cv.ctx;
  const controls = S.row(root, "controls");
  const out = S.readout(root);
  S.caption(root,
    "Overdamped-динамика Ланжевена: $x \\leftarrow x - \\nabla U(x)\\,\\Delta t + \\sqrt{2T\\Delta t}\\,\\xi$. " +
    "Стационарное распределение — больцмановское $p(x)\\propto e^{-U(x)/T}$. При $T\\to0$ остаётся только " +
    "градиентный спуск (поиск минимума), при $T>0$ шум даёт сэмплирование из $p$. Поле $-\\nabla U$ — это " +
    "«score» $\\nabla\\log p$: зная его, можно генерировать образцы. Так устроены score-based и диффузионные " +
    "модели — они учат score и сэмплируют Ланжевеном. Барьеры между модами проходимы только при достаточной " +
    "температуре — отсюда расписание «отжига» шума в диффузии.");

  const NP = 320;
  let T = 0.0, dt = 0.012;
  let parts = null, hist = null;

  // Ландшафт «много ям» (три гауссовы лунки + слабая чаша). U и градиент.
  const wells = [[-1.6, 0.9, 1.25, 1.1], [1.7, 1.0, 1.0, 1.0], [0.2, -1.5, 1.15, 0.95]];
  function U(x, y) {
    let u = 0.06 * (x * x + y * y);
    for (const [cx, cy, A, s] of wells) u -= A * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / s);
    return u;
  }
  function grad(x, y) {
    let gx = 0.12 * x, gy = 0.12 * y;
    for (const [cx, cy, A, s] of wells) {
      const e = A * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / s);
      gx += e * (2 * (x - cx) / s); gy += e * (2 * (y - cy) / s);
    }
    return [gx, gy];
  }
  const DOM = 3.2;

  function rnd() { return Math.random(); } // index-free варьирование ок: это сэмплер
  function gauss() {
    let u = 0, v = 0; while (u === 0) u = rnd(); while (v === 0) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  // Старт из ОДНОГО угла: при T=0 все стекут в одну (ближайшую) яму и застрянут,
  // при T>0 — расползутся по всем модам. Так виден контраст оптимизация↔сэмплирование.
  function reset() {
    parts = [];
    for (let i = 0; i < NP; i++) parts.push([-2.7 + (rnd() - 0.5) * 0.5, 2.4 + (rnd() - 0.5) * 0.5]);
  }
  reset();

  // левая «сцена» — квадрат ландшафта; фон рисуем по энергии U напрямую.
  const cx0 = W * 0.34, cyc = H / 2;
  const SCALE = (Math.min(W * 0.62, H) * 0.46) / DOM;
  const wx = (x) => cx0 + x * SCALE, wy = (y) => cyc - y * SCALE;
  let bg = null;
  function buildBg() {
    const GW = 160, GH = 160, off = document.createElement("canvas");
    off.width = GW; off.height = GH;
    const octx = off.getContext("2d"), img = octx.createImageData(GW, GH);
    let lo = Infinity, hi = -Infinity; const v = new Float32Array(GW * GH);
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const x = (i / (GW - 1) * 2 - 1) * DOM, y = (1 - j / (GH - 1) * 2) * DOM;
      const u = U(x, y); v[j * GW + i] = u; if (u < lo) lo = u; if (u > hi) hi = u;
    }
    for (let p = 0; p < GW * GH; p++) {
      let t = (v[p] - lo) / (hi - lo + 1e-9); t = Math.pow(t, 0.7);
      const r = 40 + t * 170, g = 58 + t * 150, b = 100 + (1 - t) * 70;
      img.data[p * 4] = r; img.data[p * 4 + 1] = g; img.data[p * 4 + 2] = b; img.data[p * 4 + 3] = 255;
    }
    octx.putImageData(img, 0, 0); bg = off;
  }

  function step() {
    const s = Math.sqrt(2 * T * dt);
    for (let i = 0; i < NP; i++) {
      const p = parts[i];
      const [gx, gy] = grad(p[0], p[1]);
      p[0] += -gx * dt + s * gauss();
      p[1] += -gy * dt + s * gauss();
      const lim = DOM * 1.25;
      p[0] = Math.max(-lim, Math.min(lim, p[0]));
      p[1] = Math.max(-lim, Math.min(lim, p[1]));
    }
  }

  // правая панель: заселённость трёх ям (гистограмма)
  function modeCounts() {
    const c = [0, 0, 0]; let off = 0;
    for (const p of parts) {
      let best = -1, bd = 0.9; // радиус «принадлежности» к яме
      for (let k = 0; k < wells.length; k++) {
        const d = Math.hypot(p[0] - wells[k][0], p[1] - wells[k][1]);
        if (d < bd) { bd = d; best = k; }
      }
      if (best >= 0) c[best]++; else off++;
    }
    return { c, off };
  }

  const barX = W * 0.70, barW = W - barX - 16;
  function draw() {
    ctx.clearRect(0, 0, W, H);
    if (!bg) buildBg();
    // ландшафт слева
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(bg, wx(-DOM), wy(DOM), 2 * DOM * SCALE, 2 * DOM * SCALE);
    // частицы
    for (let i = 0; i < NP; i++) {
      const p = parts[i];
      ctx.fillStyle = "rgba(255,210,90,0.85)";
      ctx.beginPath(); ctx.arc(wx(p[0]), wy(p[1]), 2.1, 0, 2 * Math.PI); ctx.fill();
    }
    // центры ям
    for (const [cx, cy] of wells) {
      ctx.strokeStyle = "#fffff8"; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(wx(cx), wy(cy), 3, 0, 2 * Math.PI); ctx.stroke();
    }
    ctx.fillStyle = P.ink; ctx.font = "12px Palatino, Georgia, serif"; ctx.textAlign = "center";
    ctx.fillText("Энергия U и облако частиц", cx0, 16);

    // правая панель — заселённость ям
    const { c, off } = modeCounts();
    ctx.textAlign = "center"; ctx.fillStyle = P.ink;
    ctx.fillText("Заселённость ям", barX + barW / 2, 16);
    const labels = ["яма 1", "яма 2", "яма 3"];
    const cols = [P.blue, P.green, P.gold];
    const maxc = Math.max(1, ...c, off);
    const bh = 34, gap = 16, y0 = 60;
    for (let k = 0; k < 3; k++) {
      const y = y0 + k * (bh + gap);
      const w = (c[k] / NP) * barW;
      ctx.fillStyle = cols[k]; ctx.fillRect(barX, y, w, bh);
      ctx.fillStyle = P.ink; ctx.textAlign = "left"; ctx.font = "11px Palatino, serif";
      ctx.fillText(`${labels[k]}: ${(100 * c[k] / NP).toFixed(0)}%`, barX, y - 3);
    }
    const yb = y0 + 3 * (bh + gap);
    ctx.fillStyle = P.mut; ctx.fillRect(barX, yb, (off / NP) * barW, bh);
    ctx.fillStyle = P.mut; ctx.textAlign = "left";
    ctx.fillText(`на барьерах: ${(100 * off / NP).toFixed(0)}%`, barX, yb - 3);

    const regime = T < 0.02 ? "оптимизация (T→0): спуск в ближайшую яму"
      : T < 0.25 ? "низкая T: редкие перескоки"
      : "сэмплирование: заселяет все моды ∝ e^(−U/T)";
    out.set([
      { k: "температура T", v: T.toFixed(2), color: P.gold },
      { k: "режим", v: regime, color: T < 0.02 ? P.blue : P.green },
      { k: "занятых ям", v: String(c.filter((x) => x > NP * 0.03).length) + " из 3", color: P.mut },
    ]);
  }

  const anim = S.loop(() => { for (let k = 0; k < 2; k++) step(); draw(); });

  S.slider(controls, { label: "температура T", min: 0, max: 1.0, step: 0.01, value: T, fmt: (v) => v.toFixed(2) },
    (v) => { T = v; });
  S.button(controls, "перезапустить частицы", () => reset(), "ghost");

  draw();
  anim.start();
});
