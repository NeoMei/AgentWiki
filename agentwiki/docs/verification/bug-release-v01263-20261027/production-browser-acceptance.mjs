import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
const require=createRequire(new URL('../../../package.json',import.meta.url));
const {chromium}=require('playwright');
const {expect}=createRequire(new URL('../../../apps/client/package.json',import.meta.url))('@playwright/test');
const origin='https://agentwiki.quukk.com';
if(process.env.RELEASE_APPROVED!=='0.12.63'||process.env.CONFIRM_REMOTE_E2E_HOST!=='agentwiki.quukk.com')throw new Error('Requires explicit deployed v0.12.63 confirmation');
const out=process.env.QA_OUTPUT||'/tmp/agentwiki-v01263-browser';
await mkdir(out,{recursive:true});
const id=randomUUID(), password=`ReleaseQa9-${randomUUID()}`, email=`release-${id}@example.test`;
const receipt={version:'0.12.63',startedAt:new Date().toISOString(),origin,isolatedProfile:true,existingUserProfileUntouched:true,setupVia:'Normal authenticated API with task-created account only',tests:[],cleanup:{},resources:{}};
let token,user,space,browser,context,page;
const seenRequests=[];
const check=(name,details={})=>receipt.tests.push({name,passed:true,...details});
const api=async(path,method='GET',body,auth=true)=>{
 const r=await fetch(origin+'/api'+path,{method,headers:{'content-type':'application/json',...(auth&&token?{authorization:`Bearer ${token}`}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000)});
 const s=await r.text(); if(!r.ok)throw new Error(`${method} ${path}: ${r.status} ${s.slice(0,300)}`);return s?JSON.parse(s):null;
};
const boardPath=()=>`/spaces/${space.id}/taskboard`;
const tree=async(parentId)=>api(`/spaces/${space.id}/content-tree?take=200${parentId?`&parentFolderId=${parentId}`:''}`);
const sha=s=>createHash('sha256').update(s).digest('hex');
try{
 browser=await chromium.launch({channel:'chrome',headless:true});receipt.browser=browser.version();
 context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.addInitScript(()=>localStorage.setItem('agentwiki.language.v1','en'));
 page=await context.newPage();page.setDefaultTimeout(20000);
 page.on('request',r=>{if(r.url().startsWith(origin+'/api/'))seenRequests.push({method:r.method(),path:new URL(r.url()).pathname});});
 await page.goto(origin+'/login');await expect(page.locator('#product-auth-email')).toBeVisible();receipt.entryAssets=await page.locator('script[type=module][src]').evaluateAll(es=>es.map(e=>new URL(e.src).pathname));
 await page.evaluate(()=>{window.qaInvalidCount=0;document.addEventListener('invalid',()=>window.qaInvalidCount++,true)});
 for(const mode of ['login','register']){
  await page.locator(`#product-auth-tab-${mode}`).click();
  const cases=[{label:'empty',name:'',email:'',password:'',field:mode==='register'?'name':'email'},
   ...['bad-address','a@b..com','a@-b.com','a@b_.com','a,b@example.com','a<b@example.com','a..b@example.com'].map(email=>({label:'invalid email '+email,name:'ReleaseQA',email,password:'ReleaseQa9',field:'email'})),
   {label:'empty password',name:'ReleaseQA',email:'qa@example.test',password:'',field:'password'},
   {label:'whitespace password',name:'ReleaseQA',email:'qa@example.test',password:'　 ',field:'password'}];
  if(mode==='register')cases.push({label:'whitespace name',name:'　 ',email:'qa@example.test',password:'ReleaseQa9',field:'name'});
  for(const c of cases){
   if(mode==='register')await page.locator('#product-auth-name').fill(c.name);
   await page.locator('#product-auth-email').fill(c.email);await page.locator('#product-auth-password').fill(c.password);
   await page.locator('#product-auth-panel form button[type=submit]').click();
   await expect(page.locator(`#product-auth-${c.field}`)).toBeFocused();
   await expect(page.locator('#product-auth-panel [role=alert]')).toHaveCount(1);
   expect(await page.locator('#product-auth-panel form').evaluate(el=>el.noValidate)).toBe(true);
   check(`${mode}: ${c.label}`);
  }
 }
 expect(await page.evaluate(()=>window.qaInvalidCount)).toBe(0);
 expect(seenRequests.filter(r=>r.method==='POST'&&/\/auth\/(login|register)$/.test(r.path))).toHaveLength(0);
 receipt.invalidAuthentication={nativeInvalidEvents:0,authRequests:0};
 const auth=await api('/auth/register','POST',{email,password,name:'ReleaseQA'},false);token=auth.access_token;user=auth.user;receipt.resources.userId=user.id;
 space=await api('/spaces','POST',{name:`Release QA 0.12.63 ${id.slice(0,8)}`,description:'Temporary acceptance resources; safe to remove after this run.'});receipt.resources.spaceId=space.id;
 await page.locator('#product-auth-tab-login').click();await page.locator('#product-auth-email').fill(email);await page.locator('#product-auth-password').fill(password);await page.locator('#product-auth-panel form button[type=submit]').click();
 await page.waitForURL('**/dashboard');check('Isolated temporary account signs in via normal production UI');
 const folders=[];for(const name of ['QA folder A','QA folder B'])folders.push((await api(`/spaces/${space.id}/folders`,'POST',{name,expectedTreeRevision:(await tree()).treeRevision})).folder);
 const pages=[];for(const title of ['QA first','QA second','QA third'])pages.push(await api('/pages','POST',{title,content:`# ${title}\n\nSynthetic release acceptance.`,spaceId:space.id,expectedTreeRevision:(await tree()).treeRevision}));
 receipt.resources.pageIds=pages.map(p=>p.id);receipt.resources.folderIds=folders.map(p=>p.id);
 await page.goto(`${origin}/spaces/${space.id}`);
 const pane=page.locator('aside[aria-label]').filter({has:page.getByTestId('space-directory-scroll')});
 const row=id=>pane.getByTestId(`content-row-${id}`);
 await expect(row(pages[0].id)).toBeVisible();
 const pageIds=async(parent)=>((await tree(parent)).data.filter(n=>n.kind==='page').map(n=>n.id));
 await row(pages[0].id).dragTo(row(pages[1].id),{targetPosition:{x:90,y:25}});
 await expect.poll(()=>pageIds()).toEqual([pages[1].id,pages[0].id,pages[2].id]);
 await page.reload();await expect(row(pages[0].id)).toBeVisible();
 expect(await pane.locator('[data-testid^="content-row-"]').evaluateAll(es=>es.map(e=>e.getAttribute('data-testid')).filter(s=>s.includes('content-row-')))).toContain(`content-row-${pages[0].id}`);
 check('Page after drop persists server ordering and reload');
 await row(pages[0].id).dragTo(row(pages[2].id),{targetPosition:{x:90,y:30}});
 await expect.poll(()=>pageIds()).toEqual([pages[1].id,pages[2].id,pages[0].id]);
 await page.reload();await expect(row(pages[0].id)).toBeVisible();check('Drop after last page appends and survives reload');
 await row(pages[0].id).dragTo(row(folders[0].id));await expect.poll(()=>pageIds(folders[0].id)).toEqual([pages[0].id]);
 if(await pane.getByTestId(`content-item-${folders[0].id}`).getAttribute('aria-expanded')!=='true')await pane.getByTestId(`content-toggle-${folders[0].id}`).click();await expect(row(pages[0].id)).toBeVisible();
 await row(pages[0].id).dragTo(row(folders[1].id));await expect.poll(()=>pageIds(folders[1].id)).toEqual([pages[0].id]);
 await page.reload();await expect(row(folders[1].id)).toBeVisible();check('Page cross-folder drag persists through fresh reload');
 await row(folders[0].id).dragTo(row(folders[1].id),{targetPosition:{x:90,y:30}});
 await expect.poll(async()=>(await tree()).data.filter(n=>n.kind==='folder').map(n=>n.id)).toEqual([folders[1].id,folders[0].id]);
 await page.reload();await expect(row(folders[0].id)).toBeVisible();check('Folder after drop persists and survives reload');
 await row(pages[2].id).getByLabel('Actions: QA third',{exact:true}).focus();await page.keyboard.press('ArrowDown');
 await expect(page.getByRole('button',{name:'Move up',exact:true})).toBeFocused();await page.keyboard.press('Enter');
 await expect.poll(()=>pageIds()).toEqual([pages[2].id,pages[1].id]);check('Keyboard menu move-up persists');
 const context2=await browser.newContext({viewport:{width:1440,height:1000}});await context2.addInitScript(()=>localStorage.setItem('agentwiki.language.v1','en'));
 const page2=await context2.newPage();await page2.goto(origin+'/login');await page2.locator('#product-auth-email').fill(email);await page2.locator('#product-auth-password').fill(password);await page2.locator('#product-auth-panel form button[type=submit]').click();await page2.waitForURL('**/dashboard');await page2.goto(`${origin}/spaces/${space.id}`);
 const pane2=page2.locator('aside[aria-label]').filter({has:page2.getByTestId('space-directory-scroll')});await expect(pane2.getByTestId(`content-row-${pages[2].id}`)).toBeVisible();
 const readOrder=await pane2.locator('[data-testid^="content-row-"]').evaluateAll(es=>es.map(e=>e.getAttribute('data-testid')));
 expect(readOrder.indexOf(`content-row-${pages[2].id}`)).toBeLessThan(readOrder.indexOf(`content-row-${pages[1].id}`));await context2.close();check('Independent second Chrome context reloads persisted page order');
 const source='# QA notes\n\nOriginal unique release passage.\n',replacement='# QA notes\n\nReplaced synthetic text.\n';
 const notePage=await api('/pages','POST',{title:'QA stale note',content:source,spaceId:space.id,expectedTreeRevision:(await tree()).treeRevision});receipt.resources.pageIds.push(notePage.id);
 const notePath=`/spaces/${space.id}/pages/${notePage.id}/notes`,quote='Original unique release passage.',from=source.indexOf(quote);
 const note=await api(notePath,'POST',{clientNoteId:randomUUID(),body:'Disposable stale note',target:{kind:'selection',from,to:from+quote.length,quote,prefix:source.slice(0,from),suffix:source.slice(from+quote.length),baseUpdatedAt:notePage.updatedAt}});receipt.resources.noteId=note.id;
 const changed=await api(`/pages/${notePage.id}`,'PATCH',{content:replacement,expectedUpdatedAt:notePage.updatedAt});
 await page.goto(`${origin}/pages/${notePage.id}`);await page.locator('#reading-document-tab-notes').click();
 const notesPanel=page.getByRole('region',{name:'Page notes',exact:true});await expect(notesPanel.getByText('Original passage changed or anchor is ambiguous',{exact:true})).toBeVisible();
 await notesPanel.getByRole('button',{name:'Delete note',exact:true}).click();await expect(notesPanel.getByText('Disposable stale note',{exact:true})).toHaveCount(0);
 await expect.poll(async()=>(await api(notePath)).notes.length).toBe(0);await page.reload();await page.locator('#reading-document-tab-notes').click();await expect(page.getByText('Disposable stale note',{exact:true})).toHaveCount(0);
 const unchanged=await api(`/pages/${notePage.id}`);expect(unchanged.content).toBe(replacement);expect(unchanged.updatedAt).toBe(changed.updatedAt);check('Reading sidebar deletes stale note; reload empty; page body and version unchanged',{bodyHash:sha(unchanged.content)});
 const rootTask=(await api(boardPath()+'/tasks','POST',{id:'qa-root-'+id,title:'QA root task'})).task;
 const child=(await api(boardPath()+`/tasks/${rootTask.id}/children`,'POST',{id:'qa-child-'+id,title:'QA child task'})).task;
 const dependent=(await api(boardPath()+'/tasks','POST',{id:'qa-dependent-'+id,title:'QA dependent',depends_on:[child.id]})).task;
 await page.goto(`${origin}/spaces/${space.id}/taskboard`);await expect(page.getByLabel('Task name',{exact:true})).toHaveValue('QA root task');
 await page.getByLabel('Task name',{exact:true}).fill('QA renamed task');await page.getByRole('button',{name:'Save name',exact:true}).click();
 await expect.poll(async()=>(await api(boardPath())).board.tasks.find(t=>t.id===rootTask.id)?.title).toBe('QA renamed task');
 await page.reload();await expect(page.getByLabel('Task name',{exact:true})).toHaveValue('QA renamed task');check('Task rename persists and detail reloads new name');
 page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Delete task card',exact:true}).click();expect((await api(boardPath())).board.tasks.length).toBe(3);check('Cancel task deletion leaves all cards');
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Delete task card',exact:true}).click();await expect(page.getByText('Other tasks depend on this task or its children. Remove those dependencies before deleting.',{exact:true})).toBeVisible();expect((await api(boardPath())).board.tasks.length).toBe(3);check('Referenced subtree deletion rejected visibly with no partial write');
 await api(boardPath()+`/tasks/${dependent.id}`,'PATCH',{depends_on:[]});page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Delete task card',exact:true}).click();
 await expect.poll(async()=>(await api(boardPath())).board.tasks.map(t=>t.id)).toEqual([dependent.id]);await page.reload();await expect(page.getByLabel('Task name',{exact:true})).toHaveValue('QA dependent');check('Confirmed subtree deletion persists and reload contains only unrelated card');
 receipt.passed=true;
}catch(e){receipt.passed=false;receipt.error=String(e);if(page)await page.screenshot({path:out+'/failure.png',fullPage:true}).catch(()=>{});}
finally{
 if(space&&token){try{await api(`/spaces/${space.id}`,'DELETE');const r=await fetch(origin+`/api/spaces/${space.id}`,{headers:{authorization:`Bearer ${token}`}});expect([403,404]).toContain(r.status);receipt.cleanup.space={deleted:true,readbackStatus:r.status};}catch(e){receipt.cleanup.space={deleted:false,error:String(e)};receipt.passed=false;}}
 if(user&&token){try{await api(`/users/${user.id}`,'DELETE');const r=await fetch(origin+'/api/users/me',{headers:{authorization:`Bearer ${token}`}});expect(r.status).toBe(401);receipt.cleanup.user={deleted:true,readbackStatus:r.status};}catch(e){receipt.cleanup.user={deleted:false,error:String(e)};receipt.passed=false;}}
 if(browser)await browser.close();receipt.cleanup.browserClosed=true;receipt.completedAt=new Date().toISOString();receipt.noModelRequests=seenRequests.every(r=>!/(\/turns|\/assist\/tasks)$/.test(r.path));
 await writeFile(out+'/production-browser.json',JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify({passed:receipt.passed,checks:receipt.tests.length,cleanup:receipt.cleanup,error:receipt.error}));
 if(!receipt.passed)process.exitCode=1;
}
