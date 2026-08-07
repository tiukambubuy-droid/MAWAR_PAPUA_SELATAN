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

  const viewports = [[1920, 1080], [1440, 900], [1366, 768], [1024, 768], [768, 1024], [430, 932], [390, 844]];
  const foodLayoutMetrics = [];
  for (const [width, height] of viewports) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 430 });
    await send("Page.navigate", { url: "about:blank" });
    await send("Storage.clearDataForOrigin", { origin, storageTypes: "local_storage,session_storage" });
    await send("Page.navigate", { url: `${origin}/?season=MT2-2026` }); await waitFor(".executive-big-layer [data-region-id='93.01.05']");
    assert.equal(await evaluate("document.querySelectorAll('.executive-big-layer text').length"), 0);
    const summaryMetrics = await evaluate(`(()=>{const chart=document.querySelector('.executive-chart .monitoring-chart'),strip=chart.querySelector('.monitoring-chart-summary'),svg=chart.querySelector('svg'),axis=svg.querySelector('.chart-axis-row text'),cutoff=svg.querySelector('.chart-cutoff text'),sr=strip.getBoundingClientRect(),vr=svg.getBoundingClientRect();return{items:strip.querySelectorAll('.monitoring-chart-summary-item').length,labels:svg.querySelectorAll('.chart-value-label').length,labelFont:parseFloat(getComputedStyle(strip.querySelector('dt')).fontSize),valueFont:parseFloat(getComputedStyle(strip.querySelector('dd')).fontSize),axisHeight:axis.getBoundingClientRect().height,cutoffHeight:cutoff.getBoundingClientRect().height,inside:sr.left>=chart.getBoundingClientRect().left&&sr.right<=chart.getBoundingClientRect().right+1,ordered:sr.bottom<=vr.top+1,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}})()`);
    assert.equal(summaryMetrics.items, 3);
    assert.equal(summaryMetrics.labels, 0);
    assert.ok(summaryMetrics.labelFont >= 12 && summaryMetrics.valueFont >= 14 && summaryMetrics.axisHeight >= 10.5 && summaryMetrics.cutoffHeight >= 10.5, `${width}x${height}: ${JSON.stringify(summaryMetrics)}`);
    assert.ok(summaryMetrics.inside && summaryMetrics.ordered && !summaryMetrics.overflow);
    await evaluate("document.querySelector('.executive-chart .chart-point')?.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))"); await sleep(25);
    const tooltipMetrics = await evaluate(`(()=>{const tip=document.querySelector('.executive-chart .monitoring-chart-tooltip'),card=document.querySelector('.executive-chart').getBoundingClientRect(),strip=document.querySelector('.executive-chart .monitoring-chart-summary').getBoundingClientRect(),rect=tip.getBoundingClientRect();return{visible:Boolean(tip),inside:rect.left>=card.left&&rect.right<=card.right+1&&rect.top>=card.top&&rect.bottom<=card.bottom+1,below:rect.top>=strip.bottom-1,title:parseFloat(getComputedStyle(tip.querySelector('strong')).fontSize),line:parseFloat(getComputedStyle(tip).lineHeight)/parseFloat(getComputedStyle(tip).fontSize)}})()`);
    assert.ok(tooltipMetrics.visible && tooltipMetrics.inside && tooltipMetrics.below && tooltipMetrics.title >= 13 && tooltipMetrics.line >= 1.4);
    await evaluate(`(()=>{const point=document.querySelectorAll('.executive-chart .chart-point')[1];point.focus();point.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));point.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))})()`); await sleep(25);
    assert.equal(await evaluate("Boolean(document.querySelector('.executive-chart .monitoring-chart-tooltip'))"), false);
    await evaluate(`(()=>{const points=document.querySelectorAll('.executive-chart .chart-point');points[points.length-1].dispatchEvent(new MouseEvent('click',{bubbles:true}))})()`); await sleep(25);
    assert.equal(await evaluate("Boolean(document.querySelector('.executive-chart .monitoring-chart-tooltip'))"), true);
    await evaluate(`(()=>{const points=document.querySelectorAll('.executive-chart .chart-point');points[points.length-1].dispatchEvent(new MouseEvent('click',{bubbles:true}))})()`);
    await sleep(25);
    assert.equal(await evaluate("Boolean(document.querySelector('.executive-chart .monitoring-chart-tooltip'))"), false);
    await evaluate(`(()=>{const select=document.querySelector('.executive-filters select');select.value='MT1-2026';select.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(40);
    assert.equal(await evaluate("document.querySelectorAll('.executive-chart .monitoring-chart-summary-item').length"), 2);
    assert.equal(await evaluate("document.querySelector('.executive-chart .monitoring-chart-summary')?.innerText.includes('Proyeksi')"), false);
    await evaluate(`(()=>{const select=document.querySelector('.executive-filters select');select.value='MT2-2026';select.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(40);
    assert.equal(await evaluate("document.querySelectorAll('.executive-chart .monitoring-chart-summary-item').length"), 3);

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
    await evaluate("document.querySelector('button.nav-item[aria-label=\"Buka halaman Musim Tanam\"]')?.click()"); await waitFor(".season-line-card .monitoring-chart-summary");
    assert.equal(await evaluate("document.querySelectorAll('.season-line-card .monitoring-chart-summary-item').length"), 3);
    assert.equal(await evaluate("document.querySelectorAll('.season-line-card .chart-value-label').length"), 0);
    await evaluate("document.querySelector('button.nav-item[aria-label=\"Buka halaman Produksi\"]')?.click()"); await waitFor(".monitoring-chart-production .monitoring-chart-summary");
    assert.equal(await evaluate("document.querySelectorAll('.monitoring-chart-production .monitoring-chart-summary-item').length"), 3);
    assert.equal(await evaluate("document.querySelectorAll('.monitoring-chart-production .chart-value-label').length"), 0);
    assert.equal(await evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1"), false);
    await evaluate("document.querySelector('button.nav-item[aria-label=\"Buka halaman Ketahanan Pangan\"]')?.click()"); await waitFor(".food-security-page");
    const foodPage = await evaluate(`(()=>{const q=s=>document.querySelector(s),body=q('.food-security-page'),meta=q('.monitoring-heading span'),card=q('.monitoring-kpis article'),disclaimer=q('.simulation-disclaimer');return{title:q('.monitoring-heading h1')?.innerText,kpis:body.querySelectorAll('.monitoring-kpis article').length,meta:parseFloat(getComputedStyle(meta).fontSize),card:parseFloat(getComputedStyle(card).fontSize),disclaimer:disclaimer?.innerText,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,bad:/undefined|NaN/.test(body.innerText)}})()`);
    assert.equal(foodPage.title, "KETAHANAN PANGAN"); assert.equal(foodPage.kpis, 6); assert.ok(foodPage.meta >= 12 && !foodPage.overflow && !foodPage.bad); assert.match(foodPage.disclaimer, /bukan IKP resmi/);
    assert.equal(await evaluate("document.querySelectorAll('.food-balance-chart .monitoring-chart').length"), 1);
    assert.equal(await evaluate("document.querySelectorAll('.food-balance-chart .chart-value-label').length"), 0);
    assert.equal(await evaluate("document.querySelectorAll('.food-balance-chart .monitoring-chart-summary-item').length"), 3);
    const foodLayout=await evaluate(`(()=>{const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}},chart=box('.food-balance-chart'),stock=box('.stock-card'),resilience=box('.resilience-card');return{chart,stock,resilience,labels:[...document.querySelectorAll('.food-balance-chart .chart-x-label')].map(node=>node.textContent),overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}})()`);
    const rightStackHeight=foodLayout.stock.height+foodLayout.resilience.height+15;
    foodLayoutMetrics.push({width,height,chartHeight:foodLayout.chart.height,stockHeight:foodLayout.stock.height,resilienceHeight:foodLayout.resilience.height,rightStackHeight,differenceRatio:Math.abs(rightStackHeight-foodLayout.chart.height)/foodLayout.chart.height,overflow:foodLayout.overflow});
    assert.deepEqual(foodLayout.labels,["Apr","Mei","Jun","Jul","Agu","Sep"]);
    assert.ok(foodLayout.chart.height<600&&!foodLayout.overflow,`${width}x${height}: ${JSON.stringify(foodLayout)}`);
    if(width>=1200) {
      assert.ok(foodLayout.chart.right<=foodLayout.stock.x+1&&foodLayout.stock.bottom<=foodLayout.resilience.y+1);
      assert.ok(Math.abs(rightStackHeight-foodLayout.chart.height)/foodLayout.chart.height<=0.15,`${width}x${height}: chart ${foodLayout.chart.height}, stack ${rightStackHeight}`);
    }
    if(width>=768&&width<1200) assert.ok(foodLayout.stock.height!==foodLayout.resilience.height&&foodLayout.stock.bottom<=foodLayout.stock.y+foodLayout.stock.height+1);
    if(width<768) assert.ok(foodLayout.chart.bottom<=foodLayout.stock.y+1&&foodLayout.stock.bottom<=foodLayout.resilience.y+1);
    if ([1440,768,390].includes(width)) {
      const foodTooltipBox=()=>evaluate(`(()=>{const tip=document.querySelector('.food-security-tooltip'),card=document.querySelector('.food-balance-chart').getBoundingClientRect(),summary=document.querySelector('.food-balance-chart .monitoring-chart-summary').getBoundingClientRect();if(!tip)return null;const rect=tip.getBoundingClientRect(),style=getComputedStyle(tip);return{text:tip.innerText,inside:rect.left>=card.left-1&&rect.right<=card.right+1&&rect.top>=card.top-1&&rect.bottom<=card.bottom+1,belowSummary:rect.top>=summary.bottom-1,padding:parseFloat(style.paddingLeft),clientWidth:tip.clientWidth,scrollWidth:tip.scrollWidth,clientHeight:tip.clientHeight,scrollHeight:tip.scrollHeight,clipped:tip.scrollWidth>tip.clientWidth+1||tip.scrollHeight>tip.clientHeight+1}})()`);
      for (const index of [0,1,3]) {
        await evaluate(`document.querySelectorAll('.food-balance-chart .chart-point')[${index}].dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))`); await sleep(25);
        const box=await foodTooltipBox(); assert.ok(box?.inside&&box.belowSummary&&box.padding>=12&&!box.clipped&&box.text.includes('2026'),`${width}x${height} point ${index}: ${JSON.stringify(box)}`);
      }
      await evaluate("document.querySelector('.food-balance-chart .monitoring-chart-stage').dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:document.body}))"); await sleep(20);
      assert.equal(await evaluate("Boolean(document.querySelector('.food-security-tooltip'))"),false);
      await evaluate("(()=>{const point=document.querySelectorAll('.food-balance-chart .chart-point')[0];point.focus();point.dispatchEvent(new FocusEvent('focusin',{bubbles:true}))})()"); await sleep(20);
      const firstFocus=await evaluate("document.querySelector('.food-security-tooltip strong')?.innerText");
      await evaluate("(()=>{const point=document.querySelectorAll('.food-balance-chart .chart-point')[1];point.focus();point.dispatchEvent(new FocusEvent('focusin',{bubbles:true}))})()"); await sleep(20);
      assert.notEqual(await evaluate("document.querySelector('.food-security-tooltip strong')?.innerText"),firstFocus);
      await evaluate("document.querySelector('.food-balance-chart .monitoring-chart-stage').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))"); await sleep(20);
      assert.equal(await evaluate("Boolean(document.querySelector('.food-security-tooltip'))"),false);
      await evaluate("(()=>{const point=document.querySelectorAll('.food-balance-chart .chart-point')[0];point.dispatchEvent(new FocusEvent('focusin',{bubbles:true}));point.dispatchEvent(new FocusEvent('focusout',{bubbles:true,relatedTarget:document.body}));point.blur()})()"); await sleep(20);
      assert.equal(await evaluate("Boolean(document.querySelector('.food-security-tooltip'))"),false);
      await evaluate("document.querySelectorAll('.food-balance-chart .chart-point')[0].dispatchEvent(new MouseEvent('click',{bubbles:true}))"); await sleep(20);
      assert.ok(await foodTooltipBox());
      await evaluate("document.querySelectorAll('.food-balance-chart .chart-point')[0].dispatchEvent(new MouseEvent('click',{bubbles:true}))"); await sleep(20);
      assert.equal(await evaluate("Boolean(document.querySelector('.food-security-tooltip'))"),false);
      await evaluate("document.querySelectorAll('.food-balance-chart .chart-point')[0].dispatchEvent(new MouseEvent('click',{bubbles:true}));document.querySelectorAll('.food-balance-chart .chart-point')[2].dispatchEvent(new MouseEvent('click',{bubbles:true}))"); await sleep(20);
      assert.ok((await evaluate("document.querySelector('.food-security-tooltip strong')?.innerText"))?.includes('2026'));
      await evaluate(`(()=>{const select=[...document.querySelectorAll('.food-security-page select')].find(node=>node.closest('label')?.innerText.startsWith('Musim'));select.value='MT1-2026';select.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(30);
      assert.equal(await evaluate("Boolean(document.querySelector('.food-security-tooltip'))"),false);
      await evaluate("document.querySelectorAll('.food-balance-chart .chart-point')[0].dispatchEvent(new MouseEvent('click',{bubbles:true}))"); await sleep(20);
      await evaluate(`(()=>{const select=[...document.querySelectorAll('.food-security-page select')].find(node=>node.closest('label')?.innerText.startsWith('Distrik'));select.value='93.01.06';select.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(80);
      assert.equal(await evaluate("Boolean(document.querySelector('.food-security-tooltip'))"),false);
      await evaluate("document.querySelectorAll('.food-balance-chart .chart-point')[0].dispatchEvent(new MouseEvent('click',{bubbles:true}))"); await sleep(20);
      assert.match(await evaluate("document.querySelector('.food-security-tooltip')?.innerText"),/Okt 2025/);
    }
    await evaluate(`(()=>{const select=[...document.querySelectorAll('.food-security-page select')].find(node=>node.closest('label')?.innerText.startsWith('Musim'));select.value='MT1-2026';select.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(30);
    assert.ok(await evaluate("document.querySelectorAll('.food-security-page .monitoring-table tbody tr').length > 0"));
    await evaluate(`(()=>{const select=[...document.querySelectorAll('.food-security-page select')].find(node=>node.closest('label')?.innerText.startsWith('Distrik'));select.value='93.01.02';select.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(30);
    assert.equal(await evaluate("document.querySelector('.food-security-page .monitoring-empty')?.innerText"), "Belum dipantau");
    await evaluate(`(()=>{const select=[...document.querySelectorAll('.food-security-page select')].find(node=>node.closest('label')?.innerText.startsWith('Distrik'));select.value='93.01.05';select.dispatchEvent(new Event('change',{bubbles:true}))})()`); await waitFor(".food-security-page .monitoring-table tbody button");
    await evaluate("(()=>{const button=document.querySelector('.food-security-page .monitoring-table tbody button');button.dataset.qaTrigger='food';button.focus();button.click()})()"); await waitFor(".monitoring-modal[role=dialog]");
    await sleep(80);
    assert.equal(await evaluate("getComputedStyle(document.body).overflow"), "hidden");
    assert.equal(await evaluate("document.activeElement===document.querySelector('.monitoring-modal')"), true);
    await evaluate("document.querySelector('.monitoring-modal').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))"); await sleep(30);
    assert.equal(await evaluate("document.activeElement?.dataset.qaTrigger"), "food");
    assert.notEqual(await evaluate("getComputedStyle(document.body).overflow"), "hidden");
    if (width === 1440) {
      const foodUrl = await evaluate("location.href");
      const foodKpi = await evaluate("document.querySelector('.food-security-page .monitoring-kpis strong')?.innerText");
      await send("Page.reload"); await waitFor(".food-security-page"); await sleep(350);
      assert.equal(await evaluate("location.href"), foodUrl);
      assert.equal(await evaluate("document.querySelector('.food-security-page .monitoring-kpis strong')?.innerText"), foodKpi);
      await evaluate(`(()=>{const select=[...document.querySelectorAll('.food-security-page select')].find(node=>node.closest('label')?.innerText.startsWith('Musim'));select.value='MT2-2026';select.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(40);
      assert.match(await evaluate("location.href"), /season=MT2-2026/);
      await evaluate("history.back()"); await sleep(80); assert.match(await evaluate("location.href"), /season=MT1-2026/);
      await evaluate("history.forward()"); await sleep(80); assert.match(await evaluate("location.href"), /season=MT2-2026/);
    }
    await evaluate("document.querySelector('button.nav-item[aria-label=\"Buka halaman Infrastruktur dan Sarana\"]')?.click()"); await waitFor(".infrastructure-page");
    assert.equal(await evaluate("document.querySelectorAll('.infrastructure-page [role=tab]').length"), 2);
    assert.equal(await evaluate("document.querySelectorAll('.infrastructure-page .monitoring-kpis article').length"), 7);
    await evaluate("(()=>{const button=document.querySelector('.infrastructure-page .monitoring-table tbody button');button.dataset.qaTrigger='irrigation';button.focus();button.click()})()"); await waitFor(".monitoring-modal[role=dialog]");
    await sleep(30);
    assert.equal(await evaluate("document.activeElement===document.querySelector('.monitoring-modal')"), true);
    assert.ok(await evaluate("document.querySelector('.monitoring-modal-body').innerText.includes('Toleransi rekonsiliasi')"));
    await evaluate("document.querySelector('.monitoring-modal header button').click()"); await sleep(30);
    assert.equal(await evaluate("document.activeElement?.dataset.qaTrigger"), "irrigation");
    assert.notEqual(await evaluate("getComputedStyle(document.body).overflow"), "hidden");
    await evaluate("document.querySelectorAll('.infrastructure-page [role=tab]')[1].click()"); await waitFor(".infrastructure-page .local-filters");
    assert.equal(await evaluate("document.querySelectorAll('.infrastructure-page .monitoring-kpis article').length"), 7);
    await evaluate(`(()=>{const select=[...document.querySelectorAll('.infrastructure-page .local-filters select')].find(node=>node.closest('label')?.innerText.startsWith('Kategori'));select.value='Pupuk';select.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(30);
    assert.equal(await evaluate("document.querySelectorAll('.infrastructure-page .monitoring-table tbody tr').length"), 1);
    await evaluate("(()=>{const button=document.querySelector('.infrastructure-page .monitoring-table tbody button');button.dataset.qaTrigger='input';button.focus();button.click()})()"); await waitFor(".monitoring-modal[role=dialog]");
    assert.ok(await evaluate("document.querySelector('.monitoring-modal-body').innerText.includes('Pemenuhan = tersedia')"));
    await evaluate("document.querySelector('.monitoring-modal footer button').click()"); await sleep(30);
    assert.equal(await evaluate("document.activeElement?.dataset.qaTrigger"), "input");
    assert.notEqual(await evaluate("getComputedStyle(document.body).overflow"), "hidden");
    await evaluate(`(()=>{const select=[...document.querySelectorAll('.infrastructure-page .local-filters select')].find(node=>node.closest('label')?.innerText.startsWith('Validasi'));select.value='rejected';select.dispatchEvent(new Event('change',{bubbles:true}))})()`);await sleep(30);
    assert.equal(await evaluate("document.querySelector('.infrastructure-page .table-empty')?.innerText"),"Tidak ada data sesuai filter.");
    assert.equal(await evaluate("Boolean(document.querySelector('.infrastructure-page .compact-empty-state'))"),false);
    await evaluate(`(()=>{const select=[...document.querySelectorAll('.infrastructure-page .local-filters select')].find(node=>node.closest('label')?.innerText.startsWith('Validasi'));select.value='all';select.dispatchEvent(new Event('change',{bubbles:true}))})()`);await sleep(30);
    if (width === 1440) {
      const infrastructureUrl = await evaluate("location.href");
      await send("Page.reload"); await waitFor(".infrastructure-page"); await sleep(350);
      assert.equal(await evaluate("location.href"), infrastructureUrl);
      assert.equal(await evaluate("document.querySelector('[role=tab][aria-selected=true]')?.innerText.trim()"), "Irigasi");
      await evaluate("document.querySelector('button.nav-item[aria-label=\"Buka halaman Ketahanan Pangan\"]')?.click()"); await waitFor(".food-security-page");
      await evaluate("history.back()"); await sleep(80); assert.ok(await evaluate("Boolean(document.querySelector('.infrastructure-page'))"));
      await evaluate("history.forward()"); await sleep(80); assert.ok(await evaluate("Boolean(document.querySelector('.food-security-page'))"));
      await evaluate("document.querySelector('button.nav-item[aria-label=\"Buka halaman Infrastruktur dan Sarana\"]')?.click()"); await waitFor(".infrastructure-page");
    }
    assert.equal(await evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1"), false);
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
  await evaluate(`(()=>{const select=document.querySelector('select[aria-label="Musim tanam"]');select.value='MT2-2026';select.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(30);
  assert.equal(await evaluate("document.querySelectorAll('.monitoring-chart-production .monitoring-chart-summary-item').length"), 3);
  assert.equal(await evaluate("document.querySelectorAll('.monitoring-chart-production .chart-value-label').length"), 0);
  const desktop = await evaluate(`(()=>{const q=s=>document.querySelector(s),fs=s=>parseFloat(getComputedStyle(q(s)).fontSize),layout=q('.production-insight-layout');return{legend:fs('.monitoring-chart-production .monitoring-chart-legend'),tooltipTitle:(q('.monitoring-chart-production .chart-point').dispatchEvent(new MouseEvent('mouseover',{bubbles:true})),null),columns:getComputedStyle(layout).gridTemplateColumns,insight:fs('.production-insight-list p'),line:parseFloat(getComputedStyle(q('.production-insight-list p')).lineHeight)/fs('.production-insight-list p'),icon:q('.production-insight-list svg').getBoundingClientRect().width,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,disclaimer:q('.production-insight-disclaimer').innerText}})()`);
  await sleep(25);
  desktop.tooltipTitle = await evaluate("parseFloat(getComputedStyle(document.querySelector('.monitoring-chart-production .monitoring-chart-tooltip>strong')).fontSize)");
  assert.ok(desktop.columns.split(" ").length === 2 && desktop.legend >= 12 && desktop.tooltipTitle >= 13 && desktop.insight >= 13 && desktop.line >= 1.5 && desktop.icon >= 20 && !desktop.overflow);
  assert.equal(desktop.disclaimer, "Insight dihasilkan otomatis berdasarkan aturan data prototipe, bukan menggunakan AI generatif.");
  await evaluate("document.querySelector('button.nav-item[aria-label=\"Buka halaman Musim Tanam\"]')?.click()"); await waitFor(".season-line-card .monitoring-chart-summary");
  assert.equal(await evaluate("document.querySelectorAll('.season-line-card .monitoring-chart-summary-item').length"), 3);
  assert.equal(await evaluate("document.querySelectorAll('.season-line-card .chart-value-label').length"), 0);
  await evaluate("document.querySelector('button.nav-item[aria-label=\"Buka halaman Ketahanan Pangan\"]')?.click()"); await waitFor(".food-security-page");
  const setFoodContext = async (season,district) => { await evaluate(`(()=>{const selects=[...document.querySelectorAll('.food-security-page select')],season=selects.find(node=>node.closest('label')?.innerText.startsWith('Musim')),district=selects.find(node=>node.closest('label')?.innerText.startsWith('Distrik'));season.value=${JSON.stringify(season)};season.dispatchEvent(new Event('change',{bubbles:true}));district.value=${JSON.stringify(district)};district.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(50); };
  for (const district of ["93.01.01","93.01.05","93.01.06","93.01.07","93.01.11","93.01.14"]) {
    await setFoodContext("MT2-2026",district);
    assert.equal(await evaluate("document.querySelectorAll('.food-balance-chart .chart-point').length"),4,`${district} harus memiliki empat titik actual MT II`);
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.food-balance-chart .chart-x-label')].map(node=>node.textContent)"),["Apr","Mei","Jun","Jul","Agu","Sep"]);
  }
  const resilienceValues = () => evaluate(`(()=>{const value=label=>[...document.querySelectorAll('.resilience-card dl>div')].find(node=>node.querySelector('dt')?.childNodes[0]?.textContent===label)?.querySelector('dd')?.innerText;const kpi=label=>[...document.querySelectorAll('.food-security-page .monitoring-kpis article')].find(node=>node.querySelector('span')?.innerText===label)?.querySelector('strong')?.innerText;return{availability:value('Ketersediaan'),production:value('Capaian produksi'),irrigation:value('Kesiapan irigasi'),inputs:value('Pemenuhan sarana'),validation:value('Validasi'),total:kpi('Indikator Resiliensi')}})()`);
  await setFoodContext("MT1-2026","");
  assert.deepEqual(await resilienceValues(),{availability:"100%",production:"99,1%",irrigation:"86,2%",inputs:"92,6%",validation:"83,3%",total:"94,3 %"});
  await setFoodContext("MT2-2026","");
  assert.deepEqual(await resilienceValues(),{availability:"100%",production:"88,5%",irrigation:"87,2%",inputs:"90,5%",validation:"83,3%",total:"91,5 %"});
  await setFoodContext("MT2-2026","93.01.05");
  assert.deepEqual(await resilienceValues(),{availability:"100%",production:"88,3%",irrigation:"91%",inputs:"92,9%",validation:"100%",total:"94,2 %"});
  const foodPoints=await evaluate("document.querySelectorAll('.food-balance-chart .chart-point').length");assert.equal(foodPoints,4);
  for(const index of [0,1,3]){await evaluate(`(()=>{const p=document.querySelectorAll('.food-balance-chart .chart-point')[${index}];p.dispatchEvent(new MouseEvent('mouseover',{bubbles:true}))})()`);await sleep(25);assert.ok(await evaluate("Boolean(document.querySelector('.food-security-tooltip'))"));assert.ok(await evaluate("document.querySelector('.food-security-tooltip strong').innerText.includes('2026')"));await evaluate("document.querySelector('.food-balance-chart .monitoring-chart-stage').dispatchEvent(new MouseEvent('mouseleave',{bubbles:true}))");}
  await evaluate("document.querySelector('button.nav-item[aria-label=\"Buka halaman Produksi\"]')?.click()"); await waitFor(".production-kpis");
  const productionCrossPage=await evaluate(`(()=>{const value=label=>[...document.querySelectorAll('.production-kpis article')].find(node=>node.querySelector('small')?.innerText===label)?.querySelector('strong')?.innerText.replace(/\s+/g,' ').trim();return{gkg:value('Produksi GKG'),rice:value('Estimasi Beras'),achievement:value('Capaian Target')}})()`);
  assert.deepEqual(productionCrossPage,{gkg:"26.553 ton",rice:"16.832 ton",achievement:"88,3 %"});
  await evaluate("document.querySelector('button.nav-item[aria-label=\"Buka halaman Infrastruktur dan Sarana\"]')?.click()"); await waitFor(".infrastructure-page");
  await evaluate("document.querySelector('.infrastructure-page .monitoring-table tbody button').click()"); await waitFor(".monitoring-modal"); await sleep(30);
  const irrigationCrossPage=await evaluate(`(()=>{const text=document.querySelector('.monitoring-modal-body').innerText;return{functional:text.includes('Tingkat fungsional\\n91 %'),water:text.includes('Kecukupan air\\n87 %')}})()`);
  assert.deepEqual(irrigationCrossPage,{functional:true,water:true});
  await evaluate("document.querySelector('.monitoring-modal footer button').click()"); await sleep(30);
  await evaluate(`(()=>{const select=[...document.querySelectorAll('.infrastructure-page select')].find(node=>node.closest('label')?.innerText.startsWith('Distrik'));select.value='93.01.02';select.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(40);
  assert.equal(await evaluate("document.querySelector('.infrastructure-page .compact-empty-state h2')?.innerText"),"Wilayah belum dipantau");
  assert.equal(await evaluate("document.querySelectorAll('.infrastructure-page .monitoring-kpis').length"),0);
  assert.equal(await evaluate("/0\s*(%|ton|km)/.test(document.querySelector('.infrastructure-page .compact-empty-state')?.innerText??'')"),false);
  assert.deepEqual(runtimeErrors, []);
  console.log(`Food layout metrics: ${JSON.stringify(foodLayoutMetrics)}`);
  console.log(`Browser DOM PASS: ${viewports.map(([w,h])=>`${w}x${h}`).join(", ")}`);
} finally {
  try { socket?.close(); } catch {}
  server.kill(); chrome.kill();
  await sleep(150);
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}
