// verify_widget.mjs — браузерная проверка живых виджетов Сигмы.
// Грузит страницу, ждёт монтирования, ловит console-ошибки, двигает каждый
// ползунок (min→max), проверяет что виджет ПЕРЕРИСОВЫВАЕТСЯ (canvas меняется),
// делает скриншоты до/после. Это и верификация, и инструмент design-review.
//
// Запуск:  node scripts/verify_widget.mjs <url> <outDir> [widgetIndex]
//   node scripts/verify_widget.mjs https://sigma.fmin.xyz/story_pca.html /tmp/sigverify
import { chromium } from "playwright";
import fs from "fs";

const url = process.argv[2] || "https://sigma.fmin.xyz/story_pca.html";
const outDir = process.argv[3] || "/tmp/sigverify";
fs.mkdirSync(outDir, { recursive: true });
const slug = url.split("/").pop().replace(/\.html$/, "") || "page";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 1400 }, deviceScaleFactor: 2 });

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

// дождаться появления холстов/SVG внутри виджетов
const widgets = page.locator(".sigma-int");
const n = await widgets.count();
const report = { url, widgets: n, errors: [], results: [] };

if (n === 0) {
  report.errors.push("НЕТ смонтированных .sigma-int виджетов на странице");
}

// hash содержимого canvas (для проверки факта перерисовки)
async function canvasHash(handle) {
  return await handle.evaluate((el) => {
    const c = el.querySelector("canvas");
    if (!c) return null;
    try { return c.toDataURL().length + ":" + c.toDataURL().slice(-64); } catch (e) { return "tainted"; }
  });
}

for (let i = 0; i < n; i++) {
  const w = widgets.nth(i);
  await w.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const r = { index: i, hasCanvas: false, hasSvg: false, reactsToSlider: null, err: null };
  const hErr = await w.locator(".sigma-int-err").count();
  if (hErr) { r.err = await w.locator(".sigma-int-err").first().textContent(); }
  r.hasCanvas = (await w.locator("canvas").count()) > 0;
  r.hasSvg = (await w.locator("svg.sigma-int-svg").count()) > 0;

  await w.screenshot({ path: `${outDir}/${slug}_w${i}_before.png` }).catch(() => {});

  // подвигать первый ползунок min→mid→max и проверить перерисовку
  const ranges = w.locator("input[type=range]");
  const nr = await ranges.count();
  if (nr > 0 && r.hasCanvas) {
    const handle = await w.elementHandle();
    const h0 = await canvasHash(handle);
    const rng = ranges.first();
    const max = await rng.getAttribute("max");
    const min = await rng.getAttribute("min");
    await rng.fill(String(max));
    await rng.dispatchEvent("input");
    await page.waitForTimeout(300);
    const h1 = await canvasHash(handle);
    await rng.fill(String(min));
    await rng.dispatchEvent("input");
    await page.waitForTimeout(300);
    const h2 = await canvasHash(handle);
    r.reactsToSlider = (h0 !== h1) || (h1 !== h2);
    await rng.fill(String(Math.round((+min + +max) / 2)));
    await rng.dispatchEvent("input");
    await page.waitForTimeout(300);
    await w.screenshot({ path: `${outDir}/${slug}_w${i}_after.png` }).catch(() => {});
  }
  report.results.push(r);
}

report.errors.push(...errors);
fs.writeFileSync(`${outDir}/${slug}_report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
