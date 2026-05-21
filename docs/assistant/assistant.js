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
  const FRESH_OPTS = [
    "Объясни эту главу за 30 секунд",
    "Дай задачу из этой главы",
    "Что главное здесь понять?",
  ];

  function renderSuggestions() {
    suggestions.replaceChildren();
    const opts = state.selectedFragment ? FRAGMENT_OPTS : FRESH_OPTS;
    for (const o of opts) {
      suggestions.append(el("button", {
        class: "sigma-suggest",
        onclick: () => { input.value = o; sendBtn.click(); },
      }, o));
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
          "Don't use when: знаешь slug главы (используй read_chapter) или нужно конкретное определение (используй find_definition).",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "2-5 ключевых слов на русском, например 'Канторович Нобелевская премия'" },
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
          "Use when: студент спрашивает 'что такое X' или нужна точная формулировка.",
        parameters: {
          type: "object",
          properties: { term: { type: "string", description: "термин (1-3 слова), например 'сильно выпуклая'" } },
          required: ["term"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "find_theorem",
        description: "Найти формулировку теоремы/леммы/следствия по названию или ключевому слову. " +
          "Use when: студент просит формулировку, доказательство, или ссылку на конкретный результат.",
        parameters: {
          type: "object",
          properties: { query: { type: "string", description: "имя или ключевое слово (например 'Герона', 'SVD', 'Эйлера')" } },
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
    "Ты — встроенный ассистент учебника Σ (sigma.fmin.xyz) — школьно-вузовский учебник по информатике, " +
    "оптимизации, теории чисел, ML и ИИ. Отвечай по-русски, на уровне старшего школьника. " +
    "Markdown. Формулы только $...$ (inline) и $$...$$ (display) — не \\(...\\) и не \\[...\\]. " +
    "Стиль: разговорный, краткий. Заголовки `##` уместны только в развёрнутых объяснениях (>5 абзацев); " +
    "для коротких ответов — простые абзацы, списки `-`/`1.`, выделения **жирным**.\n\n" +
    "Правила работы с инструментами:\n" +
    "• Если вопрос про содержание учебника (факт, определение, теорема, история) — обязательно сделай " +
    "хотя бы один поисковый/lookup-вызов прежде чем отвечать. Не выдумывай ссылки на главы — найди их.\n" +
    "• URL'ы глав и секций НЕ выдумывай и НЕ собирай вручную. Берёшь поле `url` из результата любого " +
    "тула — это канонический путь. Часто `url` содержит якорь конкретного раздела, например " +
    "`/ch02_newton.html#ssec:thm-superlinear` — это ссылка ПРЯМО на нужный параграф, scroll сразу " +
    "попадёт куда надо. Используй точный `url` из тула, не отбрасывай якорь. В тексте подписи ссылки — " +
    "название раздела если оно известно, а не общее название главы: " +
    "`[Сверхлинейная сходимость метода Ньютона](/ch02_newton.html#ssec:thm-superlinear)`. Если у " +
    "результата есть поле `section` — используй его как анкорный текст. Если якоря нет — обычная " +
    "ссылка на главу: `[Численные методы оптимизации](/ch02_newton.html)`. Никаких bare-slug вроде " +
    "`(ch02_newton)`.\n" +
    "• Если студент УЖЕ читает запрашиваемую главу (его текущий slug совпадает с найденным) — не делай " +
    "лишний поиск. Скажи «ты уже на этой главе» + 2-3 буллета с разделами через `get_outline` или " +
    "просто текстом.\n" +
    "• Если вопрос требует расчёта, проверки формулы, или визуализации (график сходимости, разделяющая " +
    "прямая, RSA-шифрование на маленьких числах) — ОБЯЗАТЕЛЬНО вызови `python` для ЭТОГО вопроса. " +
    "Даже если в прошлой реплике уже был похожий график — для каждой новой просьбы строй новый. " +
    "НЕ ОПИСЫВАЙ предполагаемый график словами без запуска кода.\n" +
    "• Когда `python` вернул результат (stdout, числа, ответы) — ИСПОЛЬЗУЙ ЭТИ ЧИСЛА ДОСЛОВНО в финальном " +
    "ответе. Не пересчитывай в уме, не округляй, не сокращай — питон не ошибается, ты ошибёшься.\n" +
    "• Если `python` вернул картинки — их видишь И ТЫ (как картинку), И студент (в чате). Ты в режиме " +
    "vision-модели: проанализируй ИЗОБРАЖЕНИЕ, а не код. Опиши форму кривой, скорость, асимптоты, точки " +
    "пересечения, выбросы, расхождение/сходимость — то, что РЕАЛЬНО видно. Не повторяй то, что и так " +
    "видно — добавь интерпретацию. Если картинка не получилась (пустая, ошибка) — запусти python " +
    "снова с фиксом.\n" +
    "• Если в учебнике этого нет (бытовой вопрос, не из программы) — вежливо откажи, не выдумывай.\n" +
    "• Не зацикливайся: после 2-3 tool-вызовов давай финальный ответ.";

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

  async function streamCompletion(messages) {
    const r = await fetch(API.llm, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "text/event-stream" },
      body: JSON.stringify({ messages, tools: TOOLS, tool_choice: "auto", stream: true, temperature: 0.2 }),
    });
    if (!r.ok) throw new Error("LLM HTTP " + r.status);
    let content = "";
    const toolCalls = []; // [{id, function:{name,arguments}}]
    for await (const chunk of sseFromResponse(r)) {
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
    return { content, tool_calls: toolCalls.filter(Boolean) };
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

    for (let step = 0; step < MAX_STEPS; step++) {
      statusEl.textContent = `Думаю… (шаг ${step + 1})`;
      const { content, tool_calls } = await streamCompletion(messages);

      const assistantMsg = { role: "assistant", content: content || "" };
      if (tool_calls.length) assistantMsg.tool_calls = tool_calls;
      messages.push(assistantMsg);

      if (!tool_calls.length) {
        statusEl.remove();
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
        let toolResult;
        try {
          toolResult = await runTool(tc.function.name, args, traceItem);
        } catch (e) {
          toolResult = { error: String(e?.message || e) };
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

    statusEl.textContent = "Прервал после " + MAX_STEPS + " шагов.";
    answerEl.innerHTML = "Не сошёлся на ответ за отведённые шаги. Попробуй переформулировать.";
    finalizeTrace(traceEl);
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
    const STASH = (item) => { stash.push(item); return ` S${stash.length - 1} `; };

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

    // 6) Inline: links, bold, italic.
    s = s.replace(/\[([^\]\n]+)\]\(([^()\s]+)\)/g, (_, t, u) => {
      const external = /^https?:\/\//.test(u) && !/sigma\.fmin\.xyz/.test(u);
      const tgt = external ? ' target="_blank" rel="noopener"' : '';
      return `<a href="${u}" class="sigma-link"${tgt}>${t}</a>`;
    });
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, "<em>$1</em>");

    // 7) Wrap orphan plain lines in <p>.
    const BLOCK = /^<(h[1-6]|ul|ol|li|hr|blockquote|pre|table|tr|td|th|thead|tbody|p|div)/i;
    const BLOCK_END = /^<\/(h[1-6]|ul|ol|li|hr|blockquote|pre|table|tr|td|th|thead|tbody|p|div)/i;
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
    s = s.replace(/ S(\d+) /g, (_, i) => {
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
