// Pyodide Web Worker — isolates Python execution from the main page.
//
// Lifecycle:
//   "init"   → load Pyodide, preload numpy/matplotlib/sympy. Posts progress.
//   "run"    → execute Python in the shared namespace. Captures stdout/stderr.
//              If a matplotlib figure was created since last call, it is
//              auto-saved as base64 PNG and returned in `images`. Anything
//              written by user code to /tmp/figs/ (.png) is also collected.
//
// Notes:
// - One worker per chat session → namespace persists across calls (a global
//   defined in turn N is available in turn N+1).
// - matplotlib runs in Agg backend; we close all figures after capture so a
//   fresh figure isn't double-rendered next call.
// - Network and DOM are unreachable from here by design.

let pyodide = null;
let initPromise = null;
// Per-call buffers. Pyodide stdout/stderr callbacks fire during runPythonAsync,
// so we route them into the active call's buffer and return the captured text
// in the same result message. Previously these went to fire-and-forget
// `post("stdout", ...)` events the main thread never read.
let activeStdout = "";
let activeStderr = "";

const PYODIDE_VERSION = "0.29.4";
const PYODIDE_INDEX = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

function post(type, payload) {
  self.postMessage({ type, ...payload });
}

async function init() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    post("progress", { stage: "loader", message: "Загружаю Python в браузере (Pyodide), ~15 c" });
    importScripts(PYODIDE_INDEX + "pyodide.js");
    pyodide = await self.loadPyodide({
      indexURL: PYODIDE_INDEX,
      stdout: (s) => { activeStdout += s + "\n"; },
      stderr: (s) => { activeStderr += s + "\n"; },
    });
    post("progress", { stage: "packages", message: "Почти готово: подгружаю numpy, matplotlib, sympy" });
    await pyodide.loadPackage(["numpy", "matplotlib", "sympy", "pillow"]);
    // Bootstrap the namespace: switch matplotlib to Agg, give code a place
    // to save figures, and define a tiny helper that the agent can call.
    await pyodide.runPythonAsync(`
import os, io, base64
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import sympy as sp

os.makedirs("/tmp/figs", exist_ok=True)

def _capture_figures():
    """Return list of base64-encoded PNGs for every currently open figure,
    then close them. Auto-called by the runner after each user snippet so
    plots flow back to the chat as image bubbles."""
    out = []
    for num in plt.get_fignums():
        fig = plt.figure(num)
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=120, bbox_inches="tight")
        out.append(base64.b64encode(buf.getvalue()).decode("ascii"))
    plt.close("all")
    return out
`);
    post("ready", {});
  })();
  return initPromise;
}

async function run(code) {
  await init();
  activeStdout = "";
  activeStderr = "";
  let result = null;
  let error = null;
  try {
    result = await pyodide.runPythonAsync(code);
  } catch (e) {
    error = String(e?.message || e);
  }
  // Always try to capture figures even on error — the failure may have come
  // after plotting but before plt.show().
  let images = [];
  try {
    const pyImgs = await pyodide.runPythonAsync("_capture_figures()");
    images = pyImgs.toJs ? pyImgs.toJs() : Array.from(pyImgs);
  } catch (_) { /* swallow */ }
  // Also drain anything written to /tmp/figs/ as a side channel
  try {
    const extras = await pyodide.runPythonAsync(`
import os, base64
_out = []
for fn in sorted(os.listdir("/tmp/figs")):
    if fn.lower().endswith(".png"):
        with open(os.path.join("/tmp/figs", fn), "rb") as f:
            _out.append(base64.b64encode(f.read()).decode("ascii"))
        os.remove(os.path.join("/tmp/figs", fn))
_out
`);
    const arr = extras.toJs ? extras.toJs() : Array.from(extras);
    images.push(...arr);
  } catch (_) { /* swallow */ }
  // Animated/rich media side channel: collect .gif/.webp/.mp4 written to
  // /tmp/figs as {mime, b64}. Kept separate from `images` (PNG-only) so the
  // chat widget stays unchanged; the inline runner renders these animated.
  let media = [];
  try {
    const rich = await pyodide.runPythonAsync(`
import os, base64
_mt = {"gif": "image/gif", "webp": "image/webp", "mp4": "video/mp4", "webm": "video/webm"}
_m = []
for fn in sorted(os.listdir("/tmp/figs")):
    ext = fn.rsplit(".", 1)[-1].lower() if "." in fn else ""
    if ext in _mt:
        with open(os.path.join("/tmp/figs", fn), "rb") as f:
            _m.append([_mt[ext], base64.b64encode(f.read()).decode("ascii")])
        os.remove(os.path.join("/tmp/figs", fn))
_m
`);
    const rarr = rich.toJs ? rich.toJs() : Array.from(rich);
    media = rarr.map((x) => ({ mime: x[0], b64: x[1] }));
  } catch (_) { /* swallow */ }
  // Trim trailing newlines; cap each stream to keep tool payload reasonable.
  const cap = (s) => {
    if (!s) return "";
    s = s.replace(/\n+$/, "");
    return s.length > 4000 ? s.slice(0, 4000) + "\n…[обрезано]" : s;
  };
  return {
    result: result === undefined || result === null ? null : String(result),
    error,
    stdout: cap(activeStdout),
    stderr: cap(activeStderr),
    images,
    media,
  };
}

self.onmessage = async (e) => {
  const { type, id, code } = e.data;
  if (type === "init") {
    try { await init(); post("ack", { id }); }
    catch (err) { post("error", { id, error: String(err) }); }
  } else if (type === "run") {
    try {
      const r = await run(code);
      post("result", { id, ...r });
    } catch (err) {
      post("result", { id, result: null, error: String(err), images: [] });
    }
  }
};
