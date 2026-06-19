// ica-cocktail — коктейльная вечеринка на РЕАЛЬНОМ звуке.
// Два голоса (клипы StarCraft) смешиваются матрицей A, как два микрофона в
// шумной комнате. Тяни ползунок смешивания: смесь и разделение пересчитываются
// мгновенно, FastICA (чистый JS, без библиотек) восстанавливает оба голоса.
// Клик по строке проигрывает дорожку через Web Audio. Данные: docs/assistant/data.
SigmaInt.register("ica-cocktail", function (root, opts, S) {
  const P = S.PALETTE;

  root.appendChild(S.el("div", "sigma-int-hint", {
    text: "Два голоса записаны вместе, как на вечеринке. Кликни по строке, чтобы её прослушать: сначала смесь (каша из двух голосов), потом то, что ICA разделил обратно. Тяни ползунок смешивания, и всё пересчитывается на лету.",
  }));

  const stage = S.row(root);
  const W = 720, H = 400;
  const cv = S.makeCanvas(stage, W, H, { maxWidth: 720, pan: false });
  const ctx = cv.ctx;
  const controls = S.row(root, "controls");
  const out = S.readout(root);
  S.caption(root,
    "Это задача разделения слепых источников. Два микрофона слышат смесь x = A·s " +
    "двух голосов. Зная только смеси, ICA ищет такое разделение, при котором выходы " +
    "максимально негауссовы и независимы, и так вытаскивает исходные голоса обратно. " +
    "PCA здесь не справится: ему хватает некоррелированности, а голоса разделяет " +
    "именно независимость. Качество в табло считается как корреляция восстановленного " +
    "голоса с оригиналом.");

  // ---------- данные ----------
  let D = null, N = 0, src = null;   // src: [Float64Array, Float64Array] нормированные источники
  let mix = 0.6;                     // сила перекрёстного смешивания
  let A = null, X = null, Y = null;  // матрица, смеси, восстановленное
  let qual = 0;                      // качество разделения (mean |corr|)

  function decI8(b64) {
    const bin = atob(b64); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new Int8Array(u.buffer);
  }

  // ---------- FastICA на 2 источника (чистый JS) ----------
  const mean = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; };
  function fastICA(x0, x1) {
    const n = x0.length;
    const m0 = mean(x0), m1 = mean(x1);
    const a0 = new Float64Array(n), a1 = new Float64Array(n);
    for (let i = 0; i < n; i++) { a0[i] = x0[i] - m0; a1[i] = x1[i] - m1; }
    let c00 = 0, c01 = 0, c11 = 0;
    for (let i = 0; i < n; i++) { c00 += a0[i] * a0[i]; c01 += a0[i] * a1[i]; c11 += a1[i] * a1[i]; }
    c00 /= n; c01 /= n; c11 /= n;
    const tr = c00 + c11, det = c00 * c11 - c01 * c01;
    const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const l1 = tr / 2 + disc, l2 = tr / 2 - disc;
    const evec = (l) => {
      let vx = c01, vy = l - c00;
      if (Math.abs(vx) + Math.abs(vy) < 1e-9) { vx = l - c11; vy = c01; }
      const nr = Math.hypot(vx, vy) || 1; return [vx / nr, vy / nr];
    };
    const e1 = evec(l1), e2 = evec(l2);
    const d1 = 1 / Math.sqrt(Math.max(l1, 1e-9)), d2 = 1 / Math.sqrt(Math.max(l2, 1e-9));
    const z0 = new Float64Array(n), z1 = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const p1 = e1[0] * a0[i] + e1[1] * a1[i], p2 = e2[0] * a0[i] + e2[1] * a1[i];
      z0[i] = d1 * p1; z1[i] = d2 * p2;
    }
    const oneUnit = (w, orth) => {
      for (let it = 0; it < 200; it++) {
        let s0 = 0, s1 = 0, gp = 0;
        for (let i = 0; i < n; i++) {
          const u = w[0] * z0[i] + w[1] * z1[i];
          const g = Math.tanh(u);
          s0 += z0[i] * g; s1 += z1[i] * g; gp += 1 - g * g;
        }
        s0 /= n; s1 /= n; gp /= n;
        let n0 = s0 - gp * w[0], n1 = s1 - gp * w[1];
        if (orth) { const dp = n0 * orth[0] + n1 * orth[1]; n0 -= dp * orth[0]; n1 -= dp * orth[1]; }
        const nr = Math.hypot(n0, n1) || 1; n0 /= nr; n1 /= nr;
        const conv = Math.abs(Math.abs(n0 * w[0] + n1 * w[1]) - 1);
        w = [n0, n1];
        if (conv < 1e-10) break;
      }
      return w;
    };
    const w1 = oneUnit([1, 0], null);
    const w2 = oneUnit([-w1[1], w1[0]], w1);
    const y0 = new Float64Array(n), y1 = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      y0[i] = w1[0] * z0[i] + w1[1] * z1[i];
      y1[i] = w2[0] * z0[i] + w2[1] * z1[i];
    }
    return [y0, y1];
  }

  const corr = (a, b) => {
    const ma = mean(a), mb = mean(b); let num = 0, va = 0, vb = 0;
    for (let i = 0; i < a.length; i++) { const da = a[i] - ma, db = b[i] - mb; num += da * db; va += da * da; vb += db * db; }
    return Math.abs(num / (Math.sqrt(va * vb) + 1e-12));
  };

  function peakNorm(a) {
    let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]));
    const k = 0.9 / (m || 1), o = new Float32Array(a.length);
    for (let i = 0; i < a.length; i++) o[i] = a[i] * k;
    return o;
  }

  // ---------- пересчёт смеси и разделения ----------
  function recompute() {
    A = [[1, mix], [mix * 0.85, 1]];
    const x0 = new Float64Array(N), x1 = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      x0[i] = A[0][0] * src[0][i] + A[0][1] * src[1][i];
      x1[i] = A[1][0] * src[0][i] + A[1][1] * src[1][i];
    }
    X = [x0, x1];
    const rec = fastICA(x0, x1);
    const c00 = corr(rec[0], src[0]), c01 = corr(rec[0], src[1]);
    Y = (c00 >= c01) ? [rec[0], rec[1]] : [rec[1], rec[0]];
    qual = (corr(Y[0], src[0]) + corr(Y[1], src[1])) / 2;
  }

  // ---------- аудио ----------
  let actx = null, curSrc = null, playingUntil = 0, activeRow = -1;
  const now = () => (typeof performance !== "undefined" ? performance.now() : 0);
  function audio() { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); return actx; }
  function playRow(i) {
    const c = audio(); if (c.state === "suspended") c.resume();
    if (curSrc) { try { curSrc.stop(); } catch (e) { } }
    const f = peakNorm(rows[i].get());
    const buf = c.createBuffer(1, f.length, D.rate);
    buf.getChannelData(0).set(f);
    const s = c.createBufferSource(); s.buffer = buf; s.connect(c.destination);
    s.start(); curSrc = s;
    playingUntil = now() + f.length / D.rate * 1000; activeRow = i;
  }

  // ---------- строки ----------
  const rows = [
    { grp: "Голоса по отдельности", lab: "голос A", get: () => src[0], col: P.blue },
    { lab: "голос B", get: () => src[1], col: P.green },
    { grp: "Смесь: что слышат два микрофона", lab: "микрофон 1", get: () => X[0], col: P.mut },
    { lab: "микрофон 2", get: () => X[1], col: P.mut },
    { grp: "ICA разделил обратно", lab: "голос A", get: () => Y[0], col: P.blue },
    { lab: "голос B", get: () => Y[1], col: P.green },
  ];
  const R_TOP = 30, RH = 56, GAP = 16, WFH = 30;
  const PLAYX = 22, LABX = 42, WFX = 150, WFW = 552;
  const rowY = (i) => R_TOP + i * RH + (i >= 2 ? GAP : 0) + (i >= 4 ? GAP : 0);

  function drawWave(arr, x, y, w, h, col, active) {
    const n = arr.length, step = n / w, yc = y + h / 2;
    ctx.strokeStyle = active ? P.red : col; ctx.globalAlpha = active ? 1 : 0.8; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let px = 0; px < w; px++) {
      let mn = 1e9, mx = -1e9;
      const i0 = Math.floor(px * step), i1 = Math.min(n, Math.floor((px + 1) * step));
      for (let i = i0; i < i1; i++) { if (arr[i] < mn) mn = arr[i]; if (arr[i] > mx) mx = arr[i]; }
      if (mn > mx) { mn = mx = 0; }
      ctx.moveTo(x + px + 0.5, yc - mx * h * 0.5);
      ctx.lineTo(x + px + 0.5, yc - mn * h * 0.5);
    }
    ctx.stroke(); ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const active = now() < playingUntil ? activeRow : -1;
    rows.forEach((r, i) => {
      const y = rowY(i);
      if (r.grp) {
        ctx.fillStyle = P.mut; ctx.font = "12px Palatino, Georgia, serif"; ctx.textAlign = "left";
        ctx.fillText(r.grp, 10, y - 16);
      }
      const on = i === active;
      ctx.fillStyle = on ? P.red : P.ink;
      ctx.beginPath(); ctx.moveTo(PLAYX - 5, y + 2); ctx.lineTo(PLAYX - 5, y + 18); ctx.lineTo(PLAYX + 8, y + 10); ctx.closePath(); ctx.fill();
      ctx.fillStyle = P.ink; ctx.font = "12px Palatino, Georgia, serif"; ctx.textAlign = "left";
      ctx.fillText(r.lab, LABX, y + 14);
      drawWave(peakNorm(r.get()), WFX, y - 4, WFW, WFH, r.col, on);
    });
    out.set([
      { k: "смешивание", v: mix.toFixed(2), color: P.gold },
      { k: "det A", v: (1 - mix * mix * 0.85).toFixed(2), color: P.mut },
      { k: "качество разделения", v: qual.toFixed(3), color: P.green },
    ]);
  }
  const redraw = S.rafThrottle(draw);
  const anim = S.loop(() => { if (now() < playingUntil) draw(); });

  S.dragify(cv.canvas, { w: W, h: H }, {
    onDown: (p) => {
      for (let i = 0; i < rows.length; i++) {
        const y = rowY(i);
        if (p.y >= y - 8 && p.y <= y + 24 && p.x <= WFX + WFW) { playRow(i); draw(); return; }
      }
    },
    onHover: (p) => {
      let onAny = false;
      for (let i = 0; i < rows.length; i++) { const y = rowY(i); if (p.y >= y - 8 && p.y <= y + 24 && p.x <= WFX + WFW) onAny = true; }
      cv.canvas.style.cursor = onAny ? "pointer" : "default";
    },
  });

  S.loadData("ica_cocktail_audio.json").then((d) => {
    D = d; N = d.n;
    src = d.sources.map((s) => {
      const q = decI8(s.b64), a = new Float64Array(q.length);
      for (let i = 0; i < q.length; i++) a[i] = q[i] / 127 * s.scale;
      return a;
    });
    recompute();
    S.slider(controls, {
      label: "Смешивание голосов", min: 0.1, max: 0.95, step: 0.01, value: mix, fmt: (v) => v.toFixed(2),
    }, (v) => { mix = v; recompute(); redraw(); });
    S.button(controls, "Сбросить", () => { mix = 0.6; recompute(); redraw(); }, "ghost");
    draw(); anim.start();
  }).catch((e) => {
    root.appendChild(S.el("div", "sigma-int-err", { text: "Не загрузились аудиоданные ICA: " + e.message }));
  });
});
