// Sigma textbook chat assistant — browser-side pico agent.
//
// The whole agent loop lives in this file: streamed completions via
// /api/llm (server-side proxy to OpenRouter), native tool_calls,
// RAG tools that hit /api/textbook/*, and a `python` tool that runs
// in pyodide-worker.js (lazy-loaded on first call).
//
// No build step: pure vanilla ES module-ish JS. Loaded by every
// Quarto-generated HTML page via the nginx sub_filter rule.

(() => {
  if (window.__sigmaAssistantLoaded) return;
  window.__sigmaAssistantLoaded = true;

  // -------------------------------------------------------------------------
  // Config & module state
  // -------------------------------------------------------------------------

  const API = {
    llm: "/api/llm",
    model: "/api/model",
    search: "/api/textbook/search",
    read: "/api/textbook/read",
    outline: "/api/textbook/outline",
    findDef: "/api/textbook/find_definition",
    findThm: "/api/textbook/find_theorem",
  };

  const MAX_STEPS = 8;             // hard cap on agent loop iterations
  const LLM_IDLE_MS = 120000;      // abort a completion that streams NO bytes for
  // this long — an upstream hang (e.g. an image follow-up step routed to a model
  // that stalls) emits nothing, while a real long generation keeps streaming and
  // resets the timer. Guarantees the loop never blocks forever on a dead call.
  const TOOL_CHAR_LIMIT = 6000;    // truncate tool results before feeding back

  const state = {
    history: [],                   // chat history (visible messages)
    selectedFragment: "",
    chapterSlug: detectChapterSlug(),
    chapterTitle: document.title || "",
    model: "",
    pyodide: null,                 // Pyodide worker bridge
    busy: false,
  };

  // -------------------------------------------------------------------------
  // DOM scaffold
  // -------------------------------------------------------------------------

  function detectChapterSlug() {
    const m = location.pathname.match(/\/([\w-]+)\.html?$/);
    return m ? m[1] : "";
  }

  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k === "html") n.innerHTML = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const kid of kids) {
      if (kid == null) continue;
      n.append(kid.nodeType ? kid : document.createTextNode(kid));
    }
    return n;
  }

  const launcher = el("button", { class: "sigma-launcher", "aria-label": "Открыть ассистента" },
    el("span", { class: "sigma-launcher-icon" }, "✦"),
    el("span", { class: "sigma-launcher-label" }, "Спросить ИИ")
  );

  const fragmentPill = el("button", { class: "sigma-fragment-pill", hidden: "" }, "✦ Спросить про это");

  const sheet = el("aside", { class: "sigma-sheet", hidden: "" });
  const sheetHeader = el("header", { class: "sigma-sheet-header" },
    el("div", { class: "sigma-sheet-title" }, "Ассистент учебника Σ"),
    el("div", { class: "sigma-sheet-model" }, "…"),
    el("button", { class: "sigma-sheet-close", "aria-label": "Закрыть" }, "×")
  );
  const sheetBody = el("div", { class: "sigma-sheet-body" });
  const fragmentChip = el("div", { class: "sigma-fragment-chip", hidden: "" });
  const suggestions = el("div", { class: "sigma-suggestions" });
  const input = el("textarea", {
    class: "sigma-input",
    placeholder: "Спроси про этот учебник или попроси что-то посчитать…",
    rows: "1",
  });
  const sendBtn = el("button", { class: "sigma-send", "aria-label": "Отправить" }, "→");
  const resetBtn = el("button", { class: "sigma-reset", "aria-label": "Очистить" }, "↺");
  const footer = el("footer", { class: "sigma-sheet-footer" },
    fragmentChip,
    suggestions,
    el("div", { class: "sigma-inputrow" }, input, sendBtn, resetBtn),
    el("div", { class: "sigma-disclaimer" }, "ИИ может ошибаться. Проверяйте критичные ответы.")
  );
  sheet.append(sheetHeader, sheetBody, footer);

  document.addEventListener("DOMContentLoaded", () => {
    document.body.append(launcher, fragmentPill, sheet);
    refreshModelLabel();
  });

  // Reveal quiz-answer spoilers (||...||) on click / Enter / Space.
  sheet.addEventListener("click", (e) => {
    const sp = e.target.closest?.(".sigma-spoiler");
    if (sp) sp.classList.add("revealed");
  });
  sheet.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.classList?.contains("sigma-spoiler")) {
      e.preventDefault();
      e.target.classList.add("revealed");
    }
  });

  // -------------------------------------------------------------------------
  // Text selection → fragment pill
  // -------------------------------------------------------------------------

  function captureSelection() {
    const sel = window.getSelection();
    const text = (sel?.toString() || "").trim();
    if (!text || text.length < 4) {
      fragmentPill.hidden = true;
      return;
    }
    state.selectedFragment = text;
    if (sheet.hidden) {
      const r = sel.getRangeAt(0).getBoundingClientRect();
      fragmentPill.style.left = Math.max(8, Math.min(window.innerWidth - 180, r.left)) + "px";
      fragmentPill.style.top = Math.max(8, r.bottom + 8) + "px";
      fragmentPill.hidden = false;
    } else {
      updateFragmentChip();
    }
  }
  document.addEventListener("mouseup", captureSelection);
  document.addEventListener("touchend", captureSelection);
  document.addEventListener("selectionchange", () => {
    if (!window.getSelection()?.toString().trim()) fragmentPill.hidden = true;
  });

  fragmentPill.addEventListener("click", () => {
    fragmentPill.hidden = true;
    openSheet();
  });

  function updateFragmentChip() {
    if (!state.selectedFragment) {
      fragmentChip.hidden = true;
      return;
    }
    const preview = state.selectedFragment.length > 120
      ? state.selectedFragment.slice(0, 120) + "…"
      : state.selectedFragment;
    fragmentChip.replaceChildren(
      el("span", { class: "sigma-fragment-text" }, "« " + preview + " »"),
      el("button", { class: "sigma-fragment-clear", "aria-label": "Убрать фрагмент" }, "×")
    );
    fragmentChip.querySelector(".sigma-fragment-clear").onclick = () => {
      state.selectedFragment = "";
      updateFragmentChip();
      renderSuggestions();
    };
    fragmentChip.hidden = false;
    renderSuggestions();
  }

  const FRAGMENT_OPTS = ["Объясни проще", "Пример из жизни", "Задача с решением"];
  // Native learning actions. Label ≠ sent prompt: a chip can fire a richer,
  // grounded instruction than its short label. `accent` = bright treatment.
  const FRESH_OPTS = [
    { label: "📖 За 30 секунд", send: "Объясни эту главу за 30 секунд — только самую суть." },
    { label: "🎯 Проверь меня", accent: true, send:
      "Составь 4 коротких проверочных вопроса строго по ЭТОЙ главе (опирайся на её текст, при необходимости read_chapter). " +
      "Формат: пронумерованный вопрос, сразу под ним правильный ответ, обёрнутый в ||...|| (двойные вертикальные черты), чтобы он был скрыт до клика. " +
      "Вопросы на понимание и связи идей, не на зубрёжку. Без вступления и заключения." },
    { label: "🧠 Глубокий вопрос", accent: true, send:
      "Задай мне ОДИН простой по формулировке, но глубокий и нетривиальный вопрос по теме этой главы — такой, что заставляет реально подумать и связать идеи. " +
      "Только сам вопрос, одной-двумя строками. НЕ отвечай на него." },
    { label: "✏️ Задача", send: "Дай одну содержательную задачу из этой главы с подробным решением." },
  ];

  function renderSuggestions() {
    suggestions.replaceChildren();
    const opts = state.selectedFragment ? FRAGMENT_OPTS : FRESH_OPTS;
    for (const o of opts) {
      const label = typeof o === "string" ? o : o.label;
      const send = typeof o === "string" ? o : o.send;
      suggestions.append(el("button", {
        class: "sigma-suggest" + (o && o.accent ? " sigma-suggest-accent" : ""),
        onclick: () => { input.value = send; sendBtn.click(); },
      }, label));
    }
  }

  // -------------------------------------------------------------------------
  // Sheet open/close
  // -------------------------------------------------------------------------

  function renderEmptyState() {
    if (sheetBody.children.length > 0) return;
    const chapter = state.chapterTitle ? state.chapterTitle.replace(/\s*[–—-]\s*Σ.*$/i, "") : "";
    const hint = chapter
      ? `Я знаю всю книгу — спрашивай по главе «${chapter}» или про любую другую тему. Можешь выделить текст в книге и спросить про него.`
      : `Я знаю всю книгу — спрашивай что угодно из курса. Можешь выделить текст в книге и спросить про него.`;
    sheetBody.append(el("div", { class: "sigma-empty" }, hint));
  }
  function clearEmptyState() {
    const empty = sheetBody.querySelector(".sigma-empty");
    if (empty) empty.remove();
  }
  function openSheet() {
    sheet.hidden = false;
    launcher.hidden = true;
    fragmentPill.hidden = true;
    document.body.classList.add("sigma-sheet-open");
    updateFragmentChip();
    renderSuggestions();
    renderEmptyState();
    setTimeout(() => input.focus(), 50);
  }
  function closeSheet() {
    sheet.hidden = true;
    launcher.hidden = false;
    document.body.classList.remove("sigma-sheet-open");
  }
  launcher.addEventListener("click", openSheet);
  sheetHeader.querySelector(".sigma-sheet-close").addEventListener("click", closeSheet);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !sheet.hidden) closeSheet();
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      sheet.hidden ? openSheet() : closeSheet();
    }
  });

  // -------------------------------------------------------------------------
  // API helpers
  // -------------------------------------------------------------------------

  async function jget(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }
  async function jpost(url, body) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  async function refreshModelLabel() {
    try {
      const { model } = await jget(API.model);
      state.model = model;
      sheetHeader.querySelector(".sigma-sheet-model").textContent = shortModel(model);
    } catch (_) { /* offline ok */ }
  }
  function shortModel(m) {
    if (!m) return "";
    return m.replace(/^.+\//, "").replace(/:free$/, "");
  }

  // -------------------------------------------------------------------------
  // Pyodide worker bridge (lazy)
  // -------------------------------------------------------------------------

  function ensurePyodide(onProgress) {
    if (state.pyodide) return state.pyodide;
    const w = new Worker("/assistant/pyodide-worker.js");
    const calls = new Map();
    let initResolve, initReject;
    const ready = new Promise((res, rej) => { initResolve = res; initReject = rej; });
    w.onmessage = (e) => {
      const { type, id } = e.data;
      if (type === "progress" && onProgress) onProgress(e.data.message);
      else if (type === "ready") initResolve();
      else if (type === "error" && id == null) initReject(new Error(e.data.error));
      else if (type === "result" && id != null) {
        const c = calls.get(id); if (c) { calls.delete(id); c.resolve(e.data); }
      }
    };
    const api = {
      ready,
      async run(code) {
        await ready;
        const id = crypto.randomUUID();
        return new Promise((resolve, reject) => {
          calls.set(id, { resolve, reject });
          w.postMessage({ type: "run", id, code });
        });
      },
    };
    w.postMessage({ type: "init" });
    state.pyodide = api;
    return api;
  }

  // -------------------------------------------------------------------------
  // Tool registry
  // -------------------------------------------------------------------------

  const TOOLS = [
    {
      type: "function",
      function: {
        name: "search_textbook",
        description: "Ключевой поиск по всем главам учебника. Возвращает до 5 коротких сниппетов с указанием главы и slug. " +
          "Use when: нужен факт/имя/событие, и неизвестно в какой главе. " +
          "Don't use when: знаешь slug главы (используй read_chapter) или нужно конкретное определение (используй find_definition). " +
          "Если в сниппете релевантной главы нет искомого года/числа/имени — дочитай главу через read_chapter по её slug.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "самое редкое различающее слово запроса, не вся фраза: \"Канторович\" вместо \"Канторович Нобелевская премия\". 2-4 ключевых слова, начни с редкого" },
            exclude_slug: { type: "string", description: "slug главы, которую студент сейчас читает — обычно её можно исключить" },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_chapter",
        description: "Прочитать главу или конкретную секцию. Use when: нужен полный контекст для глубокого ответа, или цитата. " +
          "Don't use when: нужен только факт (используй search_textbook).",
        parameters: {
          type: "object",
          properties: {
            slug: { type: "string", description: "slug главы из outline или из результата search_textbook" },
            section: { type: "string", description: "опционально — название секции (h2/h3) для частичного чтения" },
          },
          required: ["slug"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_outline",
        description: "Список всех глав учебника с заголовками h2/h3. Use when: не знаешь структуру учебника или какие главы есть.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "find_definition",
        description: "Найти строгое определение термина в учебнике. Возвращает callout-блоки 'Определение N.M'. " +
          "Use when: студент спрашивает 'что такое X' или нужна точная формулировка. " +
          "ВСЕГДА предпочитай этот тул общему поиску для вопросов «что такое X». " +
          "В term клади ТОЛЬКО ядро термина — 1-2 слова в основе без окончаний " +
          "(для «сильно выпуклая функция» → term=\"выпукл\"; для «сверхлинейная сходимость» → \"сверхлин\"). Не клади вопрос или фразу целиком.",
        parameters: {
          type: "object",
          properties: { term: { type: "string", description: "ядро термина в основе, 1-2 слова без окончаний, например \"выпукл\", \"перцептрон\"" } },
          required: ["term"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "find_theorem",
        description: "Найти формулировку теоремы/леммы/следствия по названию или ключевому слову. " +
          "Use when: студент просит формулировку, доказательство, или ссылку на конкретный результат. " +
          "Предпочитай этот тул поиску для «сформулируй теорему/лемму». В query клади ключевое имя или слово " +
          "в основе (\"Герон\", \"квадратичн\", \"SVD\"), не весь вопрос («теорема о сходимости метода Герона» → query=\"Герон\").",
        parameters: {
          type: "object",
          properties: { query: { type: "string", description: "имя/слово в основе без окончаний, например \"Герон\", \"квадратичн\", \"SVD\"" } },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "python",
        description: "Выполнить Python-код в браузерной песочнице (Pyodide). Доступны numpy, matplotlib, sympy, hashlib, math. " +
          "matplotlib рисует через Agg — любая открытая figure автоматически возвращается как PNG студенту. " +
          "Use when: нужен численный/символьный расчёт, визуализация сходимости, демонстрация алгоритма, проверка формулы. " +
          "Глобалы сохраняются между вызовами в рамках одной сессии. " +
          "Печатай результаты через print() — stdout попадёт в ответ.",
        parameters: {
          type: "object",
          properties: { code: { type: "string", description: "Python-код. Без shebang. Многострочно — нормально." } },
          required: ["code"],
        },
      },
    },
  ];

  async function runTool(name, args, traceNode) {
    if (name === "search_textbook") return jpost(API.search, args);
    if (name === "read_chapter")    return jpost(API.read, args);
    if (name === "get_outline")     return jget(API.outline);
    if (name === "find_definition") return jpost(API.findDef, args);
    if (name === "find_theorem")    return jpost(API.findThm, args);
    if (name === "python") {
      const py = ensurePyodide((msg) => {
        if (traceNode) traceNode.querySelector(".sigma-trace-status").textContent = msg;
      });
      return py.run(args.code || "");
    }
    throw new Error("unknown tool: " + name);
  }

  // -------------------------------------------------------------------------
  // SSE parser (OpenAI/OpenRouter format)
  // -------------------------------------------------------------------------

  async function* sseFromResponse(response) {
    const reader = response.body.getReader();
    const dec = new TextDecoder("utf-8");
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, nl);
        buf = buf.slice(nl + 2);
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") return;
          try { yield JSON.parse(payload); } catch (_) { /* heartbeat */ }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Agent loop — pico, native tool_calls
  // -------------------------------------------------------------------------

  const SYSTEM_PROMPT =
    "Ты — встроенный ассистент учебника Σ (sigma.fmin.xyz): школьно-вузовский учебник по информатике, " +
    "оптимизации, теории чисел, ML и ИИ. Отвечай по-русски, на уровне старшего школьника. " +
    "Markdown. Формулы только $...$ (inline) и $$...$$ (display) — не \\(...\\), не \\[...\\]. " +
    "Стиль разговорный, краткий. Заголовки `##` — только в развёрнутых объяснениях (>5 абзацев); иначе абзацы, списки, **жирным**.\n\n" +
    "ПОИСК И ФАКТЫ:\n" +
    "• Вопрос про содержание учебника (факт, год, имя, определение, теорема, история) — сделай хотя бы один поиск/lookup ПРЕЖДЕ чем отвечать. Факты, годы, имена, формулировки бери ТОЛЬКО из вывода тулов, не из памяти.\n" +
    "• Формулируй запрос как КОРОТКОЕ ЯДРО, а не фразу целиком. Ищи по самому редкому различающему слову (имя, термин, аббревиатура), без общих слов: для «Канторович Нобелевская премия» → `Канторович`; для «кто придумал RSA» → `RSA`; для «что такое сильно выпуклая функция» → find_definition с term=`выпукл`; для «теорема о сходимости метода Герона» → find_theorem с query=`Герон`. find_definition.term и find_theorem.query = 1-2 слова основой без окончаний. search_textbook.query = 2-4 ключевых слова, начни с самого редкого. Тулы матчат буквально по словам — длинные фразы с окончаниями часто не находятся.\n" +
    "• Выбор тула: «что такое X» → find_definition; «сформулируй теорему/лемму» → find_theorem; факт/год/имя/событие → search_textbook; полный контекст или цитата → read_chapter. Для определений и теорем ВСЕГДА предпочитай find_definition/find_theorem общему поиску.\n" +
    "• Пустой или мимо-результат — это НЕ значит, что в учебнике этого нет. Переформулируй и поищи ещё раз: другое ядро, синоним, фамилия, год, или смени тул. Если в сниппете релевантной главы нужного факта (года/числа/имени) нет — НЕ отвечай по догадке: вызови read_chapter по slug лучшего результата и дочитай. Не повторяй один и тот же запрос дважды.\n" +
    "• Если после 2-3 РАЗНЫХ запросов факта в учебнике нет — честно скажи «в учебнике я этого не нашёл», можешь дать общее знание с явной пометкой «вне учебника». НИКОГДА не выдумывай год, имя или ссылку.\n" +
    "• Определение или теорему ЦИТИРУЙ из callout-блока: приведи ключевую формулировку дословно (например условие g''(x) ≥ μ, слова «квадратичная сходимость», «положительная константа μ>0») И расшифруй нотацию словами (g''(x) ≥ μ = «вторая производная не меньше положительной константы μ»). Не теряй ключевые слова в пересказе.\n" +
    "• Ссылки бери ТОЛЬКО из поля `url` результата тула — якорь раздела уже внутри, не собирай URL вручную, без bare-slug. Текст ссылки — поле `section`, иначе название главы.\n" +
    "• Студент уже на запрашиваемой главе (его slug = найденному) — не ищи лишний раз: «ты уже на этой главе» + 2-3 буллета разделов.\n\n" +
    "PYTHON И ГРАФИКИ:\n" +
    "• Расчёт, проверка формулы, визуализация (график сходимости, разделяющая прямая, RSA на малых числах) — ОБЯЗАТЕЛЬНО вызови python для ЭТОГО вопроса, даже если похожий график был раньше. НЕ описывай график словами без запуска кода.\n" +
    "• В КАЖДОМ python-вызове сначала посчитай и print() ВСЕ ключевые числа итогового ответа с округлением до 2 знаков: print(f\"корень = {x:.2f}\"), print(\"a =\", round(a,2), \"b =\", round(b,2)). Это обязательно ДАЖЕ когда строишь график. Для графика создай matplotlib-figure (plt.figure/plot) — открытая figure автоматически уйдёт студенту как PNG.\n" +
    "• Числа из stdout переноси в финальный ответ ДОСЛОВНО (1.41, 1.94, 0.15…), в том же формате — не пересчитывай в уме. Для задач сходимости назови предельное значение числом, а не только символом: пиши и √2, и 1.41. Нет нужного числа в stdout — запусти python снова с print, не выдумывай.\n" +
    "• Графики смотри как vision-модель: анализируй ИЗОБРАЖЕНИЕ (форма кривой, скорость, асимптоты, пересечения, сходимость/расходимость), а не код. Добавь интерпретацию, не пересказывай очевидное.\n" +
    "• НЕ вставляй markdown-картинку на СВОЙ python-график: открытая matplotlib-figure показывается студенту автоматически. НИКОГДА не пиши выдуманные ссылки вида ![...](png://...), ![...](media://...), ![...](sandbox:/mnt/...), ![...](attachment:...) или ![...](имя.png) — таких URL не существует, они рендерятся битой ссылкой. Просто сошлись на свой график словами («на графике видно…»). Картинку ИЗ УЧЕБНИКА вставляй ТОЛЬКО реальным путём, который вернул read_chapter, в формате ![подпись](/figures/имя.svg).\n" +
    "• Если на графике/в числах видна РАСХОДИМОСТЬ (значения растут, уходят в бесконечность, NaN, осцилляция с ростом амплитуды) при том что задача предполагает СХОДИМОСТЬ — это НЕ финал, а результат эксперимента. Зафиксируй диагноз словами (например |2η−1|>1), затем ОБЯЗАТЕЛЬНО запусти python ВТОРОЙ раз с исправленным параметром (меньший шаг, например η=0.5) и покажи сошедшуюся траекторию. Двойной python тут — норма, а не зацикливание. Пустая/битая картинка — тоже перезапуск с фиксом.\n" +
    "• Если python вернул ОШИБКУ (traceback, ValueError, shape/broadcast mismatch, NameError и т.п.) — это НЕ повод сдаваться и НЕ повод спрашивать «хочешь, исправлю?». Молча почини код (частая причина — несовпадение форм массивов: выровняй через a[:,None]/reshape или суммируй по нужной оси axis=...) и запусти python СНОВА. Завершать ответ незавершённым расчётом, текстовым описанием вместо графика или встречным вопросом — запрещено: у тебя есть шаги, доведи задачу до числа и картинки сам.\n\n" +
    "ОБЩЕЕ:\n" +
    "• Не торопись с финалом. У тебя до 8 шагов с инструментами — используй их: несколько разных поисков, чтение глав, повторный python. Заканчивай только когда (а) факт реально найден в учебнике и процитирован, ИЛИ (б) расчёт выполнен и числа получены (и картинка, если просили), ИЛИ (в) ты честно проверил 2-3 разными запросами, что в учебнике этого нет. Недобор шагов и галлюцинация хуже, чем лишний шаг.\n" +
    "• Не из учебника (бытовой вопрос, вне программы) — вежливо откажи, не выдумывай. Голое приветствие — короткий отклик без тулов.";

  function buildInitialUserMessage(question) {
    const parts = [`Вопрос: ${question}`];
    if (state.chapterSlug) {
      parts.unshift(`Студент сейчас читает главу slug="${state.chapterSlug}" ("${state.chapterTitle}").`);
    }
    if (state.selectedFragment) {
      parts.push(`Выделенный фрагмент: «${state.selectedFragment}»`);
    }
    return parts.join("\n\n");
  }

  function truncate(s, n) {
    s = String(s ?? "");
    return s.length > n ? s.slice(0, n) + "\n…[обрезано]" : s;
  }

  // Drop image_url parts from messages, keeping only the text. Used for the
  // forced final answer so it routes to the TEXT model and can't re-hang on the
  // same vision call that stalled the loop.
  function stripImages(messages) {
    return messages.map(m => {
      if (Array.isArray(m.content)) {
        const txt = m.content.filter(p => p?.type === "text").map(p => p.text).join("\n");
        return { ...m, content: txt };
      }
      return m;
    });
  }

  async function streamCompletion(messages, { noTools = false } = {}) {
    const ctrl = new AbortController();
    let idle = setTimeout(() => ctrl.abort(), LLM_IDLE_MS);
    const body = { messages, stream: true, temperature: 0.2 };
    if (!noTools) { body.tools = TOOLS; body.tool_choice = "auto"; }
    let r;
    try {
      r = await fetch(API.llm, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(idle);
      throw new Error("LLM fetch failed/stalled: " + (e?.name === "AbortError" ? "idle-timeout" : (e?.message || e)));
    }
    if (!r.ok) { clearTimeout(idle); throw new Error("LLM HTTP " + r.status); }
    let content = "";
    const toolCalls = []; // [{id, function:{name,arguments}}]
    try {
      for await (const chunk of sseFromResponse(r)) {
        clearTimeout(idle);
        idle = setTimeout(() => ctrl.abort(), LLM_IDLE_MS);  // reset on every byte
        const d = chunk?.choices?.[0]?.delta;
        if (!d) continue;
        if (d.content) content += d.content;
        if (d.tool_calls) {
          for (const tc of d.tool_calls) {
            const i = tc.index ?? toolCalls.length;
            if (!toolCalls[i]) toolCalls[i] = { id: tc.id || "", type: "function", function: { name: "", arguments: "" } };
            if (tc.id) toolCalls[i].id = tc.id;
            if (tc.function?.name) toolCalls[i].function.name += tc.function.name;
            if (tc.function?.arguments) toolCalls[i].function.arguments += tc.function.arguments;
          }
        }
      }
    } finally {
      clearTimeout(idle);
    }
    return { content, tool_calls: toolCalls.filter(Boolean) };
  }

  // Guarantee a non-empty answer in every terminal path (step error/stall, or
  // MAX_STEPS exhausted with tools still pending). Force ONE text-only completion
  // over the stripped (image-free) context so we always capture SOMETHING the
  // user/eval can read — never a blank bubble.
  async function finishFromContext(userQuestion, bubble, traceEl, statusEl, answerEl, reason) {
    statusEl.textContent = "Формулирую ответ…";
    let content = "";
    try {
      const forced = await streamCompletion([
        ...stripImages(state._loopMessages || []),
        { role: "user", content: "Достаточно сбора. Дай финальный ответ по уже собранным данным ПРЯМО СЕЙЧАС, без новых инструментов." },
      ], { noTools: true });
      content = (forced.content || "").trim();
    } catch (_) { /* fall through to fallback text */ }
    if (statusEl.isConnected) statusEl.remove();
    answerEl.dataset.raw = content || "";
    answerEl.innerHTML = renderMarkdown(
      content || "Не удалось получить ответ от модели за отведённое время (" + (reason || "timeout") + "). Попробуй переформулировать или повтори вопрос.");
    typesetMath(answerEl);
    finalizeTrace(traceEl);
    state.history.push({ role: "user", content: buildInitialUserMessage(userQuestion) });
    state.history.push({ role: "assistant", content: content || "" });
  }

  async function agentTurn(userQuestion, bubble) {
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...state.history.slice(-8),
      { role: "user", content: buildInitialUserMessage(userQuestion) },
    ];

    const traceEl = bubble.querySelector(".sigma-trace");
    const traceBody = bubble.querySelector(".sigma-trace-body");
    const answerEl = bubble.querySelector(".sigma-answer");
    const statusEl = bubble.querySelector(".sigma-status");

    const seenCalls = new Set(); // dedup identical tool calls within one turn
    state._loopMessages = messages; // expose for finishFromContext fallback
    for (let step = 0; step < MAX_STEPS; step++) {
      statusEl.textContent = `Думаю… (шаг ${step + 1})`;
      let content, tool_calls;
      try {
        ({ content, tool_calls } = await streamCompletion(messages));
      } catch (e) {
        // A completion stalled/failed mid-loop (e.g. an image step hung upstream).
        // Never leave an empty bubble — force a final text-only answer instead.
        return await finishFromContext(userQuestion, bubble, traceEl, statusEl, answerEl, String(e?.message || e));
      }

      const assistantMsg = { role: "assistant", content: content || "" };
      if (tool_calls.length) assistantMsg.tool_calls = tool_calls;
      messages.push(assistantMsg);

      if (!tool_calls.length) {
        // The model ended the turn with no further tool calls. If it produced
        // EMPTY content here, rendering it would leave a blank bubble (the user
        // sees the tool trace but no answer — a real observed failure). Force a
        // final text-only completion so the turn always yields SOMETHING.
        if (!(content || "").trim()) {
          return await finishFromContext(userQuestion, bubble, traceEl, statusEl, answerEl, "пустой финальный ответ");
        }
        statusEl.remove();
        answerEl.dataset.raw = content || "";
        answerEl.innerHTML = renderMarkdown(content || "");
        typesetMath(answerEl);
        finalizeTrace(traceEl);
        state.history.push({ role: "user", content: buildInitialUserMessage(userQuestion) });
        state.history.push(assistantMsg);
        return;
      }

      for (const tc of tool_calls) {
        let args = {};
        try { args = JSON.parse(tc.function.arguments || "{}"); } catch (_) { /* keep empty */ }
        const traceItem = renderTraceItem(tc.function.name, args);
        traceBody.append(traceItem);
        traceEl.hidden = false;
        const callKey = tc.function.name + ":" + (tc.function.arguments || "");
        let toolResult;
        if (seenCalls.has(callKey)) {
          // Same call, same args, already made — don't burn a step repeating it.
          toolResult = { note: "Этот вызов с теми же аргументами уже делался. Смени стратегию: " +
            "другой query/ядро, read_chapter по найденному slug, или дай ответ / честно скажи, что не нашёл." };
        } else {
          seenCalls.add(callKey);
          try {
            toolResult = await runTool(tc.function.name, args, traceItem);
          } catch (e) {
            toolResult = { error: String(e?.message || e) };
          }
        }
        decorateTraceItem(traceItem, toolResult);
        const images = Array.isArray(toolResult?.images) ? toolResult.images : [];
        for (const img of images) {
          bubble.querySelector(".sigma-images").append(el("img", {
            class: "sigma-figure",
            src: `data:image/png;base64,${img}`,
            alt: "Сгенерированная диаграмма",
          }));
        }
        // Tool result content as OpenAI multimodal parts: text + image_url.
        // No role-mixing, no inline instructions — just the raw tool output.
        // The loop itself decides what to do next; backend auto-routes to a
        // vision-capable free model whenever image_url appears in messages.
        const textPayload = { ...toolResult };
        if (Array.isArray(textPayload.images)) delete textPayload.images;
        const toolContent = [
          { type: "text", text: truncate(JSON.stringify(textPayload), TOOL_CHAR_LIMIT) },
          ...images.map(b64 => ({
            type: "image_url",
            image_url: { url: `data:image/png;base64,${b64}` },
          })),
        ];
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: images.length ? toolContent : toolContent[0].text,
        });
      }
    }

    // MAX_STEPS exhausted while still calling tools → force a final answer from
    // what was gathered, rather than emitting a generic dead-end string.
    return await finishFromContext(userQuestion, bubble, traceEl, statusEl, answerEl, "исчерпаны " + MAX_STEPS + " шагов");
  }

  // -------------------------------------------------------------------------
  // UI rendering
  // -------------------------------------------------------------------------

  // Neutral monochrome icons — Lucide-style, currentColor, 16×16 viewbox,
  // 1.6px stroke. No tool-specific colour; status uses muted fg only.
  const TOOL_ICONS = {
    search_textbook:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="4.25"/><path d="m13.25 13.25-2.85-2.85"/></svg>',
    read_chapter:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 3.25h4.25a1.75 1.75 0 0 1 1.75 1.75v8.25"/><path d="M13.5 3.25H9.25A1.75 1.75 0 0 0 7.5 5v8.25"/><path d="M2.5 3.25v9.5h4.25"/><path d="M13.5 3.25v9.5H9.25"/></svg>',
    get_outline:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="3.25" cy="4" r=".6"/><circle cx="3.25" cy="8" r=".6"/><circle cx="3.25" cy="12" r=".6"/><path d="M6 4h7"/><path d="M6 8h7"/><path d="M6 12h4.5"/></svg>',
    find_definition:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.25 2.5h5.5l2.5 2.5v8.5a.75.75 0 0 1-.75.75H4.25a.75.75 0 0 1-.75-.75V3.25a.75.75 0 0 1 .75-.75z"/><path d="M9.5 2.5v2.75H12"/><path d="M6 8.75h4"/><path d="M6 11.25h4"/></svg>',
    find_theorem:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.25H4.5l3.25 4.75-3.25 4.75H12"/></svg>',
    python:
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m3 5 2.75 3L3 11"/><path d="M7.5 11.25h5.5"/></svg>',
  };
  const DOT_ICON =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="2.25"/></svg>';
  const SPINNER_ICON =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" class="sigma-spin"><path d="M8 2a6 6 0 1 1-6 6"/></svg>';
  const CHECK_ICON =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m3.25 8.25 3.25 3.25 6.25-6.5"/></svg>';
  const ERR_ICON =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="m4 4 8 8M12 4l-8 8"/></svg>';

  const TOOL_LABELS = {
    search_textbook: "Поиск",
    read_chapter: "Глава",
    get_outline: "Оглавление",
    find_definition: "Определение",
    find_theorem: "Теорема",
    python: "Python",
  };

  function _humanArg(name, args) {
    if (!args || typeof args !== "object") return "";
    if (name === "python") {
      const code = (args.code || "").trim();
      const first = code.split("\n", 1)[0];
      return first.length > 60 ? first.slice(0, 60) + "…" : first;
    }
    const v = args.query || args.term || args.slug || "";
    if (!v) return "";
    return v.length > 60 ? v.slice(0, 60) + "…" : v;
  }

  const CHEV_ICON =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 4 4 4-4 4"/></svg>';

  function _prettyJson(v) {
    try { return JSON.stringify(v, null, 2); }
    catch { return String(v); }
  }

  function _resultForDisplay(result) {
    if (!result || typeof result !== "object") return result;
    const d = { ...result };
    if (Array.isArray(d.images) && d.images.length) {
      d.images = `[${d.images.length} PNG, скрыты — отображены под ответом]`;
    }
    // text-поля могут быть очень длинными — отображаем целиком, но если больше
    // 8K символов, обрезаем (ассистент всё равно видит truncate'нутую версию).
    if (typeof d.text === "string" && d.text.length > 8000) {
      d.text = d.text.slice(0, 8000) + `\n\n…(обрезано, всего ${d.text.length} символов)`;
    }
    return d;
  }

  function renderTraceItem(name, args) {
    const label = TOOL_LABELS[name] || name;
    const arg = _humanArg(name, args);
    const iconHtml = TOOL_ICONS[name] || DOT_ICON;

    const row = el("div", { class: "sigma-trace-row" },
      el("span", { class: "sigma-trace-icon", html: iconHtml }),
      el("span", { class: "sigma-trace-label" }, label),
      arg ? el("span", { class: "sigma-trace-arg" }, arg) : null,
      el("span", { class: "sigma-trace-chev", html: CHEV_ICON }),
      el("span", { class: "sigma-trace-status", html: SPINNER_ICON }),
    );

    const details = el("div", { class: "sigma-trace-details" });
    details.append(el("div", { class: "sigma-trace-detail-block" },
      el("div", { class: "sigma-trace-detail-h" }, "Аргументы"),
      el("pre", { class: "sigma-trace-detail-code" }, _prettyJson(args)),
    ));

    const node = el("div", { class: "sigma-trace-node sigma-trace-pending" }, row, details);

    row.addEventListener("click", (e) => {
      e.stopPropagation();
      node.classList.toggle("sigma-trace-expanded");
    });

    return node;
  }

  function decorateTraceItem(item, result) {
    item.classList.remove("sigma-trace-pending");
    const status = item.querySelector(".sigma-trace-status");
    if (result?.error) {
      item.classList.add("sigma-trace-err");
      status.innerHTML = ERR_ICON;
      status.title = truncate(result.error, 200);
    } else {
      item.classList.add("sigma-trace-ok");
      let summary = "";
      if (Array.isArray(result?.results)) summary = `${result.results.length}`;
      else if (result?.chapters) summary = `${result.chapters.length}`;
      else if (result?.images?.length) summary = `${result.images.length} png`;
      else if (result?.text) summary = `${Math.round(result.text.length / 100) / 10}k`;
      status.innerHTML = (summary ? `<span class="sigma-trace-count">${summary}</span>` : "") + CHECK_ICON;
    }

    const details = item.querySelector(".sigma-trace-details");
    if (details) {
      details.append(el("div", { class: "sigma-trace-detail-block" },
        el("div", { class: "sigma-trace-detail-h" }, result?.error ? "Ошибка" : "Результат"),
        el("pre", { class: "sigma-trace-detail-code" }, _prettyJson(_resultForDisplay(result))),
      ));
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function renderKatex(expr, displayMode) {
    if (!window.katex) return escapeHtml((displayMode ? "$$" : "$") + expr + (displayMode ? "$$" : "$"));
    try {
      return window.katex.renderToString(expr, {
        displayMode, throwOnError: false, output: "html",
        strict: "ignore", trust: false,
      });
    } catch (_) {
      return `<code>${escapeHtml(expr)}</code>`;
    }
  }

  // Markdown renderer with proper support for headers, lists, links, code,
  // tables, hr, blockquote, AND inline KaTeX (rendered via window.katex
  // directly, since Quarto loads katex.min.js but not auto-render).
  function renderMarkdown(md) {
    const stash = [];
    const STASH = (item) => { stash.push(item); return `${stash.length - 1}`; };

    let s = String(md);

    // 1) Shield math FIRST (so HTML escape doesn't mangle TeX chars).
    s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, e) => STASH({ k: "mblock", v: e }));
    s = s.replace(/(?<!\$|\\)\$([^\n$]+?)\$(?!\$)/g, (_, e) => STASH({ k: "minline", v: e }));

    // 2) Shield fenced code blocks and inline code.
    s = s.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => STASH({ k: "code-block", lang, code }));
    s = s.replace(/`([^`\n]+)`/g, (_, code) => STASH({ k: "code-inline", code }));

    // 3) HTML-escape everything else.
    s = escapeHtml(s);

    // 4) Tables (pipe syntax).
    s = s.replace(/(^\|.+\|\n\|[-:|\s]+\|\n(?:^\|.+\|\n?)+)/gm, (block) => {
      const lines = block.trim().split("\n");
      const head = lines[0].split("|").slice(1, -1).map(c => c.trim());
      const body = lines.slice(2).map(l => l.split("|").slice(1, -1).map(c => c.trim()));
      return "<table class='sigma-tbl'><thead><tr>" +
        head.map(h => `<th>${h}</th>`).join("") +
        "</tr></thead><tbody>" +
        body.map(r => "<tr>" + r.map(c => `<td>${c}</td>`).join("") + "</tr>").join("") +
        "</tbody></table>";
    });

    // 5) Block-level: headers, hr, lists, blockquote.
    const lines = s.split("\n");
    const out = [];
    let listKind = null;
    const closeList = () => { if (listKind) { out.push(`</${listKind}>`); listKind = null; } };
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, "");
      let m;
      if ((m = /^(#{1,6})\s+(.+)$/.exec(line))) {
        closeList();
        // Demote: chat bubble is small, h1 should not dwarf paragraphs.
        const lvl = Math.min(6, m[1].length + 2);
        out.push(`<h${lvl}>${m[2]}</h${lvl}>`);
      } else if (/^[-*_]{3,}\s*$/.test(line)) {
        closeList();
        out.push("<hr>");
      } else if ((m = /^\s*[-*]\s+(.+)$/.exec(line))) {
        if (listKind !== "ul") { closeList(); out.push("<ul>"); listKind = "ul"; }
        out.push(`<li>${m[1]}</li>`);
      } else if ((m = /^\s*\d+\.\s+(.+)$/.exec(line))) {
        if (listKind !== "ol") { closeList(); out.push("<ol>"); listKind = "ol"; }
        out.push(`<li>${m[1]}</li>`);
      } else if ((m = /^&gt;\s*(.+)$/.exec(line))) {
        closeList();
        out.push(`<blockquote>${m[1]}</blockquote>`);
      } else if (!line.trim()) {
        closeList();
        out.push("");
      } else {
        closeList();
        out.push(line);
      }
    }
    closeList();
    s = out.join("\n");

    // 6) Inline: images, links, bold, italic.
    // Images FIRST — so the leading `!` isn't orphaned and the link rule below doesn't
    // eat the `[…](…)` part. Real images (book figures /figures/…, http(s), data:) render
    // inline; agent-drawn figures auto-attach below the bubble, so the model's invented
    // placeholder refs (png://…, media://…, sandbox:/…, attachment:…, bare filename.png)
    // are shown as a small caption, never a broken link.
    s = s.replace(/!\[([^\]\n]*)\]\(([^()\s]+)\)/g, (_, alt, u) => {
      if (/^(https?:\/\/|data:image\/|\/)/.test(u)) {
        const cap = alt ? `<figcaption class="sigma-figcap">${alt}</figcaption>` : "";
        return `<figure class="sigma-figref"><img class="sigma-figure" src="${u}" loading="lazy">${cap}</figure>`;
      }
      return alt ? `<span class="sigma-figcap">🖼 ${alt}</span>` : "";
    });
    s = s.replace(/\[([^\]\n]+)\]\(([^()\s]+)\)/g, (_, t, u) => {
      const external = /^https?:\/\//.test(u) && !/sigma\.fmin\.xyz/.test(u);
      const tgt = external ? ' target="_blank" rel="noopener"' : '';
      return `<a href="${u}" class="sigma-link"${tgt}>${t}</a>`;
    });
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, "<em>$1</em>");
    // Spoiler: ||answer|| → click-to-reveal (used by the «Проверь меня» quiz).
    s = s.replace(/\|\|([^|]+?)\|\|/g, (_, t) =>
      `<span class="sigma-spoiler" role="button" tabindex="0" title="Показать ответ">${t}</span>`);

    // 7) Wrap orphan plain lines in <p>.
    const BLOCK = /^<(h[1-6]|ul|ol|li|hr|blockquote|pre|table|tr|td|th|thead|tbody|p|div|figure|figcaption)/i;
    const BLOCK_END = /^<\/(h[1-6]|ul|ol|li|hr|blockquote|pre|table|tr|td|th|thead|tbody|p|div|figure|figcaption)/i;
    const finalLines = s.split("\n");
    const result = [];
    let para = [];
    const flushPara = () => { if (para.length) { result.push(`<p>${para.join("<br>")}</p>`); para = []; } };
    for (const ln of finalLines) {
      const t = ln.trim();
      if (!t) { flushPara(); continue; }
      if (BLOCK.test(t) || BLOCK_END.test(t)) { flushPara(); result.push(ln); }
      else para.push(ln);
    }
    flushPara();
    s = result.join("\n");

    // 8) Restore stashed math + code (math is rendered HERE via KaTeX).
    s = s.replace(/(\d+)/g, (_, i) => {
      const it = stash[Number(i)];
      if (it.k === "mblock") return renderKatex(it.v, true);
      if (it.k === "minline") return renderKatex(it.v, false);
      if (it.k === "code-block") {
        const code = escapeHtml(it.code);
        return `<pre class="sigma-code${it.lang ? " lang-" + it.lang : ""}"><code>${code}</code></pre>`;
      }
      if (it.k === "code-inline") return `<code>${escapeHtml(it.code)}</code>`;
      return "";
    });

    return s;
  }

  // Re-fit display-math after layout settles (handle long $$...$$ that overflow bubble).
  function typesetMath(node) {
    if (!node) return;
    const els = node.querySelectorAll(".katex-display");
    for (const el of els) {
      el.style.transform = "";
      requestAnimationFrame(() => {
        const inner = el.querySelector(".katex");
        if (!inner) return;
        const avail = el.clientWidth;
        const need = inner.scrollWidth;
        if (need > avail && avail > 0) {
          const scale = Math.max(0.55, avail / need);
          if (scale < 1) {
            inner.style.transformOrigin = "left center";
            inner.style.transform = `scale(${scale.toFixed(3)})`;
          }
        }
      });
    }
  }

  const CARET_ICON =
    '<svg class="sigma-trace-caret" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m4 6 4 4 4-4"/></svg>';

  function newAnswerBubble() {
    const trace = el("div", { class: "sigma-trace", hidden: "" },
      el("button", {
        class: "sigma-trace-summary",
        type: "button",
        "aria-label": "Показать/скрыть шаги",
        hidden: "",
      }),
      el("div", { class: "sigma-trace-body" }),
    );
    trace.querySelector(".sigma-trace-summary").addEventListener("click", () => {
      trace.classList.toggle("sigma-trace-collapsed");
    });
    const bubble = el("div", { class: "sigma-bubble sigma-bubble-assistant" },
      el("div", { class: "sigma-status" }, "Думаю…"),
      trace,
      el("div", { class: "sigma-images" }),
      el("div", { class: "sigma-answer" })
    );
    sheetBody.append(bubble);
    sheetBody.scrollTop = sheetBody.scrollHeight;
    return bubble;
  }

  // Build the collapsed summary line from completed trace nodes.
  function finalizeTrace(traceEl) {
    const body = traceEl.querySelector(".sigma-trace-body");
    const summary = traceEl.querySelector(".sigma-trace-summary");
    const nodes = body.querySelectorAll(".sigma-trace-node");
    if (!nodes.length) return;
    const icons = [...nodes].map(n => {
      const ic = n.querySelector(".sigma-trace-icon");
      return ic ? `<span class="sigma-trace-icon">${ic.innerHTML}</span>` : "";
    }).join("");
    const n = nodes.length;
    const word = n === 1 ? "шаг" : (n >= 2 && n <= 4 ? "шага" : "шагов");
    summary.innerHTML =
      `<span class="sigma-trace-summary-icons">${icons}</span>` +
      `<span class="sigma-trace-summary-count">${n} ${word}</span>` +
      CARET_ICON;
    summary.hidden = false;
    traceEl.classList.add("sigma-trace-collapsed");
  }
  function newUserBubble(text) {
    const bubble = el("div", { class: "sigma-bubble sigma-bubble-user" },
      state.selectedFragment
        ? el("div", { class: "sigma-bubble-fragment" }, "« " + truncate(state.selectedFragment, 120) + " »")
        : null,
      el("div", { class: "sigma-bubble-text" }, text)
    );
    sheetBody.append(bubble);
    sheetBody.scrollTop = sheetBody.scrollHeight;
    return bubble;
  }

  // -------------------------------------------------------------------------
  // Wire send / reset
  // -------------------------------------------------------------------------

  async function send() {
    if (state.busy) return;
    const text = input.value.trim();
    if (!text) return;
    state.busy = true; sendBtn.disabled = true;
    input.value = "";
    clearEmptyState();
    newUserBubble(text);
    const bubble = newAnswerBubble();
    try {
      await agentTurn(text, bubble);
    } catch (e) {
      bubble.querySelector(".sigma-status").textContent = "Ошибка: " + (e?.message || e);
    } finally {
      state.busy = false; sendBtn.disabled = false;
    }
  }
  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(120, input.scrollHeight) + "px";
  });
  resetBtn.addEventListener("click", () => {
    state.history = [];
    sheetBody.replaceChildren();
    renderEmptyState();
    renderSuggestions();
  });

  // -------------------------------------------------------------------------
  // Public API (used e.g. by landing-page suggestion chips).
  // window.sigmaAssistant.ask(question)  — открыть лист, подставить вопрос,
  //                                         запустить агент.
  // window.sigmaAssistant.open() / .close() — управление видимостью.
  // -------------------------------------------------------------------------
  window.sigmaAssistant = {
    ask(question) {
      if (typeof question !== "string" || !question.trim()) return;
      openSheet();
      input.value = question;
      input.dispatchEvent(new Event("input"));
      // дождаться, чтобы input точно был в DOM и focus сработал
      setTimeout(() => { if (!state.busy) send(); }, 80);
    },
    open: openSheet,
    close: closeSheet,
  };
})();
