import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const port = 32000 + process.pid % 1000;
const debugPort = 33000 + process.pid % 1000;
const origin = `http://127.0.0.1:${port}`;
const profile = mkdtempSync(join(tmpdir(), "mawar-browser-test-"));
const chromeCandidates = process.platform === "win32"
  ? ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"]
  : process.platform === "darwin"
    ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
    : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
const chromePath = chromeCandidates.find(existsSync);
if (!chromePath) throw new Error("Chrome/Chromium tidak tersedia untuk browser regression test.");

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { stdio: "ignore", windowsHide: true });
const chrome = spawn(chromePath, ["--headless=new", `--remote-debugging-port=${debugPort}`, "--remote-allow-origins=*", `--user-data-dir=${profile}`, "--disable-gpu", "--disable-software-rasterizer", "--disable-gpu-compositing", "--no-sandbox", "--no-first-run", "about:blank"], { stdio: "ignore", windowsHide: true });

let socket;
try {
  for (let attempt = 0; attempt < 80; attempt++) { try { if ((await fetch(origin)).ok) break; } catch {} await sleep(100); }
  let tabs;
  for (let attempt = 0; attempt < 80; attempt++) { try { tabs = await fetch(`http://127.0.0.1:${debugPort}/json`).then(response => response.json()); break; } catch {} await sleep(100); }
  assert.ok(tabs?.length, "Chrome DevTools endpoint harus tersedia");
  socket = new WebSocket(tabs.find(tab => tab.type === "page").webSocketDebuggerUrl);
  await Promise.race([
    new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error("Chrome DevTools WebSocket gagal terhubung")); }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Chrome DevTools WebSocket timeout")), 5000)),
  ]);
  let serial = 0;
  const pending = new Map();
  const runtimeErrors = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") runtimeErrors.push(message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") runtimeErrors.push(message.params.args.map(arg => arg.value ?? arg.description).join(" "));
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  };
  const send = (method, params = {}) => new Promise(resolve => { const id = ++serial; pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const message = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (message.result.exceptionDetails) throw new Error(message.result.exceptionDetails.exception?.description ?? message.result.exceptionDetails.text);
    return message.result.result.value;
  };
  const waitFor = async selector => {
    for (let attempt = 0; attempt < 80; attempt++) { if (await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return; await sleep(75); }
    throw new Error(`Selector tidak ditemukan: ${selector}`);
  };
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Network.setBlockedURLs", { urls: ["https://geoservices.big.go.id/*"] });

  const viewports = [[1440, 900], [1024, 768], [768, 1024], [390, 844]];
  for (const [width, height] of viewports) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 430 });
    await send("Storage.clearDataForOrigin", { origin, storageTypes: "local_storage,session_storage" });
    await send("Page.navigate", { url: origin }); await waitFor(".executive-big-layer [data-region-id='93.01.05']");
    assert.equal(await evaluate("document.querySelectorAll('.executive-big-layer text').length"), 0);

    await evaluate(`(()=>{const select=[...document.querySelectorAll('.executive-filters select')].find(node=>node.closest('label')?.innerText.includes('WILAYAH'));select.value='93.01.05';select.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await sleep(40);
    const semanggaUrl = await evaluate("location.href");
    assert.match(semanggaUrl, /district=93\.01\.05/);
    assert.equal(await evaluate("document.querySelector('.executive-map-region-tooltip')?.innerText"), "Semangga \u2014 Distrik");

    await evaluate("document.querySelector(\".executive-big-layer [data-region-id='93.01.02']\").dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))"); await sleep(25);
    assert.equal(await evaluate("document.querySelector('.executive-map-region-tooltip')?.innerText"), "Muting \u2014 Distrik");
    assert.equal(await evaluate("document.querySelector('.executive-big-layer g.selected')?.dataset.regionId"), "93.01.05");
    assert.equal(await evaluate("location.href"), semanggaUrl);
    await evaluate("document.querySelector(\".executive-big-layer [data-region-id='93.01.02']\").dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:document.body}))"); await sleep(25);
    assert.equal(await evaluate("document.querySelector('.executive-map-region-tooltip')?.innerText"), "Semangga \u2014 Distrik");

    await evaluate(`(()=>{const node=document.querySelector(".executive-big-layer [data-region-id='93.01.03']");node.focus();node.dispatchEvent(new FocusEvent('focusin',{bubbles:true}))})()`); await sleep(25);
    assert.equal(await evaluate("document.querySelector('.executive-map-region-tooltip')?.innerText"), "Okaba \u2014 Distrik");
    await evaluate("document.querySelector(\".executive-big-layer [data-region-id='93.01.02']\").dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))"); await sleep(25);
    assert.equal(await evaluate("document.querySelector('.executive-map-region-tooltip')?.innerText"), "Muting \u2014 Distrik");
    await evaluate("document.querySelector(\".executive-big-layer [data-region-id='93.01.02']\").dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:document.body}))"); await sleep(25);
    assert.equal(await evaluate("document.querySelector('.executive-map-region-tooltip')?.innerText"), "Okaba \u2014 Distrik");
    await evaluate(`(()=>{const node=document.querySelector(".executive-big-layer [data-region-id='93.01.03']");node.dispatchEvent(new FocusEvent('focusout',{bubbles:true,relatedTarget:document.body}));node.blur()})()`); await sleep(25);
    assert.equal(await evaluate("document.querySelector('.executive-map-region-tooltip')?.innerText"), "Semangga \u2014 Distrik");
    assert.equal(await evaluate("document.querySelector('.executive-big-layer g.selected')?.dataset.regionId"), "93.01.05");
    assert.equal(await evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1"), false);
    if (width === 1440) {
      await evaluate("document.querySelector(\".executive-big-layer [data-region-id='93.01.02']\").dispatchEvent(new MouseEvent('click',{bubbles:true}))"); await sleep(25);
      assert.match(await evaluate("location.href"), /district=93\.01\.02/);
      await evaluate("document.querySelector(\".executive-big-layer [data-region-id='93.01.03']\").dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))"); await sleep(25);
      assert.match(await evaluate("location.href"), /district=93\.01\.03/);
      await evaluate("document.querySelector(\".executive-big-layer [data-region-id='93.01.05']\").dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}))"); await sleep(25);
      assert.match(await evaluate("location.href"), /district=93\.01\.05/);
    }
  }

  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await evaluate("document.querySelector('button.nav-item[aria-label=\"Buka halaman Peta Lahan\"]')?.click()"); await waitFor("#map-region-query");
  assert.equal(await evaluate("document.querySelector('#map-region-query').value"), "Semangga \u2014 Distrik");
  assert.equal(await evaluate("document.querySelectorAll('.map-region-search .lucide-search').length"), 1);
  assert.equal(await evaluate("document.querySelectorAll('.map-region-search .lucide-chevron-down').length"), 1);
  assert.equal(await evaluate("document.querySelector('label[for=\"map-region-query\"]')?.innerText"), "Cari wilayah pada peta");
  const searchResult = await evaluate(`(async()=>{const input=document.querySelector('#map-region-query'),set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(input,'SeMaNgGa');input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(requestAnimationFrame);return document.querySelectorAll('.map-region-options [role=option]').length})()`);
  assert.equal(searchResult, 1);
  assert.equal(await evaluate("document.querySelector('.map-region-options [role=option]')?.innerText"), "Semangga\n\u2014 Distrik");
  await evaluate("document.querySelector('.map-region-options [role=option]').click()"); await sleep(25);
  assert.equal(await evaluate("document.querySelector('#map-region-query').value"), "Semangga \u2014 Distrik");
  assert.match(await evaluate("location.href"), /district=93\.01\.05/);
  assert.equal(await evaluate("/[\u00c3\ufffd]|\u00e2(?:\u20ac|\u0152)/u.test(document.body.innerText)"), false);
  await evaluate("document.querySelector('button.nav-item[aria-label=\"Buka halaman Produksi\"]')?.click()"); await waitFor(".monitoring-chart-production");
  const desktop = await evaluate(`(()=>{const q=s=>document.querySelector(s),fs=s=>parseFloat(getComputedStyle(q(s)).fontSize),layout=q('.production-insight-layout');return{legend:fs('.monitoring-chart-production .monitoring-chart-legend'),tooltipTitle:(q('.monitoring-chart-production .chart-point').dispatchEvent(new MouseEvent('mouseover',{bubbles:true})),null),columns:getComputedStyle(layout).gridTemplateColumns,insight:fs('.production-insight-list p'),line:parseFloat(getComputedStyle(q('.production-insight-list p')).lineHeight)/fs('.production-insight-list p'),icon:q('.production-insight-list svg').getBoundingClientRect().width,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,disclaimer:q('.production-insight-disclaimer').innerText}})()`);
  await sleep(25);
  desktop.tooltipTitle = await evaluate("parseFloat(getComputedStyle(document.querySelector('.monitoring-chart-production .monitoring-chart-tooltip>strong')).fontSize)");
  assert.ok(desktop.columns.split(" ").length === 2 && desktop.legend >= 12 && desktop.tooltipTitle >= 13 && desktop.insight >= 13 && desktop.line >= 1.5 && desktop.icon >= 20 && !desktop.overflow);
  assert.equal(desktop.disclaimer, "Insight dihasilkan otomatis berdasarkan aturan data prototipe, bukan menggunakan AI generatif.");
  assert.deepEqual(runtimeErrors, []);
  console.log(`Browser DOM PASS: ${viewports.map(([w,h])=>`${w}x${h}`).join(", ")}`);
} finally {
  try { socket?.close(); } catch {}
  server.kill(); chrome.kill();
  await sleep(150);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
