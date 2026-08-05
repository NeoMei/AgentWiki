const API = 'https://agentwiki.quukk.com/api';

async function r(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  });
  const t = await res.text();
  try { return { s: res.status, d: JSON.parse(t) }; } catch { return { s: res.status, d: t }; }
}

let pass = 0, fail = 0;
const T = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  PASS: ${name}${detail ? ' ' + detail : ''}`); }
  else { fail++; console.log(`  FAIL: ${name}${detail ? ' ' + detail : ''}`); }
};

async function main() {
  console.log('=== Health & Auth ===');
  let health = await r('/health');
  T('Health check', health.d?.status === 'ok');

  const email = `smoke-${Date.now()}@t.local`, pw = 'SmokeTest123!';
  let reg = await r('/auth/register', { method:'POST', body:JSON.stringify({email,password:pw,name:'Smoke'}) });
  const token = reg.d?.access_token;
  T('Register', !!token, token ? token.slice(0,20)+'...' : JSON.stringify(reg.d).slice(0,50));

  let login = await r('/auth/login', { method:'POST', body:JSON.stringify({email,password:pw}) });
  T('Login', !!login.d?.access_token && !login.d?.user?.mustChangePassword);

  let badLogin = await r('/auth/login', { method:'POST', body:JSON.stringify({email,password:'wrong'}) });
  T('Bad login rejected', badLogin.s === 400 || badLogin.s === 401, `status=${badLogin.s}`);

  let dupReg = await r('/auth/register', { method:'POST', body:JSON.stringify({email,password:pw,name:'Dup'}) });
  T('Duplicate register rejected', dupReg.s !== 200 && dupReg.s !== 201, `status=${dupReg.s}`);

  console.log('\n=== Space & Pages ===');
  let space = await r('/spaces', { method:'POST', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({name:`Smoke-${Date.now()}`}) });
  const sid = space.d?.id;
  T('Create space', !!sid, sid?.slice(0,12));

  let spaces = await r('/spaces', { headers:{'Authorization':`Bearer ${token}`} });
  T('List spaces', Array.isArray(spaces.d) || spaces.d?.data, `count=${Array.isArray(spaces.d) ? spaces.d.length : 'obj'}`);

  let page = await r('/pages', { method:'POST', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({spaceId:sid,title:'Smoke Page',content:'# Smoke\n\nTest content.'}) });
  const pid = page.d?.id;
  T('Create page', !!pid, pid?.slice(0,12));

  let pages = await r(`/pages?spaceId=${sid}`, { headers:{'Authorization':`Bearer ${token}`} });
  const plist = Array.isArray(pages.d) ? pages.d : (pages.d?.data||[]);
  T('List pages', plist.length >= 1, `count=${plist.length}`);

  let upd = await r(`/pages/${pid}`, { method:'PATCH', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({content:'# Updated\n\nNew content.',expectedUpdatedAt:plist[0]?.updatedAt}) });
  T('Update page', !!upd.d?.id);

  let getPage = await r(`/pages/${pid}`, { headers:{'Authorization':`Bearer ${token}`} });
  T('Get page', getPage.d?.content?.includes('Updated'));

  let ver = await r(`/pages/${pid}/versions`, { headers:{'Authorization':`Bearer ${token}`} });
  T('Page versions', Array.isArray(ver.d) && ver.d.length >= 1, `count=${Array.isArray(ver.d)?ver.d.length:'err'}`);

  let del = await r(`/pages/${pid}`, { method:'DELETE', headers:{'Authorization':`Bearer ${token}`} });
  T('Delete page', del.s === 200);

  console.log('\n=== Agent & Members ===');
  let agent = await r('/agents', { method:'POST', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({name:'SmokeAgent'}) });
  const aid = agent.d?.id;
  T('Create agent', !!aid, aid?.slice(0,12));

  let agents = await r('/agents', { headers:{'Authorization':`Bearer ${token}`} });
  T('List agents', Array.isArray(agents.d), `count=${Array.isArray(agents.d)?agents.d.length:'err'}`);

  let grant = await r(`/agents/${aid}/grants/${sid}`, { method:'PUT', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({role:'editor',scopes:['pages:read','pages:write']}) });
  T('Grant agent to space', grant.s === 200, `status=${grant.s}`);

  let cred = await r(`/agents/${aid}/credentials`, { method:'POST', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({name:'smoke-key',scopes:['pages:write']}) });
  T('Create credential', !!cred.d?.apiKey);

  console.log('\n=== Search & Knowledge ===');
  let search = await r('/search?q=test', { headers:{'Authorization':`Bearer ${token}`} });
  T('Search', search.s === 200);

  let graph = await r(`/knowledge/graph/${sid}`, { headers:{'Authorization':`Bearer ${token}`} });
  T('Knowledge graph', graph.s === 200);

  let related = await r(`/knowledge/related/${pid}`, { headers:{'Authorization':`Bearer ${token}`} });
  T('Related pages', related.s === 200 || related.s === 404);

  console.log('\n=== Profile ===');
  let me = await r('/users/me', { headers:{'Authorization':`Bearer ${token}`} });
  T('Get profile', me.d?.email === email);

  console.log('\n=== MCP ===');
  let mcp = await r('/integrations/mcp', { headers:{'Authorization':`Bearer ${token}`} });
  T('MCP integrations', mcp.s === 200);

  console.log('\n=== Admin Console ===');
  await new Promise(r => setTimeout(r, 3000)); let adminLogin = await r('/auth/login', { method:'POST', body:JSON.stringify({email:'admin@agentwiki.com',password:'AdminWiki@2026'}) });
  const adminToken = adminLogin.d?.access_token;
  
  if (adminToken) {
    T('Admin login', true);
    let stats = await r('/platform-admin/stats', { headers:{'Authorization':`Bearer ${adminToken}`} });
    T('Admin stats', stats.d?.users?.total > 0, `users=${stats.d?.users?.total}`);

    let users = await r('/platform-admin/users?limit=3', { headers:{'Authorization':`Bearer ${adminToken}`} });
    T('Admin list users', Array.isArray(users.d?.users) && users.d?.users.length > 0);

    let lockTest = await r(`/platform-admin/users/${reg.d.user.id}/lock`, { method:'POST', headers:{'Authorization':`Bearer ${adminToken}`} });
    T('Lock user', lockTest.s === 200);

    let lockedLogin = await r('/auth/login', { method:'POST', body:JSON.stringify({email,password:pw}) });
    T('Locked user rejected', lockedLogin.s !== 200, `status=${lockedLogin.s}`);

    let unlock = await r(`/platform-admin/users/${reg.d.user.id}/unlock`, { method:'POST', headers:{'Authorization':`Bearer ${adminToken}`} });
    T('Unlock user', unlock.s === 200);

    let relogin = await r('/auth/login', { method:'POST', body:JSON.stringify({email,password:pw}) });
    T('Unlocked user can login', !!relogin.d?.access_token);

    // Test self-operation protection
    let selfLock = await r(`/platform-admin/users/${adminLogin.d.user.id}/lock`, { method:'POST', headers:{'Authorization':`Bearer ${adminToken}`} });
    T('Cannot lock self', selfLock.s !== 200, `status=${selfLock.s}`);

    // Test non-admin access
    let normalStats = await r('/platform-admin/stats', { headers:{'Authorization':`Bearer ${token}`} });
    T('Non-admin denied', normalStats.s === 403 || normalStats.s === 401, `status=${normalStats.s}`);
  } else {
    T('Admin login', false, JSON.stringify(adminLogin.d).slice(0,60));
  }

  // Cleanup
  await r(`/spaces/${sid}`, { method:'DELETE', headers:{'Authorization':`Bearer ${token}`} });
  await r(`/agents/${aid}`, { method:'DELETE', headers:{'Authorization':`Bearer ${token}`} });

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
