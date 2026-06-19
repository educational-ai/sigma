// pca_eigenfaces — живая реконструкция РЕАЛЬНОГО лица (Olivetti) из k
// собственных лиц. Двигаешь k — лицо пересобирается мгновенно. Никакой кнопки.
SigmaInt.register("pca-eigenfaces", function (root, opts, S) {
  const P = S.PALETTE;

  root.appendChild(S.el("div", "sigma-int-hint", {
    text: "Двигай k: лицо собирается из собственных лиц в реальном времени. Кликни по кривой справа, чтобы задать k.",
  }));

  const stage = S.row(root);
  const cv = S.makeCanvas(stage, 760, 360, { maxWidth: 760 });
  const ctx = cv.ctx;

  const controls = S.row(root, "controls");
  const out = S.readout(root);
  S.caption(root,
    "Слева настоящая фотография из датасета Olivetti. В центре её приближение " +
    "первыми k главными компонентами (eigenfaces). Справа среднее лицо, точка отсчёта. " +
    "Внизу сами собственные лица; подсвечены те, что уже вошли в сумму. " +
    "Виджет показывает первые 60 компонент (≈89% объяснённой дисперсии); чтобы добраться до 95%, " +
    "нужно ~123 компоненты. Каждое лицо при этом задаётся 60 коэффициентами вместо 4096 пикселей, " +
    "если общий базис из этих собственных лиц хранить один раз на всю коллекцию.");

  let D = null, N = 0, faceIdx = 0, k = 10, basis = null;

  function decodeI8(b64) {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new Int8Array(u.buffer);
  }
  function decodeU8(b64) {
    const bin = atob(b64);
    const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }

  function reconstruct(coords, kk) {
    const rec = D.mean.slice();
    for (let i = 0; i < kk; i++) {
      const c = coords[i], sc = D.scales[i] / 127, base = i * N;
      if (c === 0) continue;
      for (let p = 0; p < N; p++) rec[p] += c * basis[base + p] * sc;
    }
    return rec;
  }

  function eigenfaceNorm(i) {
    // i-й eigenface как картинка [-1,1] для coolwarm
    const base = i * N, sc = D.scales[i] / 127, img = new Float32Array(N);
    let mx = 1e-9;
    for (let p = 0; p < N; p++) { img[p] = basis[base + p] * sc; if (Math.abs(img[p]) > mx) mx = Math.abs(img[p]); }
    for (let p = 0; p < N; p++) img[p] /= mx;
    return img;
  }

  // геометрия панелей (логические координаты 760×360)
  const PS = 128;            // размер лицевой панели
  const top = 30, lx = 6;
  const panels = {
    orig: { x: lx, y: top, w: PS, h: PS, label: "Оригинал" },
    rec:  { x: lx + PS + 20, y: top, w: PS, h: PS, label: "Реконструкция" },
    mean: { x: lx + 2 * (PS + 20), y: top, w: PS, h: PS, label: "Среднее лицо" },
  };
  const curveBox = { x: 470, y: top + 6, w: 270, h: PS - 6 };
  // полоса собственных лиц
  const strip = { x: lx, y: top + PS + 42, w: 748, n: 16, gap: 6 };
  strip.cell = Math.floor((strip.w - (strip.n - 1) * strip.gap) / strip.n);

  let xK; // шкала индекс→пиксель кривой

  function drawPanel(box, flat01, cmap, highlight) {
    ctx.fillStyle = "#000"; ctx.fillRect(box.x, box.y, box.w, box.h);
    S.drawImage(ctx, flat01, D.w, D.h, box, cmap);
    ctx.strokeStyle = highlight || "#d8d2bf"; ctx.lineWidth = highlight ? 2 : 1;
    ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
    ctx.fillStyle = P.mut; ctx.font = "13px Palatino, Georgia, serif"; ctx.textAlign = "center";
    ctx.fillText(box.label, box.x + box.w / 2, box.y - 8);
  }

  function draw() {
    ctx.clearRect(0, 0, 760, 360);
    const face = D.faces[faceIdx];
    const orig = new Float32Array(N);
    const oi = decodeU8(face.img);
    for (let p = 0; p < N; p++) orig[p] = oi[p] / 255;
    const rec = reconstruct(face.coords, k);

    drawPanel(panels.orig, orig, "gray");
    drawPanel(panels.rec, rec, "gray", P.blue);
    drawPanel(panels.mean, D.mean, "gray");

    // подпись реконструкции с текущим k
    ctx.fillStyle = P.blue; ctx.font = "13px Palatino, Georgia, serif"; ctx.textAlign = "center";
    ctx.fillText("k = " + k, panels.rec.x + panels.rec.w / 2, panels.rec.y + panels.rec.h + 18);

    // --- кривая накопленной дисперсии ---
    const cv2 = D.cumvar, M = D.K;
    xK = S.scale(1, M, curveBox.x, curveBox.x + curveBox.w);
    const yV = S.scale(0, 1, curveBox.y + curveBox.h, curveBox.y);
    // сетка
    ctx.strokeStyle = P.grid; ctx.lineWidth = 1;
    [0.25, 0.5, 0.75, 1].forEach((g) => {
      ctx.beginPath(); ctx.moveTo(curveBox.x, yV(g)); ctx.lineTo(curveBox.x + curveBox.w, yV(g)); ctx.stroke();
      ctx.fillStyle = P.mut; ctx.font = "10px Palatino, serif"; ctx.textAlign = "right";
      ctx.fillText((g * 100) + "%", curveBox.x - 4, yV(g) + 3);
    });
    // линия
    ctx.strokeStyle = P.green; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 1; i <= M; i++) { const X = xK(i), Y = yV(cv2[i - 1]); i === 1 ? ctx.moveTo(X, Y) : ctx.lineTo(X, Y); }
    ctx.stroke();
    // подписи оси X (число компонент)
    ctx.strokeStyle = P.grid; ctx.lineWidth = 1;
    ctx.fillStyle = P.mut; ctx.font = "10px Palatino, serif"; ctx.textAlign = "center";
    [1, Math.round(M / 4), Math.round(M / 2), Math.round(3 * M / 4), M].forEach((tk) => {
      const tx = xK(tk);
      ctx.beginPath(); ctx.moveTo(tx, curveBox.y + curveBox.h); ctx.lineTo(tx, curveBox.y + curveBox.h + 4); ctx.stroke();
      ctx.fillText(String(tk), tx, curveBox.y + curveBox.h + 14);
    });
    ctx.fillText("компонент", curveBox.x + curveBox.w / 2, curveBox.y + curveBox.h + 26);
    // маркер k
    const mk = xK(k), my = yV(cv2[k - 1]);
    ctx.strokeStyle = P.red; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(mk, curveBox.y + curveBox.h); ctx.lineTo(mk, my); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = P.red; ctx.beginPath(); ctx.arc(mk, my, 4, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = P.ink; ctx.font = "12px Palatino, serif"; ctx.textAlign = "center";
    ctx.fillText("доля объяснённой дисперсии", curveBox.x + curveBox.w / 2, curveBox.y - 8);

    // --- полоса собственных лиц ---
    ctx.fillStyle = P.mut; ctx.font = "11px Palatino, serif"; ctx.textAlign = "left";
    ctx.fillText("Собственные лица (подсвечены вошедшие в сумму):", strip.x, strip.y - 8);
    for (let i = 0; i < strip.n; i++) {
      const bx = { x: strip.x + i * (strip.cell + strip.gap), y: strip.y, w: strip.cell, h: strip.cell };
      const ef = eigenfaceNorm(i);
      const on = i < k;
      ctx.globalAlpha = on ? 1 : 0.32;
      S.drawImage(ctx, ef, D.w, D.h, bx, "coolwarm");
      ctx.globalAlpha = 1;
      ctx.strokeStyle = on ? P.blue : "#d8d2bf"; ctx.lineWidth = on ? 1.6 : 1;
      ctx.strokeRect(bx.x + 0.5, bx.y + 0.5, bx.w - 1, bx.h - 1);
    }

    // MSE
    let mse = 0; for (let p = 0; p < N; p++) { const e = orig[p] - rec[p]; mse += e * e; } mse /= N;
    out.set([
      { k: "k =", v: String(k), color: P.blue },
      { k: "объяснено", v: (D.cumvar[k - 1] * 100).toFixed(1) + "%", color: P.green },
      { k: "ошибка MSE", v: mse.toFixed(4), color: P.red },
      { k: "на лицо", v: k + " чисел вместо 4096", color: P.mut },
    ]);
  }

  const redraw = S.rafThrottle(draw);

  // клик/протяжка по кривой → задать k
  S.dragify(cv.canvas, { w: 760, h: 360 }, {
    onDown: setKFromX, onMove: setKFromX,
  });
  function setKFromX(p) {
    if (p.x < curveBox.x - 10 || p.x > curveBox.x + curveBox.w + 10 || p.y < curveBox.y - 20 || p.y > curveBox.y + curveBox.h + 20) return;
    if (!xK) return;
    let nk = Math.round(xK.inv(p.x));
    nk = Math.max(1, Math.min(D.K, nk));
    if (nk !== k) { k = nk; sld.set(k); redraw(); }
  }

  let sld;
  S.loadData("pca_eigenfaces.json").then((d) => {
    D = d; N = d.h * d.w; basis = decodeI8(d.basis_i8);
    // селектор лица
    S.segmented(controls, {
      label: "Лицо",
      value: 0,
      options: D.faces.map((_, i) => ({ value: i, label: "#" + (i + 1) })),
    }, (v) => { faceIdx = +v; redraw(); });
    sld = S.slider(controls, {
      label: "Число компонент k", min: 1, max: D.K, step: 1, value: k,
      fmt: (v) => v,
    }, (v) => { k = v | 0; redraw(); });
    draw();
  }).catch((e) => {
    root.appendChild(S.el("div", "sigma-int-err", { text: "Не загрузились данные eigenfaces: " + e.message }));
  });
});
