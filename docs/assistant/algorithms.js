// Inline algorithm runner — injects a "▶ Запустить" button below every
// .callout-important whose title starts with "Алгоритм:" and an entry in
// algorithms.json. Click reveals a small param form + run button; running
// pipes the templated code into a private Pyodide worker and renders
// stdout/PNGs inline beneath the callout.
//
// Self-contained: shares no state with the chat widget. Lazy-loads Pyodide
// only when the user first clicks Run.

(function () {
  "use strict";

  const SLUG = location.pathname.replace(/^\/+/, "").replace(/\.html$/i, "");
  let CATALOG = null;
  let worker = null;
  let workerReady = false;
  const pending = new Map();
  let nextId = 1;

  async function loadCatalog() {
    if (CATALOG) return CATALOG;
    try {
      const r = await fetch("/assistant/algorithms.json", { cache: "no-cache" });
      CATALOG = r.ok ? await r.json() : {};
    } catch (_) {
      CATALOG = {};
    }
    return CATALOG;
  }

  let prewarmStarted = false;

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker("/assistant/pyodide-worker.js");
    worker.onmessage = (e) => {
      const { type, id } = e.data;
      const ctx = id != null ? pending.get(id) : null;
      if (type === "ack") {
        // прогрев завершён фоном — ничего не показываем
        return;
      }
      if (type === "progress") {
        // forward to ALL runs that are still waiting on Pyodide cold-start
        for (const c of pending.values()) {
          if (c.onProgress) c.onProgress(e.data.message || "");
        }
      } else if (type === "stdout" || type === "stderr") {
        // Suppress Pyodide's "Loading numpy, …" noise that comes during the
        // very first cold-start. User code never streams until workerReady=true.
        if (!workerReady) return;
        for (const c of pending.values()) {
          if (c.onStream) c.onStream(e.data.text || "", type);
        }
      } else if (type === "ready") {
        workerReady = true;
      } else if (type === "result") {
        if (ctx) {
          pending.delete(id);
          ctx.resolve(e.data);
        }
      } else if (type === "error") {
        if (ctx) {
          pending.delete(id);
          ctx.reject(new Error(e.data.error || "worker error"));
        }
      }
    };
    return worker;
  }

  // Прогреваем Pyodide в фоне, как только первый виджет показался на экране:
  // к моменту клика «Запустить» рантайм уже загружен, и пользователь не ждёт
  // 15 секунд холодного старта, глядя на спиннер.
  function prewarm() {
    if (prewarmStarted || workerReady) return;
    prewarmStarted = true;
    ensureWorker().postMessage({ type: "init" });
  }

  function runInWorker(code, hooks) {
    const w = ensureWorker();
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, ...hooks });
      w.postMessage({ type: "run", id, code });
    });
  }

  function substituteParams(code, params, values) {
    let out = code;
    for (const p of params) {
      const v = values[p.name];
      // Inject numeric params as raw number literals; string params as quoted
      // literals. Sliders/floats and numeric selects (e.g. cooling rate 0.998)
      // must NOT be stringified, or Python sees "42" and crashes; string
      // selects (word lists, signal type) must stay quoted.
      const numericSelect =
        p.type === "select" && v != null && String(v).trim() !== "" && !isNaN(Number(v));
      let lit;
      if (p.type === "int") lit = String(parseInt(v, 10));
      else if (p.type === "float" || p.type === "number" || p.type === "slider" || numericSelect)
        lit = String(Number(v));
      else lit = JSON.stringify(v);
      out = out.replaceAll(`__${p.name}__`, lit);
    }
    return out;
  }

  function el(tag, attrs, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "class") e.className = v;
      else if (k === "style") e.style.cssText = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const c of children) {
      if (c == null) continue;
      e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return e;
  }

  function renderRunner(callout, entry) {
    const wrap = el("div", { class: "sigma-algo-runner" });

    // Params form
    const form = el("form", { class: "sigma-algo-form" });
    const inputs = {};
    for (const p of entry.params || []) {
      const label = el("label", { class: "sigma-algo-label" });
      label.appendChild(document.createTextNode(p.label + " "));
      let input;
      if (p.type === "select" && Array.isArray(p.options)) {
        // Настоящий выпадающий список вместо текстового поля: видны все
        // варианты, в числовые select нельзя вписать мусор.
        input = el("select", { class: "sigma-algo-input" });
        for (const opt of p.options) {
          const o = el("option", { value: String(opt) }, String(opt));
          if (String(opt) === String(p.default)) o.selected = true;
          input.appendChild(o);
        }
      } else {
        input = el("input", {
          type: p.type === "int" ? "number" : "text",
          value: p.default,
          class: "sigma-algo-input",
        });
      }
      label.appendChild(input);
      form.appendChild(label);
      inputs[p.name] = input;
    }

    const runBtn = el("button", { type: "submit", class: "sigma-algo-run" }, "▶ Запустить");
    const resetBtn = el(
      "button",
      {
        type: "button",
        class: "sigma-algo-reset",
        onclick: () => {
          for (const p of entry.params || []) inputs[p.name].value = p.default;
        },
      },
      "Сброс",
    );
    form.appendChild(runBtn);
    form.appendChild(resetBtn);

    const out = el("div", { class: "sigma-algo-out", style: "display:none" });
    const outStatus = el("div", { class: "sigma-algo-status" });
    const spinner = el("span", { class: "sigma-algo-spinner", style: "display:none" });
    const statusText = el("span", { class: "sigma-algo-status-text" });
    outStatus.appendChild(spinner);
    outStatus.appendChild(statusText);
    const skeleton = el("div", { class: "sigma-algo-skeleton", style: "display:none" });
    const outBody = el("pre", { class: "sigma-algo-stdout" });
    const outImages = el("div", { class: "sigma-algo-images" });
    out.appendChild(outStatus);
    out.appendChild(skeleton);
    out.appendChild(outBody);
    out.appendChild(outImages);

    // Показать статус как «крутится»: спиннер + текст.
    const busy = (text) => {
      spinner.style.display = "";
      statusText.textContent = text;
    };
    const done = (text) => {
      spinner.style.display = "none";
      statusText.textContent = text;
    };

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      runBtn.disabled = true;
      out.style.display = "";
      const cold = !workerReady;
      if (cold) {
        busy("Загружаю Python в браузере… ~15 c (только первый раз)");
        skeleton.style.display = "";
      } else {
        busy("Считаю…");
        skeleton.style.display = "none";
      }
      outBody.textContent = "";
      delete outBody.dataset.hasErr;
      outImages.innerHTML = "";
      const values = {};
      for (const p of entry.params || []) values[p.name] = inputs[p.name].value;
      const code = substituteParams(entry.code, entry.params || [], values);
      try {
        const r = await runInWorker(code, {
          onProgress: (m) => {
            // Во время холодного старта показываем шаги загрузки Pyodide,
            // но не теряем подсказку про «только первый раз».
            if (!workerReady) busy(m + " (только первый раз)");
            else busy(m);
          },
          onStream: (text, kind) => {
            // Первый стрим пользовательского кода — Python уже прогрет,
            // прячем скелетон и переключаемся на «считаю».
            skeleton.style.display = "none";
            busy("Считаю…");
            outBody.textContent += text;
            if (kind === "stderr") outBody.dataset.hasErr = "1";
          },
        });
        skeleton.style.display = "none";
        if (r.error) {
          done("Ошибка");
          outBody.textContent += "\n" + r.error;
          outBody.dataset.hasErr = "1";
        } else if (cold) {
          // После первого инициализации Pyodide прогрет на всю вкладку —
          // последующие запуски почти мгновенные. Подсветим это.
          done("Готово · Python прогрет, дальше запуски мгновенные");
        } else {
          done("Готово");
        }
        for (const b64 of r.images || []) {
          const img = el("img", { src: `data:image/png;base64,${b64}`, alt: "" });
          outImages.appendChild(img);
        }
        // Animated/rich media (GIF animates natively in <img>; video in <video>)
        for (const m of r.media || []) {
          if (!m || !m.b64) continue;
          const src = `data:${m.mime};base64,${m.b64}`;
          if (m.mime && m.mime.startsWith("video/")) {
            const v = el("video", { src, loop: "", playsinline: "", controls: "" });
            v.muted = true;
            v.autoplay = true;
            outImages.appendChild(v);
          } else {
            outImages.appendChild(el("img", { src, alt: "анимация" }));
          }
        }
      } catch (err) {
        skeleton.style.display = "none";
        done("Ошибка");
        outBody.textContent += "\n" + String(err.message || err);
        outBody.dataset.hasErr = "1";
      } finally {
        runBtn.disabled = false;
      }
    });

    wrap.appendChild(form);
    wrap.appendChild(out);
    return wrap;
  }

  async function init() {
    const cat = await loadCatalog();
    const chapterMap = cat[SLUG];
    if (!chapterMap) return;

    const callouts = document.querySelectorAll(".callout.callout-important[title]");
    const runners = [];
    for (const c of callouts) {
      const title = c.getAttribute("title") || "";
      const entry = chapterMap[title];
      if (!entry) continue;
      if (c.nextElementSibling && c.nextElementSibling.classList.contains("sigma-algo-runner")) {
        continue; // idempotent
      }
      const r = renderRunner(c, entry);
      c.insertAdjacentElement("afterend", r);
      runners.push(r);
    }

    // Когда любой виджет приближается к вьюпорту — начинаем грузить Pyodide
    // заранее. Один прогрев на всю вкладку, дальше worker уже горячий.
    if (runners.length && "IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        (entries) => {
          for (const en of entries) {
            if (en.isIntersecting) {
              prewarm();
              io.disconnect();
              break;
            }
          }
        },
        { rootMargin: "300px 0px" },
      );
      for (const r of runners) io.observe(r);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
