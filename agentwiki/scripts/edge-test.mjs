const API = 'https://agentwiki.quukk.com/api';
let pass = 0, fail = 0;
const T = (name, ok, d) => {
  if (ok) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; console.log(`  FAIL: ${name}${d ? ' ' + d : ''}`); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function r(path, opts = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${API}${path}`, {
      headers: { 'Content-Type': 'application/json', ...opts.headers },
      ...opts,
      headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const t = await res.text();
    const d = JSON.parse(t);
    if (d.statusCode === 429) { await sleep(3000); continue; }
    return { s: res.status, d };
  }
  return { s: 429, d: {message: 'rate limited'} };
}

async function main() {
  console.log('=== Edge Case Tests ===\n');
  const email = `edge-${Date.now()}@t.local`, pw = 'EdgeTest123!';
  await sleep(2000);

  let reg = await r('/auth/register', { method:'POST', body:JSON.stringify({email,password:pw,name:'Edge'}) });
  const token = reg.d?.access_token;
  T('Register', !!token);

  await sleep(300);
  let weak = await r('/auth/register', { method:'POST', body:JSON.stringify({email:`wp-${Date.now()}@t.local`,password:'123',name:'WP'}) });
  T('Weak password rejected', weak.s !== 201 && weak.s !== 200, `status=${weak.s}`);

  await sleep(300);
  let noName = await r('/auth/register', { method:'POST', body:JSON.stringify({email:`nn-${Date.now()}@t.local`,password:'Test12345678',name:''}) });
  T('Empty name rejected', noName.s !== 201 && noName.s !== 200, `status=${noName.s}`);

  await sleep(300);
  let badEmail = await r('/auth/register', { method:'POST', body:JSON.stringify({email:'notanemail',password:'Test12345678',name:'BE'}) });
  T('Invalid email rejected', badEmail.s !== 201 && badEmail.s !== 200, `status=${badEmail.s}`);

  let emptySpace = await r('/spaces', { method:'POST', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({name:''}) });
  T('Empty space name rejected', emptySpace.s !== 201 && emptySpace.s !== 200, `status=${emptySpace.s}`);

  let space = await r('/spaces', { method:'POST', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({name:'EdgeSpace'}) });
  const sid = space.d?.id;
  T('Create space', !!sid);

  let emptyPage = await r('/pages', { method:'POST', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({spaceId:sid,title:'',content:'test'}) });
  T('Empty page title rejected', emptyPage.s !== 201 && emptyPage.s !== 200, `status=${emptyPage.s}`);

  let noSpace = await r('/pages', { method:'POST', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({title:'NoSpace',content:'test'}) });
  T('Missing spaceId rejected', noSpace.s !== 201 && noSpace.s !== 200, `status=${noSpace.s}`);

  let page = await r('/pages', { method:'POST', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({spaceId:sid,title:'EdgePage',content:'# Test'}) });
  const pid = page.d?.id;
  T('Create page', !!pid);

  let badLock = await r(`/pages/${pid}`, { method:'PATCH', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({content:'# Bad',expectedUpdatedAt:'2000-01-01T00:00:00.000Z'}) });
  T('Optimistic lock enforced', badLock.s !== 200, `status=${badLock.s}`);

  let current = await r(`/pages/${pid}`, { headers:{'Authorization':`Bearer ${token}`} });
  let uat = current.d?.updatedAt;
  let up1 = await r(`/pages/${pid}`, { method:'PATCH', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({content:'# Update 1',expectedUpdatedAt:uat}) });
  let up2 = await r(`/pages/${pid}`, { method:'PATCH', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({content:'# Update 2',expectedUpdatedAt:uat}) });
  T('Concurrent update handled', (up1.s === 200) !== (up2.s === 200), `s1=${up1.s} s2=${up2.s}`);

  let unAuth = await r('/spaces', { headers:{} });
  T('Unauthenticated rejected', unAuth.s === 401, `status=${unAuth.s}`);

  let agent = await r('/agents', { method:'POST', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({name:'EdgeAgent'}) });
  const aid = agent.d?.id;
  if (aid) {
    await r(`/agents/${aid}/grants/${sid}`, { method:'PUT', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({role:'editor',scopes:['pages:write']}) });
    let cred = await r(`/agents/${aid}/credentials`, { method:'POST', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({name:'edge-key',scopes:['pages:write']}) });
    let agentKey = cred.d?.apiKey;
    if (agentKey) {
      let agentPages = await r(`/pages?spaceId=${sid}`, { headers:{'Authorization':`Bearer ${agentKey}`} });
      T('Agent without pages:read denied', agentPages.s !== 200, `status=${agentPages.s}`);
    } else {
      T('Agent credential', false, 'cred creation failed');
    }
  }

  let largeContent = 'x'.repeat(500000);
  let largePayload = await r('/pages', { method:'POST', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({spaceId:sid,title:'Large',content:largeContent}) });
  T('Large payload handled gracefully', largePayload.s < 500, `status=${largePayload.s}`);

  let email2 = `edge2-${Date.now()}@t.local`;
  await sleep(500);
  let reg2 = await r('/auth/register', { method:'POST', body:JSON.stringify({email:email2,password:'Test12345678',name:'Edge2'}) });
  let token2 = reg2.d?.access_token;
  if (token2) {
    let accessOthers = await r(`/spaces/${sid}/members`, { headers:{'Authorization':`Bearer ${token2}`} });
    T('Cross-user access denied', accessOthers.s !== 200, `status=${accessOthers.s}`);
  }

  let ghost = await r('/pages/nonexistent123', { headers:{'Authorization':`Bearer ${token}`} });
  T('404 for missing page', ghost.s === 404, `status=${ghost.s}`);

  let page2 = await r('/pages', { method:'POST', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({spaceId:sid,title:'Child',content:'# Child',parentId:pid}) });
  if (page2.d?.id) {
    let cycle = await r(`/pages/${pid}`, { method:'PATCH', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({parentId:page2.d.id,expectedUpdatedAt:uat}) });
    T('Cycle prevention', cycle.s !== 200, `status=${cycle.s}`);
  }

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
