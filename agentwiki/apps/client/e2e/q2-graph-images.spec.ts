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
    const fill = p.fillText, clear = p.clearRect, arc = p.arc;
    (window as any).painted = [];
    (window as any).circles = [];
    p.clearRect = function(...args) { (window as any).painted=[]; (window as any).circles=[]; return clear.apply(this,args); };
    p.arc = function(x,y,r,...rest) {
      const t = this.getTransform(), dpr = window.devicePixelRatio;
      (window as any).circles.push({ x:(x*t.a+t.e)/dpr, y:(y*t.d+t.f)/dpr, radius:r*t.a/dpr });
      return arc.call(this,x,y,r,...rest);
    };
    p.fillText = function(text,x,y,...rest) {
      (window as any).painted.push({ text,x,y,width:this.measureText(text).width,transform:Array.from([this.getTransform().a,this.getTransform().d]),font:this.font });
      return fill.call(this,text,x,y,...rest);
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
test('real canvas measures non-overlapping multiline labels at zoom and resized viewports', async ({page}) => {
  await expect(page.getByRole('combobox',{name:'Browse graph nodes'})).toBeVisible();
  for (const width of [1200,390]) {
    await page.setViewportSize({width,height:850});
    for (const action of ['Fit graph','Zoom in','Zoom out']) {
      await page.getByRole('button',{name:action,exact:true}).click();
      await expect.poll(() => page.evaluate(() => (window as any).painted.length)).toBeGreaterThan(0);
      const geometry = await page.evaluate(() => {
        const canvas = document.querySelector('canvas')!, rect=canvas.getBoundingClientRect();
        const labels=(window as any).painted as Array<{x:number;y:number;width:number;text:string;transform:number[];font:string}>;
        return {rect:{width:rect.width,height:rect.height},labels,circles:(window as any).circles as Array<{x:number;y:number;radius:number}>};
      });
      for (const a of geometry.labels) {
        expect(a.x).toBeGreaterThanOrEqual(8); expect(a.y).toBeGreaterThanOrEqual(8);
        expect(a.x+a.width).toBeLessThanOrEqual(geometry.rect.width-8+0.01); expect(a.y+20).toBeLessThanOrEqual(geometry.rect.height-8+0.01);
        expect(a.font).toBe('14px sans-serif');
        for (const node of geometry.circles) expect(Math.hypot(node.x - Math.max(a.x,Math.min(node.x,a.x+a.width)),node.y - Math.max(a.y,Math.min(node.y,a.y+20)))).toBeGreaterThanOrEqual(node.radius+4-0.01);
        for (const b of geometry.labels) if (a!==b) expect(a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+20 && a.y+20 > b.y).toBe(false);
      }
    }
  }
  await expect(page.getByRole('status').filter({hasText:'titles are hidden'})).toContainText('titles are hidden');
  await page.getByRole('combobox').selectOption('p59');
  await expect(page.getByRole('link',{name:'Open selected page'})).toHaveAttribute('href','/pages/p59');
  await page.screenshot({path:'/tmp/task6-graph-mobile.png'});
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
        if(width===390 && region==='Page image fixture' && name==='Attachment') await page.screenshot({path:'/tmp/task6-lightbox-mobile.png'});
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
