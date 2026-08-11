import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { executeBrowserLifecycle, waitForDevToolsActivePort, waitForHttpReady } from "./browser-harness.mjs";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const chromeCandidates = process.platform === "win32"
  ? ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"]
  : process.platform === "darwin"
    ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
    : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
let serverStdout="",serverStderr="",chromeStderr="";
await executeBrowserLifecycle({
 resolveChromeExecutable:()=>chromeCandidates.find(existsSync),
 spawnServer:({port})=>{const child=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-H","127.0.0.1","-p",String(port)],{cwd:process.cwd(),env:{...process.env,NODE_ENV:"production"},stdio:["ignore","pipe","pipe"],windowsHide:true});child.stdout.on("data",chunk=>{serverStdout+=chunk.toString()});child.stderr.on("data",chunk=>{serverStderr+=chunk.toString()});return child},
 spawnChrome:({chromeExecutable,profilePath})=>{const child=spawn(chromeExecutable,["--headless=new","--remote-debugging-port=0","--remote-allow-origins=*",`--user-data-dir=${profilePath}`,"--disable-gpu","--disable-software-rasterizer","--disable-gpu-compositing","--disable-breakpad","--disable-crash-reporter","--disable-background-networking","--disable-component-update","--disable-sync","--force-prefers-reduced-motion","--no-sandbox","--no-first-run","--no-default-browser-check","about:blank"],{stdio:["ignore","ignore","pipe"],windowsHide:true});child.stderr.on("data",chunk=>{chromeStderr+=chunk.toString()});return child},
 runBrowser:async({port,profileHandle,serverProcess:server,chromeProcess:chrome,getProcessError,registerBrowserClose})=>{
  const origin=`http://127.0.0.1:${port}`,profile=profileHandle.profilePath;
  let socket,closeBrowser;
  await waitForHttpReady({url:origin,isProcessAlive:()=>server.exitCode===null&&!getProcessError(server),timeoutMs:60000,pollMs:150,fetchTimeoutMs:2000,processDetails:()=>({exitCode:server.exitCode,stdout:serverStdout,stderr:serverStderr})});
  assert.equal(getProcessError(server),null,`Next test server gagal start (exit ${server.exitCode}): ${serverStderr.slice(-1000)}`);
  const devtools=await waitForDevToolsActivePort({profileDir:profile,isProcessAlive:()=>chrome.exitCode===null&&!getProcessError(chrome),timeoutMs:15000});
  const devtoolsOrigin=`http://127.0.0.1:${devtools.port}`;
  await waitForHttpReady({url:`${devtoolsOrigin}/json`,isProcessAlive:()=>chrome.exitCode===null&&!getProcessError(chrome),timeoutMs:30000,pollMs:100,fetchTimeoutMs:1500,processDetails:()=>({exitCode:chrome.exitCode,stderr:chromeStderr})});
  const tabs=await fetch(`${devtoolsOrigin}/json`).then(response=>response.json()),pageTab=tabs.find(tab=>tab.type==="page"&&typeof tab.webSocketDebuggerUrl==="string");
  assert.ok(pageTab?.webSocketDebuggerUrl,`Chrome DevTools page endpoint tidak valid. stderr: ${chromeStderr.slice(-1000)}`);
  socket = new WebSocket(pageTab.webSocketDebuggerUrl);
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
  closeBrowser=()=>send("Browser.close");
  registerBrowserClose(async()=>{
    if(closeBrowser)await Promise.race([closeBrowser(),sleep(1000)]);
    if(socket){try{socket.close()}catch(error){console.error(`Gagal menutup CDP: ${error instanceof Error?error.message:String(error)}`)}}
  });
  const evaluate = async expression => {
    const message = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (message.result.exceptionDetails) throw new Error(message.result.exceptionDetails.exception?.description ?? message.result.exceptionDetails.text);
    return message.result.result.value;
  };
  const waitFor = async selector => {
    for (let attempt = 0; attempt < 80; attempt++) { if (await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return; await sleep(75); }
    throw new Error(`Selector tidak ditemukan: ${selector}`);
  };
  const waitUntil = async (expression, message) => {
    for (let attempt = 0; attempt < 80; attempt++) { if (await evaluate(expression)) return; await sleep(25); }
    throw new Error(`Kondisi browser tidak tercapai: ${message}`);
  };
  const verifyPaginationReset = async ({ pageSelector, change, verify, reset, label }) => {
    await waitUntil(`[...document.querySelectorAll('${pageSelector} .table-pagination button')].some(button=>button.textContent==='2')`, `${label}: halaman kedua tersedia`);
    await evaluate(`(()=>{const button=[...document.querySelectorAll('${pageSelector} .table-pagination button')].find(node=>node.textContent==='2');button.click()})()`);
    await waitUntil(`document.querySelector('${pageSelector} .table-pagination [aria-current=page]')?.textContent==='2'`, `${label}: halaman dua aktif`);
    await evaluate(change);
    await waitUntil(`document.querySelector('${pageSelector} .table-pagination [aria-current=page]')?.textContent==='1'`, `${label}: reset halaman satu`);
    await waitUntil(verify, `${label}: isi tabel sesuai context`);
    await evaluate(reset);
    await waitUntil(`[...document.querySelectorAll('${pageSelector} .table-pagination button')].some(button=>button.textContent==='2')`, `${label}: dataset dipulihkan`);
  };
  const selectChange = (pageSelector, label, value) => `(()=>{const select=[...document.querySelectorAll('${pageSelector} select')].find(node=>node.closest('label')?.innerText.startsWith(${JSON.stringify(label)}));select.value=${JSON.stringify(value)};select.dispatchEvent(new Event('change',{bubbles:true}))})()`;
  const inputChange = (pageSelector, value) => `(()=>{const input=document.querySelector('${pageSelector} input'),set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`;
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
    await waitUntil("getComputedStyle(document.body).overflow==='hidden'", "body scroll lock modal Ketahanan Pangan");
    await waitUntil("document.querySelector('.monitoring-modal').contains(document.activeElement)", "fokus masuk modal Ketahanan Pangan");
    await evaluate("document.querySelector('.monitoring-modal').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    await waitUntil("!document.querySelector('.monitoring-modal')", "modal Ketahanan Pangan tertutup");
    await waitUntil("document.activeElement?.dataset.qaTrigger==='food'", "fokus kembali dari modal Ketahanan Pangan");
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
    await evaluate("document.querySelector('button.nav-item[aria-label=\"Buka halaman Risiko dan Iklim\"]')?.click()"); await waitFor(".risk-page");
    assert.equal(await evaluate("document.querySelector('.risk-page h1')?.innerText"),"RISIKO & IKLIM");
    assert.equal(await evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1"),false);
    assert.equal(await evaluate("/undefined|NaN/.test(document.querySelector('.risk-page').innerText)"),false);
    await evaluate(`(()=>{const select=[...document.querySelectorAll('.risk-page select')].find(node=>node.closest('label')?.innerText.startsWith('Distrik'));select.value='';select.dispatchEvent(new Event('change',{bubbles:true}))})()`);await sleep(40);
    assert.ok(await evaluate("document.querySelectorAll('.risk-page tbody tr').length>0"));
    if([1440,768,390].includes(width)){
      await evaluate("document.querySelector('.risk-page tbody button').click()"); await waitFor(".monitoring-modal"); await waitUntil("document.querySelector('.monitoring-modal').contains(document.activeElement)","fokus modal Risiko");
      const riskModal=await evaluate(`(()=>{const dialog=document.querySelector('.monitoring-modal'),body=dialog.querySelector('.monitoring-modal-body'),r=dialog.getBoundingClientRect(),style=getComputedStyle(body),text=body.innerText;return{inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,font:parseFloat(style.fontSize),line:parseFloat(style.lineHeight)/parseFloat(style.fontSize),scroll:body.scrollHeight>=body.clientHeight,metadata:['Status monitoring','Status validasi','Source type','Data type','Updated at','Source reference','Formula skor','Cut-off status','Rekomendasi berbasis aturan'].every(x=>text.includes(x)),locked:getComputedStyle(document.body).overflow==='hidden'}})()`);
      assert.ok(riskModal.inside&&riskModal.font>=12&&riskModal.line>=1.4&&riskModal.metadata&&riskModal.locked);
      await evaluate("document.querySelector('.monitoring-modal footer button').click()"); await waitUntil("!document.querySelector('.monitoring-modal')","modal Risiko tertutup");
    }
    if(width===1440){
      for(const method of['header','escape','overlay']){await evaluate("(()=>{const button=document.querySelector('.risk-page tbody button');button.dataset.qaTrigger='risk';button.focus();button.click()})()");await waitFor(".monitoring-modal");await waitUntil("document.querySelector('.monitoring-modal').contains(document.activeElement)","fokus modal Risiko "+method);if(method==='header')await evaluate("document.querySelector('.monitoring-modal header button').click()");else if(method==='escape')await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");else await evaluate("document.querySelector('.monitoring-modal-overlay').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))");await waitUntil("!document.querySelector('.monitoring-modal')","tutup modal Risiko "+method);await waitUntil("document.activeElement?.dataset.qaTrigger==='risk'","restore fokus Risiko "+method)}
      await verifyPaginationReset({pageSelector:'.risk-page',change:inputChange('.risk-page','Semangga'),verify:"[...document.querySelectorAll('.risk-page tbody tr')].every(row=>row.cells[0].textContent.includes('Semangga'))",reset:inputChange('.risk-page',''),label:'Risiko pencarian'});
      await verifyPaginationReset({pageSelector:'.risk-page',change:selectChange('.risk-page','Jenis risiko','Kekeringan'),verify:"[...document.querySelectorAll('.risk-page tbody tr')].every(row=>row.cells[1].textContent==='Kekeringan')",reset:selectChange('.risk-page','Jenis risiko','all'),label:'Risiko jenis'});
      await verifyPaginationReset({pageSelector:'.risk-page',change:selectChange('.risk-page','Tingkat','Kritis'),verify:"[...document.querySelectorAll('.risk-page tbody tr')].every(row=>row.cells[5].textContent==='Kritis')",reset:selectChange('.risk-page','Tingkat','all'),label:'Risiko tingkat'});
      await verifyPaginationReset({pageSelector:'.risk-page',change:selectChange('.risk-page','Status peringatan','Kritis'),verify:"[...document.querySelectorAll('.risk-page tbody tr')].every(row=>row.cells[6].textContent==='Kritis')",reset:selectChange('.risk-page','Status peringatan','all'),label:'Risiko warning'});
      await verifyPaginationReset({pageSelector:'.risk-page',change:selectChange('.risk-page','Validasi','approved'),verify:"[...document.querySelectorAll('.risk-page tbody tr')].every(row=>row.cells[7].textContent==='approved')",reset:selectChange('.risk-page','Validasi','all'),label:'Risiko validasi'});
      await verifyPaginationReset({pageSelector:'.risk-page',change:"document.querySelector('.risk-page th button').click()",verify:"document.querySelector('.risk-page th')?.getAttribute('aria-sort')!=='none'",reset:"void 0",label:'Risiko sorting'});
      await verifyPaginationReset({pageSelector:'.risk-page',change:selectChange('.risk-page','Musim','MT1-2026'),verify:"[...document.querySelectorAll('.risk-page select')].find(node=>node.closest('label')?.innerText.startsWith('Musim')).value==='MT1-2026'",reset:selectChange('.risk-page','Musim','MT2-2026'),label:'Risiko season'});
      await verifyPaginationReset({pageSelector:'.risk-page',change:selectChange('.risk-page','Distrik','93.01.05'),verify:"[...document.querySelectorAll('.risk-page tbody tr')].every(row=>row.cells[0].textContent.includes('Semangga'))",reset:selectChange('.risk-page','Distrik',''),label:'Risiko district'});
      await evaluate(inputChange('.risk-page','tidak-ada'));await waitUntil("document.querySelector('.risk-page .table-empty')?.textContent==='Tidak ada data sesuai filter.'","filter nol Risiko");assert.equal(await evaluate("Boolean(document.querySelector('.risk-page .table-pagination'))"),false);await evaluate(inputChange('.risk-page',''));await waitFor(".risk-page tbody button");
      await evaluate("document.querySelector('.risk-page tbody button').click()");await waitFor(".monitoring-modal");await evaluate(`(()=>{const select=[...document.querySelectorAll('.risk-page select')].find(node=>node.closest('label')?.innerText.startsWith('Musim'));select.value='MT1-2026';select.dispatchEvent(new Event('change',{bubbles:true}))})()`);await waitUntil("!document.querySelector('.monitoring-modal')","modal Risiko tertutup oleh season");
      await evaluate(`(()=>{const select=[...document.querySelectorAll('.risk-page select')].find(node=>node.closest('label')?.innerText.startsWith('Distrik'));select.value='93.01.02';select.dispatchEvent(new Event('change',{bubbles:true}))})()`);await waitUntil("document.querySelector('.risk-page .compact-empty-state h2')?.textContent==='Wilayah belum dipantau'","empty-state Risiko not monitored");assert.equal(await evaluate("Boolean(document.querySelector('.risk-page .monitoring-kpis,.risk-page table,.risk-page .table-pagination'))"),false);
      await evaluate(`(()=>{const select=[...document.querySelectorAll('.risk-page select')].find(node=>node.closest('label')?.innerText.startsWith('Distrik'));select.value='';select.dispatchEvent(new Event('change',{bubbles:true}))})()`);await waitFor(".risk-page tbody button");
      await evaluate(`(()=>{const select=[...document.querySelectorAll('.risk-page select')].find(node=>node.closest('label')?.innerText.startsWith('Musim'));select.value='MT2-2026';select.dispatchEvent(new Event('change',{bubbles:true}))})()`);await waitUntil("location.search.includes('season=MT2-2026')&&document.querySelector('.risk-page select')?.value==='MT2-2026'","Risiko dipulihkan ke MT II");
    }
    await evaluate(`(()=>{const select=[...document.querySelectorAll('.risk-page select')].find(node=>node.closest('label')?.innerText.startsWith('Musim'));if(select.value!=='MT2-2026'){select.value='MT2-2026';select.dispatchEvent(new Event('change',{bubbles:true}))}})()`);await waitUntil("document.querySelector('.risk-page select')?.value==='MT2-2026'","konteks MT II sebelum Kolaborasi");
    await evaluate("document.querySelector('button.nav-item[aria-label=\"Buka halaman Kolaborasi OPD\"]')?.click()"); await waitFor(".collaboration-page");
    assert.equal(await evaluate("document.querySelector('.collaboration-page h1')?.innerText"),"KOLABORASI OPD & INSTANSI");
    const collaborationNetwork=await evaluate(`(()=>{const canvas=document.querySelector('.network-canvas'),visible=getComputedStyle(canvas).display!=='none',nodes=[...document.querySelectorAll('.network-svg-node')],edges=document.querySelectorAll('.network-edges line').length,mobile=document.querySelectorAll('.network-mobile-list li').length,cr=canvas.getBoundingClientRect(),boxes=nodes.map(node=>{const r=node.getBoundingClientRect(),text=node.querySelector('text').getBBox(),rect=node.querySelector('rect').getBBox();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,labelInside:text.x>=rect.x-1&&text.x+text.width<=rect.x+rect.width+1}});return{visible,nodes:nodes.length,edges,mobile,inside:boxes.every(r=>r.left>=cr.left-1&&r.right<=cr.right+1&&r.top>=cr.top-1&&r.bottom<=cr.bottom+1),labels:boxes.every(r=>r.labelInside),overlap:boxes.some((a,i)=>boxes.some((b,j)=>j>i&&a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1))}})()`);
    if(width<=600)assert.deepEqual([collaborationNetwork.visible,collaborationNetwork.mobile],[false,8],`${width}x${height}`);else assert.deepEqual([collaborationNetwork.visible,collaborationNetwork.nodes,collaborationNetwork.edges,collaborationNetwork.inside,collaborationNetwork.labels,collaborationNetwork.overlap],[true,7,8,true,true,false],`${width}x${height}`);
    assert.equal(await evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1"),false);
    assert.equal(await evaluate("/undefined|NaN/.test(document.querySelector('.collaboration-page').innerText)"),false);
    if([1440,768,390].includes(width)){
      await evaluate("document.querySelector('.collaboration-page tbody button').click()");await waitFor(".monitoring-modal");await waitUntil("document.querySelector('.monitoring-modal').contains(document.activeElement)","fokus modal Kolaborasi");
      const collaborationModal=await evaluate(`(()=>{const dialog=document.querySelector('.monitoring-modal'),body=dialog.querySelector('.monitoring-modal-body'),r=dialog.getBoundingClientRect(),style=getComputedStyle(body),text=body.innerText;return{inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,font:parseFloat(style.fontSize),line:parseFloat(style.lineHeight)/parseFloat(style.fontSize),metadata:['ID kegiatan','Judul kegiatan','Tanggal mulai','Tenggat','Tanggal selesai','Status monitoring','Status resolusi','referensi berhasil diverifikasi'].every(x=>text.includes(x)),locked:getComputedStyle(document.body).overflow==='hidden'}})()`);assert.ok(collaborationModal.inside&&collaborationModal.font>=12&&collaborationModal.line>=1.4&&collaborationModal.metadata&&collaborationModal.locked);
      await evaluate("document.querySelector('.monitoring-modal header button').click()");await waitUntil("!document.querySelector('.monitoring-modal')","modal Kolaborasi tertutup X");
    }
    if(width===1440){
      for(const method of['footer','escape','overlay']){await evaluate("(()=>{const button=document.querySelector('.collaboration-page tbody button');button.dataset.qaTrigger='collaboration';button.focus();button.click()})()");await waitFor(".monitoring-modal");await waitUntil("document.querySelector('.monitoring-modal').contains(document.activeElement)","fokus modal Kolaborasi "+method);if(method==='footer')await evaluate("document.querySelector('.monitoring-modal footer button').click()");else if(method==='escape')await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");else await evaluate("document.querySelector('.monitoring-modal-overlay').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))");await waitUntil("!document.querySelector('.monitoring-modal')","tutup modal Kolaborasi "+method);await waitUntil("document.activeElement?.dataset.qaTrigger==='collaboration'","restore fokus Kolaborasi "+method)}
      await verifyPaginationReset({pageSelector:'.collaboration-page',change:inputChange('.collaboration-page','Koordinasi'),verify:"[...document.querySelectorAll('.collaboration-page tbody tr')].every(row=>row.cells[0].textContent.includes('Koordinasi'))",reset:inputChange('.collaboration-page',''),label:'Kolaborasi pencarian'});
      await verifyPaginationReset({pageSelector:'.collaboration-page',change:selectChange('.collaboration-page','Domain','Risiko & Iklim'),verify:"[...document.querySelectorAll('.collaboration-page tbody tr')].every(row=>row.cells[1].textContent==='Risiko & Iklim')",reset:selectChange('.collaboration-page','Domain','all'),label:'Kolaborasi domain'});
      await verifyPaginationReset({pageSelector:'.collaboration-page',change:selectChange('.collaboration-page','Prioritas','Kritis'),verify:"[...document.querySelectorAll('.collaboration-page tbody tr')].every(row=>row.cells[4].textContent==='Kritis')",reset:selectChange('.collaboration-page','Prioritas','all'),label:'Kolaborasi prioritas'});
      await verifyPaginationReset({pageSelector:'.collaboration-page',change:selectChange('.collaboration-page','Status','Berjalan'),verify:"[...document.querySelectorAll('.collaboration-page tbody tr')].every(row=>row.cells[7].textContent==='Berjalan')",reset:selectChange('.collaboration-page','Status','all'),label:'Kolaborasi status'});
      await verifyPaginationReset({pageSelector:'.collaboration-page',change:selectChange('.collaboration-page','Validasi','approved'),verify:"document.querySelectorAll('.collaboration-page tbody tr').length>0",reset:selectChange('.collaboration-page','Validasi','all'),label:'Kolaborasi validasi'});
      await verifyPaginationReset({pageSelector:'.collaboration-page',change:"document.querySelector('.collaboration-page th button').click()",verify:"document.querySelector('.collaboration-page th')?.getAttribute('aria-sort')!=='none'",reset:"void 0",label:'Kolaborasi sorting'});
      await verifyPaginationReset({pageSelector:'.collaboration-page',change:selectChange('.collaboration-page','Musim','MT1-2026'),verify:"[...document.querySelectorAll('.collaboration-page select')].find(node=>node.closest('label')?.innerText.startsWith('Musim')).value==='MT1-2026'",reset:selectChange('.collaboration-page','Musim','MT2-2026'),label:'Kolaborasi season'});
      await verifyPaginationReset({pageSelector:'.collaboration-page',change:selectChange('.collaboration-page','Distrik','93.01.05'),verify:"[...document.querySelectorAll('.collaboration-page tbody tr')].every(row=>row.cells[2].textContent.includes('Semangga'))",reset:selectChange('.collaboration-page','Distrik',''),label:'Kolaborasi district'});
      await evaluate(inputChange('.collaboration-page','tidak-ada'));await waitUntil("document.querySelector('.collaboration-page .monitoring-table .table-empty')?.textContent==='Tidak ada data sesuai filter.'","filter nol Kolaborasi");assert.equal(await evaluate("document.querySelector('.collaboration-network .table-empty')?.textContent"),"Belum ada hubungan kegiatan pada konteks terpilih.");await evaluate(inputChange('.collaboration-page',''));await waitFor(".collaboration-page tbody button");
      await evaluate("document.querySelector('.collaboration-page tbody button').click()");await waitFor(".monitoring-modal");await evaluate(`(()=>{const select=[...document.querySelectorAll('.collaboration-page select')].find(node=>node.closest('label')?.innerText.startsWith('Distrik'));select.value='93.01.05';select.dispatchEvent(new Event('change',{bubbles:true}))})()`);await waitUntil("!document.querySelector('.monitoring-modal')","modal Kolaborasi tertutup oleh district");
      await waitUntil("document.querySelectorAll('.collaboration-page .network-svg-node').length===3&&document.querySelectorAll('.network-edges line').length===2","network Semangga");
      await evaluate(`(()=>{const select=[...document.querySelectorAll('.collaboration-page select')].find(node=>node.closest('label')?.innerText.startsWith('Distrik'));select.value='93.01.07';select.dispatchEvent(new Event('change',{bubbles:true}))})()`);await waitUntil("document.querySelector('.collaboration-page .compact-empty-state h2')?.textContent==='Belum ada kegiatan kolaborasi'","empty monitored tanpa kegiatan");assert.equal(await evaluate("Boolean(document.querySelector('.collaboration-page .monitoring-kpis,.collaboration-page table,.collaboration-page .collaboration-network'))"),false);
      await evaluate(`(()=>{const select=[...document.querySelectorAll('.collaboration-page select')].find(node=>node.closest('label')?.innerText.startsWith('Distrik'));select.value='93.01.02';select.dispatchEvent(new Event('change',{bubbles:true}))})()`);await waitUntil("document.querySelector('.collaboration-page .compact-empty-state h2')?.textContent==='Wilayah belum dipantau'","empty Kolaborasi not monitored");assert.equal(await evaluate("Boolean(document.querySelector('.collaboration-page .monitoring-kpis,.collaboration-page table,.collaboration-page .collaboration-network,.collaboration-page .table-pagination'))"),false);
      await evaluate(`(()=>{const selects=[...document.querySelectorAll('.collaboration-page select')],district=selects.find(node=>node.closest('label')?.innerText.startsWith('Distrik')),season=selects.find(node=>node.closest('label')?.innerText.startsWith('Musim'));district.value='';district.dispatchEvent(new Event('change',{bubbles:true}));season.value='MT1-2026';season.dispatchEvent(new Event('change',{bubbles:true}))})()`);await waitUntil("document.querySelectorAll('.collaboration-page .network-svg-node').length===5&&document.querySelectorAll('.network-edges line').length===4","network MT I Kabupaten");
      await evaluate(`(()=>{const season=[...document.querySelectorAll('.collaboration-page select')].find(node=>node.closest('label')?.innerText.startsWith('Musim'));season.value='MT2-2026';season.dispatchEvent(new Event('change',{bubbles:true}))})()`);await waitUntil("document.querySelectorAll('.collaboration-page .network-svg-node').length===7","network MT II Kabupaten dipulihkan");
    } else {await evaluate(`(()=>{const select=[...document.querySelectorAll('.collaboration-page select')].find(node=>node.closest('label')?.innerText.startsWith('Distrik'));select.value='93.01.05';select.dispatchEvent(new Event('change',{bubbles:true}))})()`);await sleep(30);}
    assert.equal(await evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1"), false);
  }

  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await evaluate("document.querySelector('button.nav-item[aria-label=\"Buka halaman Risiko dan Iklim\"]')?.click()");await waitFor(".risk-page");
  await evaluate(`(()=>{const selects=[...document.querySelectorAll('.risk-page select')],season=selects.find(node=>node.closest('label')?.innerText.startsWith('Musim')),district=selects.find(node=>node.closest('label')?.innerText.startsWith('Distrik'));season.value='MT1-2026';season.dispatchEvent(new Event('change',{bubbles:true}));district.value='93.01.05';district.dispatchEvent(new Event('change',{bubbles:true}))})()`);await waitUntil("location.search.includes('season=MT1-2026')&&location.search.includes('district=93.01.05')","URL Risiko MT I Semangga");
  await send("Page.reload");await waitFor(".risk-page");await waitUntil("document.querySelector('.risk-page select')?.value==='MT1-2026'&&[...document.querySelectorAll('.risk-page select')].some(x=>x.value==='93.01.05')","refresh Risiko memulihkan context");assert.equal(await evaluate("location.hash"),"#view=risiko-iklim");
  await evaluate(`(()=>{const season=[...document.querySelectorAll('.risk-page select')].find(node=>node.closest('label')?.innerText.startsWith('Musim'));season.value='MT2-2026';season.dispatchEvent(new Event('change',{bubbles:true}))})()`);await waitUntil("location.search.includes('season=MT2-2026')","Risiko MT II");await evaluate("history.back()");await waitUntil("location.search.includes('season=MT1-2026')","Back Risiko MT I");await evaluate("history.forward()");await waitUntil("location.search.includes('season=MT2-2026')","Forward Risiko MT II");
  await evaluate("document.querySelector('button.nav-item[aria-label=\"Buka halaman Kolaborasi OPD\"]')?.click()");await waitFor(".collaboration-page");await send("Page.reload");await waitFor(".collaboration-page");assert.equal(await evaluate("location.hash"),"#view=kolaborasi-opd");assert.ok(await evaluate("location.search.includes('district=93.01.05')"));
  await evaluate(`(()=>{const district=[...document.querySelectorAll('.collaboration-page select')].find(node=>node.closest('label')?.innerText.startsWith('Distrik'));district.value='';district.dispatchEvent(new Event('change',{bubbles:true}))})()`);await waitUntil("!location.search.includes('district=')","Kolaborasi Kabupaten");await evaluate("history.back()");await waitUntil("location.search.includes('district=93.01.05')","Back Kolaborasi Semangga");await evaluate("history.forward()");await waitUntil("!location.search.includes('district=')","Forward Kolaborasi Kabupaten");await evaluate(`(()=>{const district=[...document.querySelectorAll('.collaboration-page select')].find(node=>node.closest('label')?.innerText.startsWith('Distrik'));district.value='93.01.05';district.dispatchEvent(new Event('change',{bubbles:true}))})()`);await waitUntil("location.search.includes('district=93.01.05')","Semangga dipulihkan untuk regresi lintas halaman");
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
 }
});
