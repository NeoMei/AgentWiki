import { expect, test } from '@playwright/test';
import { deflateSync } from 'node:zlib';
// Local browser-only fixture. No user identity, server data or external request is used.
function png() {
  const crc = (bytes: Buffer) => { let c = 0xffffffff; for (const byte of bytes) { c ^= byte; for (let i=0;i<8;i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const name = Buffer.from(type), len = Buffer.alloc(4), sum = Buffer.alloc(4); len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([name,data]))); return Buffer.concat([len,name,data,sum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(1200,0); header.writeUInt32BE(600,4); header[8]=8; header[9]=2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'), chunk('IHDR',header), chunk('IDAT',deflateSync(Buffer.alloc((1200*3+1)*600))),chunk('IEND',Buffer.alloc(0))]);
}
let contentRequests = 0;
test.beforeEach(async ({ page }) => {
  contentRequests = 0;
  await page.addInitScript(() => {
    localStorage.setItem('agentwiki.language.v1','en');
    const revoke = URL.revokeObjectURL;
    (window as any).revoked = [];
    URL.revokeObjectURL = url => { (window as any).revoked.push(url); revoke(url); };
    const p = CanvasRenderingContext2D.prototype;
    const clear = p.clearRect, arc = p.arc;
    (window as any).circles = [];
    p.clearRect = function(...args) { (window as any).circles=[]; return clear.apply(this,args); };
    p.arc = function(x,y,r,...rest) {
      const t = this.getTransform(), dpr = window.devicePixelRatio;
      (window as any).circles.push({ x:(x*t.a+t.e)/dpr, y:(y*t.d+t.f)/dpr, radius:r*t.a/dpr });
      return arc.call(this,x,y,r,...rest);
    };
  });
  await page.route('https://images.example.test/**', route => route.fulfill({contentType:'image/png',body:png()}));
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const url = route.request().url();
    if (url.endsWith('/content')) { contentRequests++; return route.fulfill({contentType:'image/png',body:png()}); }
    const nodes = Array.from({length:60},(_,i) => ({id:`p${i}`,title:`${i%2 ? 'Long English title WWWW' : '中文知识图谱标题'} ${i} `.repeat(4),x:70+(i%10)*75,y:70+Math.floor(i/10)*70,radius:10}));
    const json = url.includes('/knowledge/graph/') ? {nodes,edges:[]} : url.includes('/markdown/resolve') ? route.request().postDataJSON().references.map((r:any)=>({key:r.key,status:'resolved',kind:'attachment',attachmentId:'fixture',displayName:'wide.png',mimeType:'image/png',width:1200,height:600})) : {data:nodes};
    await route.fulfill({json});
  });
  await page.goto('/e2e/fixtures/q2-graph-images.html');
});
test('grouped and flat canvas views support selection, clearing, zoom and opening a page', async ({page}) => {
  const browse = page.getByRole('combobox', { name: 'Browse graph nodes', exact: true });
  const details = page.getByRole('complementary', { name: 'Page details', exact: true });
  const canvas = page.locator('canvas.graph-canvas');
  const selectedLabels = page.locator('.graph-node-label[aria-pressed="true"]');
  const zoom = page.getByLabel('Graph zoom', { exact: true });
  const fit = page.getByRole('button', { name: 'Fit graph', exact: true });
  const zoomPercent = async () => Number.parseInt(await zoom.innerText(), 10);
  await expect(browse).toBeVisible();
  await page.getByText('Relation types', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Folder groups', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const flatView = page.getByRole('button', { name: 'All page nodes', exact: true });
  await expect(flatView).toHaveAttribute('aria-pressed', 'false');
  await flatView.click();
  await expect(flatView).toHaveAttribute('aria-pressed', 'true');
  await page.getByText('Relation types', { exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).circles.length)).toBe(60);
  await expect(selectedLabels).toHaveCount(0);
  await expect(details).toHaveCount(0);
  await page.screenshot({path:test.info().outputPath('graph-default-desktop.png')});
  const first = await page.evaluate(() => (window as any).circles[0] as {x:number;y:number});
  await canvas.click({position:{x:first.x,y:first.y}});
  await expect(browse).toHaveValue('p0');
  await expect(details.getByRole('heading', { level: 3, name: /中文知识图谱标题/u })).toBeVisible();
  await expect(selectedLabels).toHaveAttribute('data-node-id', 'p0');
  await canvas.click({position:{x:24,y:24}});
  await expect(browse).toHaveValue('');
  await expect(details).toHaveCount(0);
  for (const width of [1200,390]) {
    await page.setViewportSize({width,height:850});
    for (const id of ['p11', 'p59']) {
      await browse.selectOption(id);
      await fit.click();
      const fitted = await zoomPercent();
      await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
      await expect.poll(zoomPercent).toBeGreaterThan(fitted);
      const zoomed = await zoomPercent();
      await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
      await expect.poll(zoomPercent).toBeLessThan(zoomed);
      await expect(browse).toHaveValue(id);
      await expect(selectedLabels).toHaveAttribute('data-node-id', id);
      await expect(details.getByRole('heading', { level: 3, name: /Long English title/u })).toBeVisible();
      await expect(details.getByRole('link',{name:'Open page', exact: true})).toHaveAttribute('href',`/pages/${id}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({path:test.info().outputPath(`graph-selected-${width}-${id}.png`)});
    }
    await canvas.click({position:{x:24,y:24}});
    await expect(browse).toHaveValue('');
    await expect(selectedLabels).toHaveCount(0);
    await expect(details).toHaveCount(0);
    await page.screenshot({path:test.info().outputPath(`graph-cleared-${width}.png`)});
  }
  await fit.click();
  const second = await page.evaluate(() => (window as any).circles[1] as {x:number;y:number});
  await canvas.dblclick({position:{x:second.x,y:second.y}});
  await expect(page.getByText('Opened page p1', {exact:true})).toBeVisible();
});
test('page and editor images open by keyboard, remain bounded, close and restore focus', async ({page}) => {
  for (const width of [1200,390]) {
    await page.setViewportSize({width,height:850});
    for (const region of ['Page image fixture','Editor preview fixture']) {
      for (const name of ['External','Attachment']) {
        const opener = page.getByRole('region',{name:region}).getByRole('button',{name:`Enlarge image: ${name}`});
        await opener.focus(); await page.keyboard.press('Enter');
        const dialog=page.getByRole('dialog',{name:'Image preview'}); await expect(dialog).toBeVisible();
        const image=dialog.getByRole('img'); await expect.poll(()=>image.evaluate((e:HTMLImageElement)=>e.naturalWidth)).toBe(1200);
        if(width===390 && region==='Page image fixture' && name==='Attachment') await page.screenshot({path:test.info().outputPath('lightbox-mobile.png')});
        const bounds=await image.boundingBox(); expect(bounds!.width/bounds!.height).toBeCloseTo(2,1); expect(bounds!.width).toBeLessThan(width); expect(bounds!.height).toBeLessThan(850);
        await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
        await page.keyboard.press('Space'); await expect(dialog).toBeVisible();
        await page.mouse.click(2,2); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
      }
    }
  }
  expect(contentRequests).toBe(2); // One protected fetch for each renderer, none for enlargement.
  const attachment = page.getByRole('region',{name:'Page image fixture'}).getByRole('button',{name:'Enlarge image: Attachment'});
  await attachment.click();
  const blobUrl = await page.getByRole('dialog').getByRole('img').getAttribute('src');
  // Simulate a route/content teardown while the dialog owns focus.
  await page.getByRole('button',{name:'Toggle images'}).evaluate((e:HTMLButtonElement)=>e.click());
  await expect.poll(()=>page.evaluate(()=> (window as any).revoked)).toContain(blobUrl);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(()=>document.querySelectorAll('[inert]').length)).toBe(0);
});
