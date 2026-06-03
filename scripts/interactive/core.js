// ============================================================================
// Sigma Interactive — нативный фреймворк живых визуализаций (distill.pub-стиль).
//
// Принцип: НИКАКИХ кнопок «Запустить». Любой ползунок/перетаскивание/поворот
// пересчитывает и перерисовывает мгновенно, в браузере, без round-trip к Python.
//
// Подключение: nginx инъектит /assistant/interactive.css + /assistant/interactive.js
// (бандл core.js + widgets/*.js, собирается scripts/build_interactive.sh).
//
// Виджет на странице — это <div data-sigma-widget="ИМЯ" data-opts='{...}'></div>.
// Каждый виджет регистрируется через SigmaInt.register("ИМЯ", (root, opts, S) => {...}).
// ============================================================================
(function () {
  "use strict";
  if (window.SigmaInt && window.SigmaInt.__core) return; // idempotent

  // ---- Палитра Сигмы (совпадает с фигурами matplotlib и Tufte-CSS) ----
  const PALETTE = {
    blue:  "#1F4E79",
    red:   "#C0392B",
    green: "#2E7D5B",
    gold:  "#B8860B",
    purple:"#6A4C93",
    ink:   "#111111",
    mut:   "#777777",
    grid:  "#d8d4c4",
    axis:  "#9a9384",
    bg:    "#fffff8",
    panel: "#faf8ef",
  };
  // Дискретная серия для нескольких рядов
  const SERIES = [PALETTE.blue, PALETTE.red, PALETTE.green, PALETTE.gold, PALETTE.purple];

  const registry = new Map();
  const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

  // ---------------------------------------------------------------- helpers
  function el(tag, cls, attrs) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (attrs) for (const k in attrs) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else n.setAttribute(k, attrs[k]);
    }
    return n;
  }

  // Канвас с корректным DPR-масштабированием; возвращает {canvas, ctx, w, h, resize}
  function makeCanvas(parent, w, h, opts) {
    opts = opts || {};
    const canvas = el("canvas", "sigma-int-canvas");
    canvas.style.width = "100%";
    canvas.style.maxWidth = (opts.maxWidth || w) + "px";
    canvas.style.height = "auto";
    canvas.style.touchAction = opts.pan === false ? "none" : "manipulation";
    parent.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    const state = { canvas, ctx, w, h };
    function resize() {
      const cssW = canvas.clientWidth || w;
      const ratio = h / w;
      const cssH = cssW * ratio;
      canvas.style.height = cssH + "px";
      const r = dpr();
      canvas.width = Math.round(cssW * r);
      canvas.height = Math.round(cssH * r);
      ctx.setTransform(r * cssW / w, 0, 0, r * cssH / h, 0, 0); // logical coords = w×h
      state.cssW = cssW; state.cssH = cssH;
    }
    resize();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => { resize(); if (opts.onResize) opts.onResize(); });
      ro.observe(canvas);
    } else {
      window.addEventListener("resize", () => { resize(); if (opts.onResize) opts.onResize(); });
    }
    return state;
  }

  // SVG-холст (для графов/схем, где вектор удобнее)
  function makeSvg(parent, w, h) {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("class", "sigma-int-svg");
    svg.style.width = "100%";
    svg.style.height = "auto";
    parent.appendChild(svg);
    const mk = (tag, attrs) => {
      const n = document.createElementNS(NS, tag);
      if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
      return n;
    };
    return { svg, mk, NS, w, h };
  }

  // Ползунок с живой подписью значения. cfg: {label, min, max, step, value, fmt, unit}
  function slider(parent, cfg, onInput) {
    const wrap = el("div", "sigma-int-ctl");
    const fmt = cfg.fmt || ((v) => (Math.round(v * 1000) / 1000));
    const lab = el("label", "sigma-int-lbl");
    const name = el("span", "sigma-int-lbl-name", { text: cfg.label });
    const val = el("span", "sigma-int-lbl-val");
    lab.appendChild(name); lab.appendChild(val);
    const input = el("input", "sigma-int-range", {
      type: "range",
      min: cfg.min, max: cfg.max,
      step: cfg.step == null ? "any" : cfg.step,
      value: cfg.value,
    });
    const render = () => { val.textContent = fmt(+input.value) + (cfg.unit || ""); };
    input.addEventListener("input", () => { render(); onInput(+input.value); });
    wrap.appendChild(lab); wrap.appendChild(input);
    parent.appendChild(wrap);
    render();
    return { input, set: (v) => { input.value = v; render(); }, get: () => +input.value };
  }

  // Выпадающий выбор. cfg: {label, options:[{value,label}], value}
  function select(parent, cfg, onChange) {
    const wrap = el("div", "sigma-int-ctl");
    const lab = el("label", "sigma-int-lbl");
    lab.appendChild(el("span", "sigma-int-lbl-name", { text: cfg.label }));
    const sel = el("select", "sigma-int-select");
    cfg.options.forEach((o) => {
      const opt = el("option", null, { value: o.value, text: o.label });
      if (o.value === cfg.value) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener("change", () => onChange(sel.value));
    wrap.appendChild(lab); wrap.appendChild(sel);
    parent.appendChild(wrap);
    return sel;
  }

  // Кнопки-переключатели (segmented). cfg:{label, options:[{value,label}], value}
  function segmented(parent, cfg, onChange) {
    const wrap = el("div", "sigma-int-ctl");
    if (cfg.label) wrap.appendChild(el("span", "sigma-int-lbl-name", { text: cfg.label }));
    const group = el("div", "sigma-int-seg");
    let cur = cfg.value;
    const btns = [];
    cfg.options.forEach((o) => {
      const b = el("button", "sigma-int-seg-btn" + (o.value === cur ? " active" : ""), { text: o.label, type: "button" });
      b.addEventListener("click", () => {
        cur = o.value;
        btns.forEach((bb) => bb.classList.toggle("active", bb === b));
        onChange(o.value);
      });
      btns.push(b); group.appendChild(b);
    });
    wrap.appendChild(group); parent.appendChild(wrap);
    return { set: (v) => { cur = v; btns.forEach((bb, i) => bb.classList.toggle("active", cfg.options[i].value === v)); } };
  }

  function button(parent, label, onClick, variant) {
    const b = el("button", "sigma-int-btn" + (variant ? " " + variant : ""), { text: label, type: "button" });
    b.addEventListener("click", onClick);
    parent.appendChild(b);
    return b;
  }

  // Перетаскивание по канвасу/SVG. cb получает {x,y} в ЛОГИЧЕСКИХ координатах холста.
  // mapper: (clientX,clientY,rect) → {x,y}. По умолчанию — по viewBox/логике w×h.
  function dragify(target, logical, handlers) {
    let active = false;
    const toLogical = (ev) => {
      const rect = target.getBoundingClientRect();
      const t = (ev.touches && ev.touches[0]) || ev;
      const px = (t.clientX - rect.left) / rect.width;
      const py = (t.clientY - rect.top) / rect.height;
      return { x: px * logical.w, y: py * logical.h, px, py };
    };
    const down = (ev) => {
      active = true;
      if (handlers.onDown) handlers.onDown(toLogical(ev), ev);
      ev.preventDefault();
    };
    const move = (ev) => {
      if (handlers.onHover && !active) handlers.onHover(toLogical(ev), ev);
      if (!active) return;
      if (handlers.onMove) handlers.onMove(toLogical(ev), ev);
      ev.preventDefault();
    };
    const up = (ev) => {
      if (!active) return;
      active = false;
      if (handlers.onUp) handlers.onUp(ev);
    };
    target.addEventListener("mousedown", down);
    target.addEventListener("touchstart", down, { passive: false });
    window.addEventListener("mousemove", move);
    target.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("mouseup", up);
    window.addEventListener("touchend", up);
    if (handlers.onHover) target.addEventListener("mousemove", move);
    return { isActive: () => active };
  }

  // Поворот/орбита мышью по канвасу (для 3D). cb(dyaw, dpitch).
  function orbit(target, onRotate) {
    let last = null;
    dragify(target, { w: 1, h: 1 }, {
      onDown: (p) => { last = p; },
      onMove: (p) => {
        if (!last) return;
        onRotate((p.px - last.px), (p.py - last.py));
        last = p;
      },
      onUp: () => { last = null; },
    });
  }

  // Подпись/значение под холстом (живой read-out метрик)
  function readout(parent) {
    const r = el("div", "sigma-int-readout");
    parent.appendChild(r);
    return {
      set: (items) => {
        r.innerHTML = "";
        items.forEach((it) => {
          const span = el("span", "sigma-int-metric");
          span.appendChild(el("b", null, { text: it.k + " " }));
          const v = el("span", null, { text: it.v });
          if (it.color) v.style.color = it.color;
          span.appendChild(v);
          r.appendChild(span);
        });
      },
    };
  }

  function caption(parent, text) {
    parent.appendChild(el("div", "sigma-int-cap", { text }));
  }

  function row(parent, cls) {
    const r = el("div", "sigma-int-row" + (cls ? " " + cls : ""));
    parent.appendChild(r);
    return r;
  }

  // rAF-троттлинг: вызывает fn максимум раз за кадр
  function rafThrottle(fn) {
    let scheduled = false, lastArgs = null;
    return function () {
      lastArgs = arguments;
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; fn.apply(null, lastArgs); });
    };
  }

  // Непрерывный цикл анимации с возможностью паузы
  function loop(step) {
    let running = false, raf = null, t0 = null;
    function frame(ts) {
      if (!running) return;
      if (t0 == null) t0 = ts;
      step((ts - t0) / 1000, ts);
      raf = requestAnimationFrame(frame);
    }
    return {
      start() { if (!running) { running = true; t0 = null; raf = requestAnimationFrame(frame); } },
      stop() { running = false; if (raf) cancelAnimationFrame(raf); },
      get running() { return running; },
    };
  }

  async function loadData(name) {
    const r = await fetch("/assistant/data/" + name, { cache: "force-cache" });
    if (!r.ok) throw new Error("data " + name + " " + r.status);
    return r.json();
  }

  // --------- линейная алгебра (мелочи для виджетов, без зависимостей) --------
  const lin = {
    matVec(M, v) { return M.map((row) => row.reduce((s, a, j) => s + a * v[j], 0)); },
    dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; },
    add(a, b) { return a.map((x, i) => x + b[i]); },
    sub(a, b) { return a.map((x, i) => x - b[i]); },
    scale(a, s) { return a.map((x) => x * s); },
    norm(a) { return Math.sqrt(lin.dot(a, a)); },
  };

  // Линейная шкала значение→пиксель
  function scale(d0, d1, r0, r1) {
    const m = (r1 - r0) / (d1 - d0 || 1);
    const f = (x) => r0 + (x - d0) * m;
    f.inv = (y) => d0 + (y - r0) / m;
    f.dom = [d0, d1]; f.rng = [r0, r1];
    return f;
  }

  // Рисование осей на канвасе (логические координаты w×h)
  function axes(ctx, box, opts) {
    opts = opts || {};
    ctx.save();
    ctx.strokeStyle = PALETTE.axis; ctx.fillStyle = PALETTE.mut;
    ctx.lineWidth = 1;
    ctx.font = "11px Palatino, Georgia, serif";
    ctx.beginPath();
    ctx.moveTo(box.x, box.y); ctx.lineTo(box.x, box.y + box.h); ctx.lineTo(box.x + box.w, box.y + box.h);
    ctx.stroke();
    if (opts.xlabel) { ctx.textAlign = "center"; ctx.fillText(opts.xlabel, box.x + box.w / 2, box.y + box.h + 28); }
    if (opts.ylabel) { ctx.save(); ctx.translate(box.x - 32, box.y + box.h / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = "center"; ctx.fillText(opts.ylabel, 0, 0); ctx.restore(); }
    ctx.restore();
  }

  // Маленький heatmap/изображение из плоского массива [0..1] в bbox (для лиц/матриц)
  function drawImage(ctx, flat, iw, ih, box, cmap) {
    const off = document.createElement("canvas");
    off.width = iw; off.height = ih;
    const octx = off.getContext("2d");
    const img = octx.createImageData(iw, ih);
    for (let i = 0; i < iw * ih; i++) {
      let v = flat[i];
      let r, g, b;
      if (cmap === "coolwarm") {
        // -1..1 → синий..белый..красный
        const t = Math.max(-1, Math.min(1, v));
        if (t < 0) { r = 255 * (1 + t); g = 255 * (1 + t); b = 255; }
        else { r = 255; g = 255 * (1 - t); b = 255 * (1 - t); }
      } else {
        v = Math.max(0, Math.min(1, v));
        r = g = b = v * 255;
      }
      img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, box.x, box.y, box.w, box.h);
  }

  const S = {
    PALETTE, SERIES, el, makeCanvas, makeSvg, slider, select, segmented, button,
    dragify, orbit, readout, caption, row, rafThrottle, loop, loadData, lin,
    scale, axes, drawImage,
  };

  // ---------------------------------------------------------------- mounting
  function register(name, builder) { registry.set(name, builder); }

  function mountAll() {
    const nodes = document.querySelectorAll("[data-sigma-widget]");
    nodes.forEach((node) => {
      if (node.__sigmaMounted) return;
      node.__sigmaMounted = true;
      const name = node.getAttribute("data-sigma-widget");
      const builder = registry.get(name);
      const root = el("div", "sigma-int");
      node.innerHTML = "";
      node.appendChild(root);
      if (!builder) {
        root.appendChild(el("div", "sigma-int-err", { text: "Виджет «" + name + "» ещё не загружен." }));
        return;
      }
      let opts = {};
      const raw = node.getAttribute("data-opts");
      if (raw) { try { opts = JSON.parse(raw); } catch (e) { /* ignore */ } }
      try {
        builder(root, opts, S);
      } catch (e) {
        root.innerHTML = "";
        root.appendChild(el("div", "sigma-int-err", { text: "Ошибка виджета «" + name + "»: " + (e && e.message) }));
        if (window.console) console.error("[SigmaInt]", name, e);
      }
    });
  }

  window.SigmaInt = { __core: true, register, S, PALETTE, mountAll };

  // mountAll должен запускаться ПОСЛЕ того, как остальной бандл (widgets/*.js
  // ниже core.js) синхронно отработает и зарегистрирует билдеры. Скрипт
  // подключён с defer → DOM уже готов, поэтому откладываем на микротаск,
  // который выполнится сразу после завершения всего синхронного бандла.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountAll);
  } else {
    queueMicrotask(mountAll);
  }
})();
