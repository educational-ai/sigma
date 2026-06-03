// fft-spectrum — два тона x(t)=sin(2πf₁t)+sin(2πf₂t) и их амплитудный спектр |X_k|.
// Двигаешь частоты — осциллограмма и спектр пересчитываются мгновенно. ДПФ прямой
// суммой O(N²) на чистом JS. Каждая строка k матрицы F_N «настроена» на k·fs/N Гц;
// два тона → два пика на строках round(f·N/fs). Это и есть то, что хеширует Shazam.
SigmaInt.register("fft-spectrum", function (root, opts, S) {
  const P = S.PALETTE;

  root.appendChild(S.el("div", "sigma-int-hint", {
    text: "Тяни ползунки f₁ и f₂ — слева сумма двух синусоид, справа её спектр |X_k|. " +
          "Два тона дают ровно два пика. Меняй N и fs, чтобы увидеть разрешение по частоте.",
  }));

  const stage = S.row(root);
  const cv = S.makeCanvas(stage, 760, 320, { maxWidth: 760 });
  const ctx = cv.ctx;

  const controls = S.row(root, "controls");
  const out = S.readout(root);
  S.caption(root,
    "Слева — первые отсчёты сигнала во времени; справа — амплитуда |X_k| по нижней " +
    "половине частот. Строка k матрицы Фурье F_N — это «камертон», настроенный на " +
    "частоту k·fs/N; тон отзывается там, где камертон совпал с ним, давая пик.");

  // состояние
  let f1 = 440, f2 = 1200, N = 512, fs = 8000;
  // экранные позиции пиков (логические X) и текущий предел оси — для hit-testing мышью
  const hit = { kMax: 1, peaks: [{ which: 1, screenX: 0 }, { which: 2, screenX: 0 }] };

  // геометрия (логические 760×320)
  const top = 26, bot = 256, lx = 56;
  const wavBox  = { x: lx,       y: top, w: 300, h: bot - top };
  const specBox = { x: lx + 360, y: top, w: 320, h: bot - top };

  // ---- ДПФ: амплитуды только нижней половины (k = 0..N/2) ----
  function dft(sig) {
    const n = sig.length, half = (n >> 1);
    const amp = new Float32Array(half + 1);
    // предрасчёт cos/sin по углу 2π/n чтобы не звать Math.* в горячем цикле
    const baseCos = new Float64Array(n), baseSin = new Float64Array(n);
    for (let t = 0; t < n; t++) {
      const a = (2 * Math.PI * t) / n;
      baseCos[t] = Math.cos(a); baseSin[t] = Math.sin(a);
    }
    for (let k = 0; k <= half; k++) {
      let re = 0, im = 0;
      for (let t = 0; t < n; t++) {
        const idx = (k * t) % n;      // угол = 2π k t / n
        re += sig[t] * baseCos[idx];
        im -= sig[t] * baseSin[idx];
      }
      amp[k] = Math.sqrt(re * re + im * im) / n * 2; // нормировка к амплитуде тона
    }
    return amp;
  }

  function genSignal() {
    const sig = new Float64Array(N);
    for (let t = 0; t < N; t++) {
      const tt = t / fs;
      sig[t] = Math.sin(2 * Math.PI * f1 * tt) + Math.sin(2 * Math.PI * f2 * tt);
    }
    return sig;
  }

  // индекс строки матрицы, на который попадает частота f
  function binOf(f) { return Math.round((f * N) / fs); }

  function draw() {
    ctx.clearRect(0, 0, 760, 320);
    ctx.lineJoin = "round";

    const sig = genSignal();
    const amp = dft(sig);
    const half = amp.length - 1;        // = N/2
    const nyq = fs / 2;                  // Гц, верхняя граница спектра
    // потолок слайдеров 2000 Гц + ~10% запас → не рисуем мёртвую правую половину
    const kMax = Math.min(half, Math.ceil((2200 * N) / fs));

    // ===== Осциллограмма (первые ~128 отсчётов) =====
    const SHOW = Math.min(128, N);
    const xt = S.scale(0, SHOW - 1, wavBox.x, wavBox.x + wavBox.w);
    const yt = S.scale(-2.2, 2.2, wavBox.y + wavBox.h, wavBox.y);

    // рамка + ноль
    ctx.strokeStyle = P.grid; ctx.lineWidth = 1;
    ctx.strokeRect(wavBox.x, wavBox.y, wavBox.w, wavBox.h);
    ctx.beginPath(); ctx.moveTo(wavBox.x, yt(0)); ctx.lineTo(wavBox.x + wavBox.w, yt(0)); ctx.stroke();

    // две отдельные синусоиды бледно (педагогика: сумма складывается из них)
    [[f1, P.red], [f2, P.green]].forEach(([f, col]) => {
      ctx.strokeStyle = col; ctx.globalAlpha = 0.28; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let t = 0; t < SHOW; t++) {
        const v = Math.sin(2 * Math.PI * f * (t / fs));
        const X = xt(t), Y = yt(v);
        t === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
      }
      ctx.stroke();
    });
    ctx.globalAlpha = 1;

    // сумма (жирно, синяя)
    ctx.strokeStyle = P.blue; ctx.lineWidth = 1.8; ctx.beginPath();
    for (let t = 0; t < SHOW; t++) {
      const X = xt(t), Y = yt(sig[t]);
      t === 0 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y);
    }
    ctx.stroke();

    ctx.fillStyle = P.ink; ctx.font = "13px Palatino, Georgia, serif"; ctx.textAlign = "center";
    ctx.fillText("x(t) = sin 2π f₁t + sin 2π f₂t", wavBox.x + wavBox.w / 2, wavBox.y - 10);
    ctx.fillStyle = P.mut; ctx.font = "11px Palatino, serif";
    ctx.fillText("время →  (первые " + SHOW + " отсчётов)", wavBox.x + wavBox.w / 2, wavBox.y + wavBox.h + 18);

    // ===== Спектр |X_k| =====
    const xf = S.scale(0, kMax, specBox.x, specBox.x + specBox.w);
    let amax = 1e-9;
    for (let k = 0; k <= kMax; k++) if (amp[k] > amax) amax = amp[k];
    const yf = S.scale(0, amax * 1.12, specBox.y + specBox.h, specBox.y);

    ctx.strokeStyle = P.grid; ctx.lineWidth = 1;
    ctx.strokeRect(specBox.x, specBox.y, specBox.w, specBox.h);

    // линии стебля (stem plot)
    ctx.strokeStyle = P.mut; ctx.lineWidth = 1;
    const dx = specBox.w / kMax;
    const thin = dx < 1.5;
    for (let k = 0; k <= kMax; k++) {
      const X = xf(k), Y = yf(amp[k]);
      if (thin) {
        // плотный спектр — заливка
        ctx.beginPath(); ctx.moveTo(X, yf(0)); ctx.lineTo(X, Y); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.moveTo(X, yf(0)); ctx.lineTo(X, Y); ctx.stroke();
        ctx.fillStyle = P.mut; ctx.beginPath(); ctx.arc(X, Y, 1.6, 0, 2 * Math.PI); ctx.fill();
      }
    }

    // подсветка двух целевых пиков
    const peaks = [
      { f: f1, k: Math.min(binOf(f1), half), col: P.red },
      { f: f2, k: Math.min(binOf(f2), half), col: P.green },
    ];
    hit.kMax = kMax;
    peaks.forEach((pk, i) => {
      const X = xf(pk.k), Y = yf(amp[pk.k]);
      hit.peaks[i].screenX = X;
      ctx.strokeStyle = pk.col; ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(X, yf(0)); ctx.lineTo(X, Y); ctx.stroke();
      ctx.fillStyle = pk.col; ctx.beginPath(); ctx.arc(X, Y, 3.4, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = pk.col; ctx.font = "11px Palatino, serif"; ctx.textAlign = "center";
      const Y_label = Math.max(Y - 7, specBox.y + 12); // не лезть за верхнюю рамку/заголовок
      ctx.fillText("k=" + pk.k, X, Y_label);
    });

    ctx.fillStyle = P.ink; ctx.font = "13px Palatino, Georgia, serif"; ctx.textAlign = "center";
    ctx.fillText("|X_k| — амплитудный спектр", specBox.x + specBox.w / 2, specBox.y - 10);

    // ось частот: 0, середина, верхняя граница (по новому пределу kMax)
    ctx.fillStyle = P.mut; ctx.font = "10px Palatino, serif";
    [[0, "0"], [kMax / 2, Math.round(kMax * fs / N / 2) + " Гц"], [kMax, Math.round(kMax * fs / N) + " Гц"]]
      .forEach(([k, lbl]) => {
        ctx.fillText(lbl, xf(k), specBox.y + specBox.h + 16);
      });
    ctx.fillText("частота k·fs/N →", specBox.x + specBox.w / 2, specBox.y + specBox.h + 30);

    // read-out
    out.set([
      { k: "Пик 1:", v: f1 + " Гц → строка №" + peaks[0].k + " матрицы F_N", color: P.red },
      { k: "Пик 2:", v: f2 + " Гц → строка №" + peaks[1].k + " матрицы F_N", color: P.green },
      { k: "разрешение Δf =", v: (fs / N).toFixed(1) + " Гц/бин", color: P.mut },
      { k: "N×fs", v: N + " × " + fs, color: P.blue },
    ]);
  }

  const redraw = S.rafThrottle(draw);

  // ---- контролы ----
  const sl1 = S.slider(controls, {
    label: "Частота f₁", min: 100, max: 2000, step: 10, value: f1, unit: " Гц", fmt: (v) => v,
  }, (v) => { f1 = v | 0; redraw(); });

  const sl2 = S.slider(controls, {
    label: "Частота f₂", min: 100, max: 2000, step: 10, value: f2, unit: " Гц", fmt: (v) => v,
  }, (v) => { f2 = v | 0; redraw(); });

  S.select(controls, {
    label: "N", value: String(N),
    options: [{ value: "256", label: "256" }, { value: "512", label: "512" }, { value: "1024", label: "1024" }],
  }, (v) => { N = +v; redraw(); });

  S.select(controls, {
    label: "fs", value: String(fs),
    options: [{ value: "8000", label: "8000 Гц" }, { value: "16000", label: "16000 Гц" }],
  }, (v) => { fs = +v; redraw(); });

  // ---- перетаскивание пиков прямо на спектре (tactile) ----
  const canvas = cv.canvas;
  // CSS-пиксели курсора → логический X (канвас рисует в координатах 760×320)
  function logicalX(ev) {
    const r = canvas.getBoundingClientRect();
    return ((ev.clientX - r.left) / (r.width || 1)) * 760;
  }
  // логический X на спектре → частота, привязанная к сетке 10 Гц и потолку слайдеров
  function freqAtX(X) {
    const kf = ((X - specBox.x) / specBox.w) * hit.kMax; // дробный бин
    const f = (kf * fs) / N;
    return Math.min(2000, Math.max(100, Math.round(f / 10) * 10));
  }
  function nearestPeak(X) {
    let best = -1, bestD = 12; // порог 12px (логических)
    hit.peaks.forEach((p, i) => {
      const d = Math.abs(X - p.screenX);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }
  let dragIdx = -1;
  canvas.addEventListener("pointerdown", (ev) => {
    const X = logicalX(ev);
    const i = nearestPeak(X);
    if (i < 0) return;
    dragIdx = i;
    canvas.setPointerCapture && canvas.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });
  canvas.addEventListener("pointermove", (ev) => {
    const X = logicalX(ev);
    if (dragIdx < 0) {
      canvas.style.cursor = nearestPeak(X) >= 0 ? "ew-resize" : "";
      return;
    }
    const f = freqAtX(X);
    if (dragIdx === 0) { f1 = f; sl1.set(f); } else { f2 = f; sl2.set(f); }
    redraw();
    ev.preventDefault();
  });
  function endDrag() { dragIdx = -1; }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  draw();
});
