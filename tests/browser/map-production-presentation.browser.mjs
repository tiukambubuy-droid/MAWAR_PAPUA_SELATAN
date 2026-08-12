import assert from "node:assert/strict";
import { existsSync,mkdirSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  const screenshotDir=join(tmpdir(),"mawar-task-012-final");
  const capture=async name=>{if(process.env.MAWAR_CAPTURE_TASK012!=="1")return;mkdirSync(screenshotDir,{recursive:true});const shot=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});writeFileSync(join(screenshotDir,`${name}.png`),Buffer.from(shot.result.data,"base64"))};
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
  const pressKey = async (key, modifiers = 0) => {
    const keyCode=key==="Enter"?13:key==="Tab"?9:key==="Escape"?27:key==="PageDown"?34:key==="PageUp"?33:0;
    const code=key;
    await send("Input.dispatchKeyEvent", { type:"keyDown", key, code, text:key==="Enter"?"\r":undefined, unmodifiedText:key==="Enter"?"\r":undefined, modifiers, windowsVirtualKeyCode:keyCode, nativeVirtualKeyCode:keyCode });
    await send("Input.dispatchKeyEvent", { type:"keyUp", key, code, modifiers, windowsVirtualKeyCode:keyCode, nativeVirtualKeyCode:keyCode });
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
  const navigationLayoutMetrics = [];
  for (const [width, height] of viewports) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 430 });
    await send("Page.navigate", { url: "about:blank" });
    await send("Storage.clearDataForOrigin", { origin, storageTypes: "local_storage,session_storage" });
    await send("Page.navigate", { url: `${origin}/?season=MT2-2026` }); await waitFor(".executive-big-layer [data-region-id='93.01.05']");
    const navigationMetrics=await evaluate(`(()=>{const sidebar=document.querySelector('.sidebar'),nav=sidebar.querySelector('nav'),brand=sidebar.querySelector('.brand-mark'),workspace=document.querySelector('.workspace'),items=[...nav.querySelectorAll('.nav-item')],sr=sidebar.getBoundingClientRect(),nr=nav.getBoundingClientRect(),br=brand.getBoundingClientRect(),wr=workspace.getBoundingClientRect(),style=getComputedStyle(sidebar),navStyle=getComputedStyle(nav),insideX=(r,p)=>r.left>=p.left-1&&r.right<=p.right+1;return{position:style.position,sidebarTop:sr.top,sidebarBottom:sr.bottom,sidebarHeight:sr.height,sidebarWidth:sr.width,workspaceLeft:wr.left,navOverflowY:navStyle.overflowY,scrollbarWidth:navStyle.scrollbarWidth,navScrollHeight:nav.scrollHeight,navClientHeight:nav.clientHeight,menuCount:items.length,active:nav.querySelectorAll('[aria-current=page]').length,controls:document.querySelectorAll('.navigation-trigger,.navigation-close,.navigation-overlay').length,clipped:items.some(item=>item.scrollWidth>item.clientWidth+1),contained:insideX(br,sr)&&insideX(nr,sr)&&items.every(item=>insideX(item.getBoundingClientRect(),sr)),iconDistorted:items.some(item=>{const svg=item.querySelector('svg')?.getBoundingClientRect();return svg&&Math.abs(svg.width-svg.height)>1}),offsetOk:Math.abs(wr.left-sr.width)<=1,pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}})()`);
    assert.equal(navigationMetrics.position,"fixed",`${width}x${height}: sidebar fixed`);
    assert.equal(navigationMetrics.navOverflowY,"auto",`${width}x${height}: nav menyediakan scroll internal`);
    assert.equal(navigationMetrics.scrollbarWidth,"none",`${width}x${height}: scrollbar visual tersembunyi`);
    assert.equal(navigationMetrics.menuCount,9);assert.equal(navigationMetrics.active,1);
    assert.equal(navigationMetrics.controls,0,`${width}x${height}: tidak ada kontrol drawer`);
    assert.ok(navigationMetrics.contained&&!navigationMetrics.iconDistorted&&navigationMetrics.offsetOk&&!navigationMetrics.pageOverflow,`${width}x${height}: ${JSON.stringify(navigationMetrics)}`);
    assert.ok(Math.abs(navigationMetrics.sidebarTop)<=1&&Math.abs(navigationMetrics.sidebarBottom-height)<=1&&Math.abs(navigationMetrics.sidebarHeight-height)<=1,`${width}x${height}: sidebar memenuhi viewport ${JSON.stringify(navigationMetrics)}`);
    if(width<=900){
      await evaluate("document.querySelectorAll('.sidebar .nav-item')[0].focus()");await pressKey("Tab");
      const tooltipPoint=await evaluate("(()=>{const r=document.activeElement.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()");
      await send("Input.dispatchMouseEvent",{type:"mouseMoved",x:tooltipPoint.x,y:tooltipPoint.y});
      await sleep(25);
      const compactName=await evaluate("(()=>{const item=document.activeElement,pseudo=getComputedStyle(item,'::after');return{name:item.getAttribute('aria-label'),content:pseudo.content,visible:pseudo.visibility==='visible'&&Number(pseudo.opacity)>0}})()");
      assert.ok(compactName.name==="Buka halaman Peta Lahan"&&compactName.content.includes("Buka halaman Peta Lahan"),`${width}x${height}: tooltip/accessibility rail ${JSON.stringify(compactName)}`);
    }
    navigationLayoutMetrics.push({width,height,sidebarWidth:navigationMetrics.sidebarWidth,navScrollHeight:navigationMetrics.navScrollHeight,navClientHeight:navigationMetrics.navClientHeight,overflowY:navigationMetrics.navOverflowY});
    if(width===1440)await capture("sidebar-012a-final-1440x900");
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
    if(width===1440){
      const monitoredDistricts=[["93.01.01","Merauke"],["93.01.05","Semangga"],["93.01.06","Tanah Miring"],["93.01.07","Jagebob"],["93.01.11","Kurik"],["93.01.14","Malind"]];
      const unmonitoredDistricts=[["93.01.13","Animha"],["93.01.10","Elikobal"],["93.01.02","Muting"]];
      const setSeasonContext=async(season,district="")=>{
        await evaluate(`(()=>{const seasonNode=document.querySelector('select[aria-label="Musim Tanam"]'),districtNode=document.querySelector('select[aria-label="Distrik"]');seasonNode.value=${JSON.stringify(season)};seasonNode.dispatchEvent(new Event('change',{bubbles:true}));districtNode.value=${JSON.stringify(district)};districtNode.dispatchEvent(new Event('change',{bubbles:true}))})()`);
        const expectedDistrict=district?`location.search.includes('district=${district}')`:"!location.search.includes('district=')";
        await waitUntil(`location.search.includes('season=${season}')&&${expectedDistrict}&&document.querySelector('select[aria-label="Musim Tanam"]')?.value==='${season}'&&document.querySelector('select[aria-label="Distrik"]')?.value==='${district}'`,`Musim Tanam ${season} ${district||"Kabupaten"} aktif`);
      };
      const activeFarmer=()=>evaluate(`(()=>{const card=[...document.querySelectorAll('.season-kpi-item')].find(node=>node.querySelector('span')?.textContent==='Petani Aktif');return{value:card?.querySelector('strong')?.textContent,note:card?.querySelector('small')?.textContent,notice:document.querySelector('.season-monitoring-note')?.textContent,bad:/97,2%|90,5%|undefined|NaN/.test(document.querySelector('.season-command')?.innerText??'')}})()`);
      for(const [season,farmerValue,farmerNote] of [["MT1-2026","2.341","89,8% dari target"],["MT2-2026","2.545","83,5% dari target"]]){
        await setSeasonContext(season);
        assert.deepEqual(await activeFarmer(),{value:farmerValue,note:farmerNote,notice:"16 distrik lainnya belum dipantau pada data prototipe.",bad:false},`${season}: petani Kabupaten`);
        const firstPage=await evaluate(`(()=>{const rows=[...document.querySelectorAll('.season-table-card tbody tr')],names=rows.map(row=>row.querySelector('.season-row-link')?.textContent);return{names,active:document.querySelector('.season-table-footer [aria-current=page]')?.textContent,previous:document.querySelector('.season-table-footer [aria-label="Halaman sebelumnya"]')?.disabled,next:document.querySelector('.season-table-footer [aria-label="Halaman berikutnya"]')?.disabled}})()`);
        assert.equal(firstPage.names.length,5,`${season}: halaman pertama lima row`);assert.equal(firstPage.active,"1");assert.equal(firstPage.previous,true);assert.equal(firstPage.next,false);
        await evaluate(`document.querySelector('.season-table-footer [aria-label="Halaman berikutnya"]').click()`);await waitUntil("document.querySelector('.season-table-footer [aria-current=page]')?.textContent==='2'",`${season}: halaman dua`);
        const secondPage=await evaluate(`(()=>{const names=[...document.querySelectorAll('.season-table-card tbody tr')].map(row=>row.querySelector('.season-row-link')?.textContent);return{names,previous:document.querySelector('.season-table-footer [aria-label="Halaman sebelumnya"]')?.disabled,next:document.querySelector('.season-table-footer [aria-label="Halaman berikutnya"]')?.disabled}})()`);
        assert.equal(secondPage.names.length,1,`${season}: halaman kedua satu row`);assert.equal(new Set([...firstPage.names,...secondPage.names]).size,6,`${season}: enam distrik unik`);assert.equal(secondPage.previous,false);assert.equal(secondPage.next,true);
        await evaluate("document.querySelector('.season-table-card th:nth-child(1) button').click()");await waitUntil("document.querySelector('.season-table-footer [aria-current=page]')?.textContent==='1'&&document.querySelector('.season-table-card th:nth-child(1)').getAttribute('aria-sort')==='descending'",`${season}: sort nama descending dan reset halaman`);
        const descending=await evaluate("[...document.querySelectorAll('.season-row-link')].map(node=>node.textContent)");
        await evaluate("document.querySelector('.season-table-card th:nth-child(1) button').click()");await waitUntil("document.querySelector('.season-table-card th:nth-child(1)').getAttribute('aria-sort')==='ascending'",`${season}: sort nama ascending`);
        const ascending=await evaluate("[...document.querySelectorAll('.season-row-link')].map(node=>node.textContent)");
        assert.notDeepEqual(descending,ascending,`${season}: arah sort teks berubah`);
        await evaluate("document.querySelector('.season-table-card th:nth-child(4) button').click()");await waitUntil("document.querySelector('.season-table-card th:nth-child(4)').getAttribute('aria-sort')==='ascending'",`${season}: sort capaian ascending`);
        const numericAscending=await evaluate("[...document.querySelectorAll('.season-table-card tbody tr td:nth-child(4) b')].map(node=>parseFloat(node.textContent))");
        await evaluate("document.querySelector('.season-table-card th:nth-child(4) button').click()");await waitUntil("document.querySelector('.season-table-card th:nth-child(4)').getAttribute('aria-sort')==='descending'",`${season}: sort capaian descending`);
        const numericDescending=await evaluate("[...document.querySelectorAll('.season-table-card tbody tr td:nth-child(4) b')].map(node=>parseFloat(node.textContent))");
        assert.ok(numericAscending.every((value,index)=>index===0||numericAscending[index-1]<=value),`${season}: numerik ascending`);assert.ok(numericDescending.every((value,index)=>index===0||numericDescending[index-1]>=value),`${season}: numerik descending`);
        const triggerSelector=".season-table-card .season-eye";
        const modalDistrict=await evaluate(`document.querySelector('${triggerSelector}').closest('tr').querySelector('.season-row-link').textContent`);
        await evaluate(`document.querySelector('${triggerSelector}').focus();document.querySelector('${triggerSelector}').click()`);await waitFor(".detail-modal");
        await waitUntil("document.querySelector('.detail-modal').contains(document.activeElement)&&document.body.style.overflow==='hidden'",`${season}: fokus dan scroll lock modal`);
        const modalContext=await evaluate("(()=>{const modal=document.querySelector('.detail-modal');return{title:modal.querySelector('h2')?.textContent,meta:modal.querySelector('header small')?.textContent}})()");
        assert.equal(modalContext.title,modalDistrict,`${season}: judul modal mengikuti distrik`);assert.ok(modalContext.meta.includes(season==="MT1-2026"?"31 Maret 2026":"24 Juli 2026"),`${season}: modal mengikuti musim aktif`);
        await pressKey("Escape");await waitUntil("!document.querySelector('.detail-modal')&&document.activeElement?.classList.contains('season-eye')&&document.body.style.overflow===''",`${season}: Escape dan focus restoration`);
        await evaluate(`document.querySelector('${triggerSelector}').click()`);await waitFor(".detail-modal");await evaluate("document.querySelector('.detail-modal header button').click()");await waitUntil("!document.querySelector('.detail-modal')",`${season}: tombol X modal`);
        await evaluate(`document.querySelector('${triggerSelector}').click()`);await waitFor(".detail-modal");await evaluate("document.querySelector('.detail-modal-backdrop').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))");await waitUntil("!document.querySelector('.detail-modal')",`${season}: overlay modal`);
      }
      for(const season of ["MT1-2026","MT2-2026"])for(const [district,name] of monitoredDistricts){
        await setSeasonContext(season,district);
        const monitored=await evaluate(`(()=>{const body=document.querySelector('.season-command')?.innerText??'',phase=document.querySelector('.phase-insight strong')?.textContent;return{heading:body.includes('DISTRIK ${name.toUpperCase()}'),farmer:document.querySelector('.season-kpi-item-8 strong')?.textContent,groups:body.includes('Kelompok tani belum tersedia'),farmers:body.includes('Petani belum tersedia'),phase,bad:/1 petani|1 kelompok|undefined|NaN|89,8% dari target|83,5% dari target/.test(body)}})()`);
        assert.ok(monitored.heading&&monitored.farmer==="Belum tersedia"&&monitored.groups&&monitored.farmers&&monitored.phase&&!monitored.bad,`${season} ${name}: ${JSON.stringify(monitored)}`);
      }
      for(const season of ["MT1-2026","MT2-2026"])for(const [district,name] of unmonitoredDistricts){
        await setSeasonContext(season,district);
        const unavailable=await evaluate("(()=>{const body=document.querySelector('.season-command')?.innerText??'';return{body,detailButtons:document.querySelectorAll('.season-eye').length,modal:Boolean(document.querySelector('.detail-modal')),synthetic:/Vegetatif|1 petani|1 kelompok|0 ha|0%/.test(body)}})()");
        assert.ok(unavailable.body.includes("Belum dipantau")&&!unavailable.body.includes("Belum tersedia")&&!unavailable.synthetic&&unavailable.detailButtons===0&&!unavailable.modal,`${season} ${name}: not monitored bersih`);
      }
      await setSeasonContext("MT1-2026");
      await setSeasonContext("MT2-2026","93.01.05");
      await send("Page.reload");await waitFor(".season-command");await waitUntil(`location.hash==='#view=musim-tanam'&&location.search.includes('season=MT2-2026')&&location.search.includes('district=93.01.05')&&document.querySelector('select[aria-label="Distrik"]')?.value==='93.01.05'`, "refresh Semangga MT II");
      await send("Page.navigate",{url:`${origin}/?season=MT1-2026&district=93.01.14#view=musim-tanam`});await waitFor(".season-command");await waitUntil(`document.querySelector('select[aria-label="Musim Tanam"]')?.value==='MT1-2026'&&document.querySelector('select[aria-label="Distrik"]')?.value==='93.01.14'`, "Malind MT I");
      await evaluate("history.back()");await waitUntil("location.search.includes('season=MT2-2026')&&location.search.includes('district=93.01.05')", "Back Semangga MT II");await evaluate("history.forward()");await waitUntil("location.search.includes('season=MT1-2026')&&location.search.includes('district=93.01.14')", "Forward Malind MT I");
      assert.equal(await evaluate("document.querySelector('.nav-item[aria-current=page]')?.textContent.trim()"),"Musim Tanam");
      await setSeasonContext("MT2-2026");
    }
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
      await evaluate(`(()=>{const selects=[...document.querySelectorAll('.food-security-page select')],season=selects.find(node=>node.closest('label')?.innerText.startsWith('Musim')),district=selects.find(node=>node.closest('label')?.innerText.startsWith('Distrik'));season.value='MT1-2026';season.dispatchEvent(new Event('change',{bubbles:true}));district.value='';district.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(40);
      await evaluate("(()=>{const button=document.querySelector('.stock-card button');button.dataset.qaTrigger='county-detail';button.focus();button.click()})()"); await waitFor(".monitoring-modal");
      let countyDetail = await evaluate("document.querySelector('.monitoring-modal').innerText");
      assert.match(countyDetail,/Detail Kabupaten Merauke/); assert.match(countyDetail,/MT I 2026/); assert.match(countyDetail,/Cakupan Kabupaten/); assert.match(countyDetail,/Arus pasokan bersih\n387 ton/);
      assert.equal(await evaluate("document.querySelector('.monitoring-modal-body').scrollWidth > document.querySelector('.monitoring-modal-body').clientWidth + 1"),false);
      await evaluate("document.querySelector('.monitoring-modal').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))"); await waitUntil("!document.querySelector('.monitoring-modal')", "modal Kabupaten MT I tertutup"); await waitUntil("document.activeElement?.dataset.qaTrigger==='county-detail'", "fokus kembali ke pemicu Kabupaten");
      await evaluate(`(()=>{const season=[...document.querySelectorAll('.food-security-page select')].find(node=>node.closest('label')?.innerText.startsWith('Musim'));season.value='MT2-2026';season.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(30);
      await evaluate("document.querySelector('.stock-card button').click()"); await waitFor(".monitoring-modal"); countyDetail=await evaluate("document.querySelector('.monitoring-modal').innerText");
      for(const value of ["MT II 2026","Cakupan Kabupaten","Pasokan masuk\n2.860 ton","Pasokan keluar\n2.180 ton","Susut operasional\n141 ton","Arus pasokan bersih\n539 ton"]) assert.ok(countyDetail.includes(value),`${width}: ${value}`);
      await evaluate("document.querySelector('.monitoring-modal header button').click()"); await waitUntil("!document.querySelector('.monitoring-modal')", "modal Kabupaten MT II tertutup");
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
    await evaluate(`(()=>{const select=[...document.querySelectorAll('.food-security-page select')].find(node=>node.closest('label')?.innerText.startsWith('Musim'));select.value='MT2-2026';select.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(30);
    await evaluate("(()=>{const button=document.querySelector('.food-security-page .monitoring-table tbody button');button.dataset.qaTrigger='food';button.focus();button.click()})()"); await waitFor(".monitoring-modal[role=dialog]");
    await waitUntil("getComputedStyle(document.body).overflow==='hidden'", "body scroll lock modal Ketahanan Pangan");
    await waitUntil("document.querySelector('.monitoring-modal').contains(document.activeElement)", "fokus masuk modal Ketahanan Pangan");
    const foodDetailText = await evaluate("document.querySelector('.monitoring-modal-body').innerText");
    for (const text of ["Stok Bulog", "Cadangan pemerintah", "Gudang lokal", "Produksi GKG", "Pasokan masuk", "Pasokan keluar", "Susut operasional", "Total ketersediaan", "Kebutuhan periode", "Surplus/Defisit", "Cut-off", "Status monitoring", "Status validasi", "Jenis sumber", "Jenis data", "Simulasi Prototipe"]) assert.ok(foodDetailText.includes(text), `detail pangan memuat ${text}`);
    assert.match(foodDetailText, /Ketersediaan = stok fisik \+ estimasi beras \+ pasokan masuk/);
    assert.match(foodDetailText, /Surplus\/defisit = ketersediaan/);
    assert.match(await evaluate("document.querySelector('.monitoring-modal').innerText"),/Detail Semangga[\s\S]*Cakupan Distrik/);
    for(const value of ["Produksi GKG\n26.553 ton","Pasokan masuk\n410 ton","Pasokan keluar\n315 ton","Susut operasional\n21 ton","Arus pasokan bersih\n74 ton"]) assert.ok((await evaluate("document.querySelector('.monitoring-modal').innerText")).includes(value));
    await evaluate("document.querySelector('.monitoring-modal-backdrop').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))");
    await waitUntil("!document.querySelector('.monitoring-modal')", "modal Ketahanan Pangan tertutup");
    await waitUntil("document.activeElement?.dataset.qaTrigger==='food'", "fokus kembali dari modal Ketahanan Pangan");
    assert.notEqual(await evaluate("getComputedStyle(document.body).overflow"), "hidden");
    if (width === 1440) {
      const foodUrl = await evaluate("location.href");
      const foodKpi = await evaluate("document.querySelector('.food-security-page .monitoring-kpis strong')?.innerText");
      await send("Page.reload"); await waitFor(".food-security-page"); await sleep(350);
      assert.equal(await evaluate("location.href"), foodUrl);
      assert.equal(await evaluate("document.querySelector('.food-security-page .monitoring-kpis strong')?.innerText"), foodKpi);
      await evaluate(`(()=>{const select=[...document.querySelectorAll('.food-security-page select')].find(node=>node.closest('label')?.innerText.startsWith('Musim'));select.value='MT1-2026';select.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(40);
      assert.match(await evaluate("location.href"), /season=MT1-2026/);
      await evaluate("history.back()"); await sleep(80); assert.match(await evaluate("location.href"), /season=MT2-2026/);
      await evaluate("history.forward()"); await sleep(80); assert.match(await evaluate("location.href"), /season=MT1-2026/);
      await evaluate(`(()=>{const select=[...document.querySelectorAll('.food-security-page select')].find(node=>node.closest('label')?.innerText.startsWith('Musim'));select.value='MT2-2026';select.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(40);
    }
    await evaluate("document.querySelector('button.nav-item[aria-label=\"Buka halaman Infrastruktur dan Sarana\"]')?.click()"); await waitFor(".infrastructure-page");
    assert.equal(await evaluate("document.querySelectorAll('.infrastructure-page [role=tab]').length"), 2);
    assert.equal(await evaluate("document.querySelectorAll('.infrastructure-page .monitoring-kpis article').length"), 7);
    await evaluate("(()=>{const button=document.querySelector('.infrastructure-page .monitoring-table tbody button');button.dataset.qaTrigger='irrigation';button.focus();button.click()})()"); await waitFor(".monitoring-modal[role=dialog]");
    await waitUntil("document.activeElement===document.querySelector('.monitoring-modal')","fokus modal Infrastruktur");
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
    const riskPresentation=await evaluate(`(()=>{const input=document.querySelector('.risk-page .monitoring-search'),cards=[...document.querySelectorAll('.risk-page .monitoring-kpis article')],table=document.querySelector('.risk-page .table-scroll'),th=document.querySelector('.risk-page th'),td=document.querySelector('.risk-page td'),composition=document.querySelectorAll('.risk-composition>span');return{inputHeight:input.getBoundingClientRect().height,inputPadding:parseFloat(getComputedStyle(input).paddingLeft),kpiOverlap:cards.some(card=>{const a=card.querySelector('span').getBoundingClientRect(),b=card.querySelector('strong').getBoundingClientRect();return a.bottom>b.top+1}),kpiInside:cards.every(card=>{const r=card.getBoundingClientRect(),v=card.querySelector('strong').getBoundingClientRect();return v.left>=r.left&&v.right<=r.right+1&&v.bottom<=r.bottom+1}),composition:composition.length,headerFont:parseFloat(getComputedStyle(th).fontSize),bodyFont:parseFloat(getComputedStyle(td).fontSize),localScroll:getComputedStyle(table).overflowX!=='visible'}})()`);
    assert.ok(riskPresentation.inputHeight>=40&&riskPresentation.inputPadding>=12&&!riskPresentation.kpiOverlap&&riskPresentation.kpiInside&&riskPresentation.composition===4&&riskPresentation.headerFont>=13&&riskPresentation.bodyFont>=13&&riskPresentation.localScroll,`${width}x${height}: ${JSON.stringify(riskPresentation)}`);
    if(width===1440||width===390){await evaluate("scrollTo(0,0)");await capture(`risiko-${width}x${height}`)}
    await evaluate(`(()=>{const select=[...document.querySelectorAll('.risk-page select')].find(node=>node.closest('label')?.innerText.startsWith('Distrik'));select.value='';select.dispatchEvent(new Event('change',{bubbles:true}))})()`);await sleep(40);
    assert.ok(await evaluate("document.querySelectorAll('.risk-page tbody tr').length>0"));
    if([1440,768,430,390].includes(width)){
      await evaluate("(()=>{const button=document.querySelector('.risk-page tbody button');button.dataset.qaModalTrigger='risk';button.focus();button.click()})()"); await waitFor(".monitoring-modal"); await waitUntil("document.querySelector('.monitoring-modal').contains(document.activeElement)","fokus modal Risiko");
      const riskModal=await evaluate(`(()=>{const dialog=document.querySelector('.monitoring-modal'),body=dialog.querySelector('.monitoring-modal-body'),r=dialog.getBoundingClientRect(),style=getComputedStyle(body),text=body.innerText;return{inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,font:parseFloat(style.fontSize),line:parseFloat(style.lineHeight)/parseFloat(style.fontSize),scroll:body.scrollHeight>=body.clientHeight,metadata:['Status monitoring','Status validasi','Tipe sumber','Tipe data','Diperbarui','Referensi','Formula skor','Cut-off','Rekomendasi berbasis aturan'].every(x=>text.includes(x)),locked:getComputedStyle(document.body).overflow==='hidden'}})()`);
      assert.ok(riskModal.inside&&riskModal.font>=12&&riskModal.line>=1.4&&riskModal.metadata&&riskModal.locked);
      if([1440,430,390].includes(width)){
        const stacking=await evaluate(`(()=>{const overlay=document.querySelector('.monitoring-modal-overlay'),dialog=document.querySelector('.monitoring-modal'),sidebar=document.querySelector('.sidebar'),or=overlay.getBoundingClientRect(),sr=sidebar.getBoundingClientRect(),vw=document.documentElement.clientWidth,vh=document.documentElement.clientHeight,point=document.elementFromPoint(Math.max(0,Math.min(vw-1,sr.left+sr.width/2)),Math.max(0,Math.min(vh-1,sr.top+40)));return{overlayZ:Number(getComputedStyle(overlay).zIndex),sidebarZ:Number(getComputedStyle(sidebar).zIndex),dialogVisible:dialog.getBoundingClientRect().width>0&&dialog.getBoundingClientRect().height>0,modalFocused:dialog.contains(document.activeElement),sidebarCovered:point===overlay||overlay.contains(point),overlayInside:or.left<=0&&or.top<=0&&or.right>=vw&&or.bottom>=vh}})()`);
        assert.ok(stacking.dialogVisible&&stacking.modalFocused&&stacking.sidebarCovered&&stacking.overlayInside&&stacking.overlayZ>stacking.sidebarZ,`${width}x${height}: modal stacking ${JSON.stringify(stacking)}`);
      }
      if(width===1440)await capture("modal-risiko-1440x900");
      await evaluate("document.querySelector('.monitoring-modal footer button').click()"); await waitUntil("!document.querySelector('.monitoring-modal')","modal Risiko tertutup");await waitUntil("document.activeElement?.dataset.qaModalTrigger==='risk'","fokus modal kembali");assert.equal(await evaluate("document.body.style.overflow"),"");
      assert.equal(await evaluate("document.querySelectorAll('.navigation-trigger,.navigation-close,.navigation-overlay').length"),0);
    }
    if(width===1440){
      assert.ok(await evaluate("[...document.querySelectorAll('.risk-page label')].find(node=>node.innerText.startsWith('Jenis risiko')).innerText.includes('Gangguan produksi')"));
      await evaluate(selectChange('.risk-page','Jenis risiko','Gangguan produksi'));await waitUntil("document.querySelectorAll('.risk-page tbody tr').length===1&&document.querySelector('.risk-page tbody tr').cells[1].textContent==='Gangguan produksi'","filter Gangguan produksi");
      await evaluate(selectChange('.risk-page','Jenis risiko','all'));await waitUntil("document.querySelectorAll('.risk-page tbody tr').length>1","reset Gangguan produksi");
      assert.equal(await evaluate("[...document.querySelectorAll('.risk-page .monitoring-kpis article')].find(node=>node.querySelector('span')?.innerText==='Luas terdampak early warning')?.querySelector('strong').innerText"),"2.345 ha");
      assert.ok(await evaluate("document.querySelector('.risk-page .monitoring-definition').innerText.includes('bukan seluruh luas tanam')"));
      for(const method of['header','escape','overlay']){await evaluate("(()=>{const button=document.querySelector('.risk-page tbody button');button.dataset.qaTrigger='risk';button.focus();button.click()})()");await waitFor(".monitoring-modal");await waitUntil("document.querySelector('.monitoring-modal').contains(document.activeElement)","fokus modal Risiko "+method);if(method==='header')await evaluate("document.querySelector('.monitoring-modal header button').click()");else if(method==='escape')await evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");else await evaluate("document.querySelector('.monitoring-modal-overlay').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))");await waitUntil("!document.querySelector('.monitoring-modal')","tutup modal Risiko "+method);await waitUntil("document.activeElement?.dataset.qaTrigger==='risk'","restore fokus Risiko "+method)}
      await verifyPaginationReset({pageSelector:'.risk-page',change:inputChange('.risk-page','Semangga'),verify:"[...document.querySelectorAll('.risk-page tbody tr')].every(row=>row.cells[0].textContent.includes('Semangga'))",reset:inputChange('.risk-page',''),label:'Risiko pencarian'});
      await verifyPaginationReset({pageSelector:'.risk-page',change:selectChange('.risk-page','Jenis risiko','Kekeringan'),verify:"[...document.querySelectorAll('.risk-page tbody tr')].every(row=>row.cells[1].textContent==='Kekeringan')",reset:selectChange('.risk-page','Jenis risiko','all'),label:'Risiko jenis'});
      await verifyPaginationReset({pageSelector:'.risk-page',change:selectChange('.risk-page','Tingkat','Kritis'),verify:"[...document.querySelectorAll('.risk-page tbody tr')].every(row=>row.cells[5].textContent==='Kritis')",reset:selectChange('.risk-page','Tingkat','all'),label:'Risiko tingkat'});
      await verifyPaginationReset({pageSelector:'.risk-page',change:selectChange('.risk-page','Status peringatan','Kritis'),verify:"[...document.querySelectorAll('.risk-page tbody tr')].every(row=>row.cells[6].textContent==='Kritis')",reset:selectChange('.risk-page','Status peringatan','all'),label:'Risiko warning'});
      await verifyPaginationReset({pageSelector:'.risk-page',change:selectChange('.risk-page','Validasi','approved'),verify:"[...document.querySelectorAll('.risk-page tbody tr')].every(row=>row.cells[7].textContent==='Disetujui')",reset:selectChange('.risk-page','Validasi','all'),label:'Risiko validasi'});
      await verifyPaginationReset({pageSelector:'.risk-page',change:"document.querySelector('.risk-page th button').click()",verify:"document.querySelector('.risk-page th')?.getAttribute('aria-sort')!=='none'",reset:"void 0",label:'Risiko sorting'});
      await verifyPaginationReset({pageSelector:'.risk-page',change:selectChange('.risk-page','Musim','MT1-2026'),verify:"[...document.querySelectorAll('.risk-page select')].find(node=>node.closest('label')?.innerText.startsWith('Musim')).value==='MT1-2026'",reset:selectChange('.risk-page','Musim','MT2-2026'),label:'Risiko season'});
      await verifyPaginationReset({pageSelector:'.risk-page',change:selectChange('.risk-page','Distrik','93.01.05'),verify:"[...document.querySelectorAll('.risk-page tbody tr')].every(row=>row.cells[0].textContent.includes('Semangga'))",reset:selectChange('.risk-page','Distrik',''),label:'Risiko district'});
      await evaluate(inputChange('.risk-page','tidak-ada'));await waitUntil("document.querySelector('.risk-page .table-empty')?.textContent==='Tidak ada data sesuai filter.'","filter nol Risiko");assert.equal(await evaluate("Boolean(document.querySelector('.risk-page .table-pagination'))"),false);await evaluate(inputChange('.risk-page',''));await waitFor(".risk-page tbody button");
      await evaluate("document.querySelector('.risk-page tbody button').click()");await waitFor(".monitoring-modal");await evaluate(`(()=>{const select=[...document.querySelectorAll('.risk-page select')].find(node=>node.closest('label')?.innerText.startsWith('Musim'));select.value='MT1-2026';select.dispatchEvent(new Event('change',{bubbles:true}))})()`);await waitUntil("!document.querySelector('.monitoring-modal')","modal Risiko tertutup oleh season");
      await evaluate(`(()=>{const select=[...document.querySelectorAll('.risk-page select')].find(node=>node.closest('label')?.innerText.startsWith('Distrik'));select.value='93.01.02';select.dispatchEvent(new Event('change',{bubbles:true}))})()`);await waitUntil("document.querySelector('.risk-page .compact-empty-state h2')?.textContent==='Wilayah belum dipantau'","empty-state Risiko not monitored");assert.equal(await evaluate("Boolean(document.querySelector('.risk-page .monitoring-kpis,.risk-page table,.risk-page .table-pagination'))"),false);
      await capture("empty-state-risiko-1440x900");
      await evaluate(`(()=>{const select=[...document.querySelectorAll('.risk-page select')].find(node=>node.closest('label')?.innerText.startsWith('Distrik'));select.value='';select.dispatchEvent(new Event('change',{bubbles:true}))})()`);await waitFor(".risk-page tbody button");
      await evaluate(`(()=>{const select=[...document.querySelectorAll('.risk-page select')].find(node=>node.closest('label')?.innerText.startsWith('Musim'));select.value='MT2-2026';select.dispatchEvent(new Event('change',{bubbles:true}))})()`);await waitUntil("location.search.includes('season=MT2-2026')&&document.querySelector('.risk-page select')?.value==='MT2-2026'","Risiko dipulihkan ke MT II");
    }
    await evaluate(`(()=>{const select=[...document.querySelectorAll('.risk-page select')].find(node=>node.closest('label')?.innerText.startsWith('Musim'));if(select.value!=='MT2-2026'){select.value='MT2-2026';select.dispatchEvent(new Event('change',{bubbles:true}))}})()`);await waitUntil("document.querySelector('.risk-page select')?.value==='MT2-2026'","konteks MT II sebelum Kolaborasi");
    await evaluate("document.querySelector('button.nav-item[aria-label=\"Buka halaman Kolaborasi OPD\"]')?.click()"); await waitFor(".collaboration-page");
    assert.equal(await evaluate("document.querySelector('.collaboration-page h1')?.innerText"),"KOLABORASI OPD & INSTANSI");
    const collaborationNetwork=await evaluate(`(()=>{const canvas=document.querySelector('.network-canvas'),visible=getComputedStyle(canvas).display!=='none',nodes=[...document.querySelectorAll('.network-svg-node')],edges=document.querySelectorAll('.network-edges line').length,mobile=document.querySelectorAll('.network-mobile-list li').length,cr=canvas.getBoundingClientRect(),boxes=nodes.map(node=>{const r=node.getBoundingClientRect(),text=node.querySelector('text').getBBox(),rect=node.querySelector('rect').getBBox();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,labelInside:text.x>=rect.x-1&&text.x+text.width<=rect.x+rect.width+1}});return{visible,nodes:nodes.length,edges,mobile,inside:boxes.every(r=>r.left>=cr.left-1&&r.right<=cr.right+1&&r.top>=cr.top-1&&r.bottom<=cr.bottom+1),labels:boxes.every(r=>r.labelInside),overlap:boxes.some((a,i)=>boxes.some((b,j)=>j>i&&a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1))}})()`);
    assert.deepEqual([collaborationNetwork.visible,collaborationNetwork.nodes,collaborationNetwork.edges,collaborationNetwork.inside,collaborationNetwork.labels,collaborationNetwork.overlap],[true,7,8,true,true,false],`${width}x${height}`);
    assert.equal(await evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1"),false);
    assert.equal(await evaluate("/undefined|NaN/.test(document.querySelector('.collaboration-page').innerText)"),false);
    const collaborationPresentation=await evaluate(`(()=>{const input=document.querySelector('.collaboration-page .monitoring-search'),cards=[...document.querySelectorAll('.collaboration-page .monitoring-kpis article')],table=document.querySelector('.collaboration-page .table-scroll'),node=document.querySelector('.network-svg-node text'),count=document.querySelector('.network-count');return{inputHeight:input.getBoundingClientRect().height,inputPadding:parseFloat(getComputedStyle(input).paddingLeft),kpiOverlap:cards.some(card=>{const a=card.querySelector('span').getBoundingClientRect(),b=card.querySelector('strong').getBoundingClientRect();return a.bottom>b.top+1}),nodeFont:parseFloat(getComputedStyle(node).fontSize),countFont:parseFloat(getComputedStyle(count).fontSize),localScroll:getComputedStyle(table).overflowX!=='visible',badges:document.querySelectorAll('.collaboration-page .status-badge').length}})()`);
    assert.ok(collaborationPresentation.inputHeight>=40&&collaborationPresentation.inputPadding>=12&&!collaborationPresentation.kpiOverlap&&collaborationPresentation.nodeFont>=13&&collaborationPresentation.countFont>=12&&collaborationPresentation.localScroll&&collaborationPresentation.badges>0,`${width}x${height}: ${JSON.stringify(collaborationPresentation)}`);
    if(width===1440||width===390){await evaluate("scrollTo(0,0)");await capture(`kolaborasi-${width}x${height}`)}
    if([1440,768,390].includes(width)){
      await evaluate("document.querySelector('.collaboration-page tbody button').click()");await waitFor(".monitoring-modal");await waitUntil("document.querySelector('.monitoring-modal').contains(document.activeElement)","fokus modal Kolaborasi");
      const collaborationModal=await evaluate(`(()=>{const dialog=document.querySelector('.monitoring-modal'),body=dialog.querySelector('.monitoring-modal-body'),r=dialog.getBoundingClientRect(),style=getComputedStyle(body),text=body.innerText;return{inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,font:parseFloat(style.fontSize),line:parseFloat(style.lineHeight)/parseFloat(style.fontSize),metadata:['Identitas dan konteks','Pelaksana','Jadwal','Tindak lanjut','Related records','Metadata monitoring','referensi berhasil diverifikasi'].every(x=>text.includes(x)),wit:text.includes('24 Juli 2026 · 22.42 WIT'),locked:getComputedStyle(document.body).overflow==='hidden'}})()`);assert.ok(collaborationModal.inside&&collaborationModal.font>=12&&collaborationModal.line>=1.4&&collaborationModal.metadata&&collaborationModal.wit&&collaborationModal.locked);
      if(width===1440)await capture("modal-kolaborasi-1440x900");
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
      await evaluate(selectChange('.collaboration-page','Domain','Validasi Data'));await waitUntil("document.querySelectorAll('.collaboration-page tbody tr').length===1&&[...document.querySelectorAll('.collaboration-page tbody tr')].every(row=>row.cells[1].textContent==='Validasi Data')","filter Validasi Data MT I");
      await evaluate(selectChange('.collaboration-page','Domain','all'));await waitUntil("document.querySelectorAll('.collaboration-page tbody tr').length===2","reset filter domain MT I");
      await evaluate(`(()=>{const season=[...document.querySelectorAll('.collaboration-page select')].find(node=>node.closest('label')?.innerText.startsWith('Musim'));season.value='MT2-2026';season.dispatchEvent(new Event('change',{bubbles:true}))})()`);await waitUntil("document.querySelectorAll('.collaboration-page .network-svg-node').length===7","network MT II Kabupaten dipulihkan");
    } else {await evaluate(`(()=>{const select=[...document.querySelectorAll('.collaboration-page select')].find(node=>node.closest('label')?.innerText.startsWith('Distrik'));select.value='93.01.05';select.dispatchEvent(new Event('change',{bubbles:true}))})()`);await sleep(30);}
    assert.equal(await evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1"), false);
    assert.equal(await evaluate("/\\b(?:approved|pending|not_monitored|prototype)\\b|\\d{4}-\\d{2}-\\d{2}T|Invalid Date|1 hour ago/.test(document.body.innerText)"),false,`metadata mentah ${width}x${height}`);
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
  await send("Page.navigate",{url:`${origin}/?season=MT2-2026#view=peta-lahan`});await waitFor(".land-insight");
  const mapRiskDefinition=await evaluate("document.querySelector('.land-insight').innerText");
  assert.ok(mapRiskDefinition.includes('TARGET LUAS TANAM MT II')&&mapRiskDefinition.includes('42.680 ha')&&mapRiskDefinition.includes('Realisasi 38.180 ha · capaian 89,5%'));
  assert.ok(mapRiskDefinition.includes('KLASIFIKASI RISIKO LAHAN')&&mapRiskDefinition.includes('Cakupan saat ini 38.180 ha'));
  assert.equal(mapRiskDefinition.includes('LAHAN AKTIF MT II'),false);
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
  for (const season of ["MT1-2026", "MT2-2026"]) for (const district of ["", "93.01.01","93.01.05","93.01.06","93.01.07","93.01.11","93.01.14"]) {
    await setFoodContext(season,district);
    assert.equal(await evaluate("document.querySelectorAll('.food-security-page .monitoring-kpis article').length"),6,`${season} ${district || "kabupaten"} memiliki KPI`);
    assert.equal(await evaluate("/undefined|NaN/.test(document.querySelector('.food-security-page').innerText)"),false);
    assert.equal(await evaluate("document.querySelectorAll('.food-balance-chart .chart-point').length"),season === "MT2-2026" ? 4 : 6);
  }
  for (const season of ["MT1-2026", "MT2-2026"]) for (const district of ["93.01.02", "93.01.03", "93.01.08"]) {
    await setFoodContext(season,district);
    assert.equal(await evaluate("document.querySelector('.food-security-page .monitoring-empty')?.innerText"),"Belum dipantau");
    assert.equal(await evaluate("document.querySelectorAll('.food-security-page .monitoring-kpis').length"),0);
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
  const lowHeightCases=[[900,600],[840,560],[720,500]];
  const expectedMenuOrder=["Ringkasan","Peta Lahan","Musim Tanam","Produksi","Ketahanan Pangan","Infrastruktur & Sarana","Risiko & Iklim","Kolaborasi OPD","Laporan"];
  for(const [width,height] of lowHeightCases){
    await send("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:false});
    await send("Page.navigate",{url:`${origin}/?season=MT2-2026`});await waitFor(".sidebar nav");
    const low=await evaluate(`(()=>{const sidebar=document.querySelector('.sidebar'),nav=sidebar.querySelector('nav'),items=[...nav.querySelectorAll('.nav-item')],sr=sidebar.getBoundingClientRect();return{labels:items.map(x=>x.textContent.trim()),sizes:items.map(x=>{const r=x.getBoundingClientRect(),svg=x.querySelector('svg').getBoundingClientRect();return{w:r.width,h:r.height,font:parseFloat(getComputedStyle(x).fontSize),iconW:svg.width,iconH:svg.height,insideX:r.left>=sr.left-1&&r.right<=sr.right+1,clipped:x.scrollWidth>x.clientWidth+1}}),sidebarInside:sr.top>=-1&&sr.bottom<=innerHeight+1,navOverflowY:getComputedStyle(nav).overflowY,scrollbarWidth:getComputedStyle(nav).scrollbarWidth,scrollable:nav.scrollHeight>nav.clientHeight,pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}})()`);
    assert.deepEqual(low.labels,expectedMenuOrder,`${width}x${height}: urutan DOM`);
    assert.ok(low.sizes.every(x=>x.w>=40&&x.h>=40&&x.font>=12&&Number.isFinite(x.iconW)&&Math.abs(x.iconW-x.iconH)<=1&&x.insideX),`${width}x${height}: target/font/bounds ${JSON.stringify(low.sizes)}`);
    assert.ok(low.sidebarInside&&low.navOverflowY==="auto"&&low.scrollbarWidth==="none"&&!low.pageOverflow,`${width}x${height}: sidebar scroll internal tersedia ${JSON.stringify(low)}`);
    await evaluate("document.querySelector('.sidebar nav').scrollTop=0;document.querySelector('.sidebar .nav-item').focus()");
    for(let index=0;index<7;index++){await pressKey("Tab");assert.equal(await evaluate("document.activeElement?.classList.contains('nav-item')"),true,`${width}x${height}: Tab tetap menjangkau menu`)}
    assert.equal(await evaluate("document.activeElement?.textContent.trim()"),"Kolaborasi OPD");
    assert.equal(await evaluate("(()=>{const nav=document.querySelector('.sidebar nav'),r=document.activeElement.getBoundingClientRect(),n=nav.getBoundingClientRect();return r.top>=n.top-1&&r.bottom<=n.bottom+1})()"),true,`${width}x${height}: item fokus otomatis terlihat`);
    await pressKey("Tab",8);assert.equal(await evaluate("document.activeElement?.textContent.trim()"),"Risiko & Iklim");
    assert.equal(await evaluate("(()=>{const nav=document.querySelector('.sidebar nav'),last=nav.querySelector('.nav-item:last-child');last.scrollIntoView({block:'nearest'});const r=last.getBoundingClientRect(),n=nav.getBoundingClientRect();return r.top>=n.top-1&&r.bottom<=n.bottom+1&&last.disabled})()"),true,`${width}x${height}: Laporan disabled tetap terlihat`);
    await pressKey("PageUp");assert.ok(await evaluate("document.querySelector('.sidebar nav').scrollTop>=0"));
    const navCenter=await evaluate("(()=>{const r=document.querySelector('.sidebar nav').getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()");
    await send("Input.dispatchMouseEvent",{type:"mouseWheel",x:navCenter.x,y:navCenter.y,deltaX:0,deltaY:-300});await sleep(25);
    assert.ok(await evaluate("document.querySelector('.sidebar nav').scrollTop>=0"));
  }
  await send("Emulation.setDeviceMetricsOverride",{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await send("Page.navigate",{url:`${origin}/?season=MT2-2026`});await waitFor(".sidebar nav");
  const longPages=["Ketahanan Pangan","Infrastruktur & Sarana","Risiko & Iklim","Kolaborasi OPD"];
  for(const label of longPages){
    await evaluate(`[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.trim()===${JSON.stringify(label)}).click()`);await waitUntil(`document.querySelector('.nav-item[aria-current=page]')?.textContent.trim()===${JSON.stringify(label)}`,`scroll page ${label}`);
    const maxScroll=await evaluate("Math.max(0,document.documentElement.scrollHeight-innerHeight)");
    const positions=[0,Math.floor(maxScroll/2),maxScroll];
    const samples=[];
    for(const y of positions){await evaluate(`scrollTo(0,${y})`);await waitUntil(`Math.abs(scrollY-${y})<=1`,`scroll ${label} ${y}`);samples.push(await evaluate(`(()=>{const sidebar=document.querySelector('.sidebar'),workspace=document.querySelector('.workspace'),status=document.querySelector('.side-status'),active=document.querySelector('.nav-item[aria-current=page]'),r=sidebar.getBoundingClientRect(),w=workspace.getBoundingClientRect(),s=status.getBoundingClientRect();return{top:r.top,bottom:r.bottom,height:r.height,left:r.left,right:r.right,viewport:document.documentElement.clientHeight,workspaceLeft:w.left,overflow:getComputedStyle(sidebar).overflowY,scrollHeight:sidebar.scrollHeight,clientHeight:sidebar.clientHeight,statusInside:s.top>=r.top&&s.bottom<=r.bottom,activeVisible:active.getBoundingClientRect().top>=r.top&&active.getBoundingClientRect().bottom<=r.bottom,pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1}})()`))}
    assert.ok(samples.every(x=>Math.abs(x.top)<=1&&Math.abs(x.bottom-x.viewport)<=1&&Math.abs(x.height-x.viewport)<=1&&Math.abs(x.workspaceLeft-x.right)<=1&&x.overflow==="visible"&&x.statusInside&&x.activeVisible&&!x.pageOverflow),`${label}: sidebar fixed saat scroll ${JSON.stringify(samples)}`);
    assert.ok(samples.every(x=>x.left===samples[0].left&&x.right===samples[0].right),`${label}: posisi horizontal sidebar stabil`);
  }
  const zoomFactors=[1,1.1,1.25,1.5,1.75,2],zoomMetrics=[];
  for(const [baseWidth,baseHeight] of viewports)for(const factor of zoomFactors){
    const width=Math.floor(baseWidth/factor),height=Math.floor(baseHeight/factor),context=`base ${baseWidth}x${baseHeight}, zoom ${factor}, effective ${width}x${height}`;
    await send("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:false});
    await send("Page.navigate",{url:`${origin}/?season=MT2-2026`});await waitFor(".sidebar nav");
    const zoomNavigation=await evaluate(`(()=>{const sidebar=document.querySelector('.sidebar'),nav=sidebar.querySelector('nav'),workspace=document.querySelector('.workspace'),items=[...nav.querySelectorAll('.nav-item')],sr=sidebar.getBoundingClientRect(),wr=workspace.getBoundingClientRect(),rects=items.map(item=>{const r=item.getBoundingClientRect(),icon=item.querySelector('svg').getBoundingClientRect();return{label:item.textContent.trim(),w:r.width,h:r.height,font:parseFloat(getComputedStyle(item).fontSize),iconW:icon.width,iconH:icon.height,insideX:r.left>=sr.left-1&&r.right<=sr.right+1,clipped:item.scrollWidth>item.clientWidth+1}});return{controls:document.querySelectorAll('.navigation-trigger,.navigation-close,.navigation-overlay').length,position:getComputedStyle(sidebar).position,navOverflow:getComputedStyle(nav).overflowY,pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,sidebarInside:sr.left>=-1&&sr.top>=-1&&sr.right<=innerWidth+1&&sr.bottom<=innerHeight+1,workspaceOffset:Math.abs(wr.left-sr.right)<=1,count:items.length,active:nav.querySelectorAll('[aria-current=page]').length,rects,minFont:Math.min(...rects.map(x=>x.font)),minWidth:Math.min(...rects.map(x=>x.w)),minHeight:Math.min(...rects.map(x=>x.h))}})()`);
    assert.equal(zoomNavigation.controls,0,`${context}: tidak ada drawer/hamburger/overlay`);assert.equal(zoomNavigation.count,9,`${context}: jumlah menu`);assert.equal(zoomNavigation.active,1,`${context}: active item`);
    assert.equal(zoomNavigation.position,"fixed",`${context}: sidebar fixed`);assert.equal(zoomNavigation.navOverflow,"auto",`${context}: nav scroll internal`);
    for(const item of zoomNavigation.rects){assert.ok(item.w>=40&&item.h>=40,`${context}: target ${item.label} ${item.w}x${item.h}`);assert.ok(item.font>=12,`${context}: font ${item.label} ${item.font}px`);assert.ok(Number.isFinite(item.iconW)&&Number.isFinite(item.iconH)&&item.iconW>0&&item.iconH>0&&Math.abs(item.iconW/item.iconH-1)<=.1,`${context}: ikon ${item.label} ${item.iconW}x${item.iconH}`);assert.ok(item.insideX,`${context}: bounds ${item.label}`)}
    assert.ok(!zoomNavigation.pageOverflow&&zoomNavigation.sidebarInside&&zoomNavigation.workspaceOffset,`${context}: overflow/offset ${JSON.stringify(zoomNavigation)}`);
    zoomMetrics.push({base:`${baseWidth}x${baseHeight}`,factor,effective:`${width}x${height}`,minFont:zoomNavigation.minFont,minTarget:`${zoomNavigation.minWidth}x${zoomNavigation.minHeight}`});
  }
  await send("Emulation.setDeviceMetricsOverride",{width:768,height:1024,deviceScaleFactor:1,mobile:false});
  await send("Page.navigate",{url:`${origin}/?season=MT2-2026`});await waitFor(".sidebar nav");
  for(const label of expectedMenuOrder.slice(0,-1)){
    await evaluate(`[...document.querySelectorAll('.nav-item')].find(x=>x.textContent.trim()===${JSON.stringify(label)}).click()`);
    await waitUntil(`document.querySelector('.nav-item[aria-current=page]')?.textContent.trim()===${JSON.stringify(label)}`,`active ${label}`);
    assert.equal(await evaluate("document.querySelectorAll('.nav-item[aria-current=page]').length"),1);
    const activeHash=await evaluate("location.hash");await send("Page.reload");await waitFor(".sidebar nav");await waitUntil(`document.querySelector('.nav-item[aria-current=page]')?.textContent.trim()===${JSON.stringify(label)}`,`refresh ${label}`);assert.equal(await evaluate("location.hash"),activeHash);
  }
  const beforeDisabled=await evaluate("location.hash");assert.equal(await evaluate("document.querySelector('.nav-item[aria-disabled=true]').disabled"),true);await evaluate("document.querySelector('.nav-item[aria-disabled=true]').click()");assert.equal(await evaluate("location.hash"),beforeDisabled);
  await evaluate("history.back()");await waitUntil("document.querySelectorAll('.nav-item[aria-current=page]').length===1","Back active tunggal");const backActive=await evaluate("document.querySelector('.nav-item[aria-current=page]').textContent.trim()");await evaluate("history.forward()");await waitUntil(`document.querySelector('.nav-item[aria-current=page]')?.textContent.trim()!==${JSON.stringify(backActive)}`,"Forward active berubah");
  console.log(`Food layout metrics: ${JSON.stringify(foodLayoutMetrics)}`);
  console.log(`Navigation layout metrics: ${JSON.stringify(navigationLayoutMetrics)}`);
  console.log(`Zoom matrix PASS: ${zoomMetrics.length} combinations; minimum font ${Math.min(...zoomMetrics.map(x=>x.minFont))}px; minimum targets ${zoomMetrics.map(x=>x.minTarget).join(',')}`);
  console.log(`Browser DOM PASS: ${viewports.map(([w,h])=>`${w}x${h}`).join(", ")}`);
 }
});
