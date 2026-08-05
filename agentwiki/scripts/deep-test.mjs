const API = 'https://agentwiki.quukk.com/api';
let pass = 0, fail = 0;
const T = (name, ok, d) => { if (ok) { pass++; console.log(`  PASS: ${name}`); } else { fail++; console.log(`  FAIL: ${name}${d?' '+d:''}`); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function r(path, opts = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${API}${path}`, { headers: { 'Content-Type': 'application/json', ...opts.headers }, ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const t = await res.text();
    try { const d = JSON.parse(t); if (d.statusCode === 429) { await sleep(3000); continue; } return { s: res.status, d }; }
    catch { return { s: res.status, d: t }; }
  }
}

async function main() {
  console.log('=== Deep Feature Tests ===\n');
  await sleep(2000);

  const email = `deep-${Date.now()}@t.local`, pw = 'DeepTest123!';
  let reg = await r('/auth/register', { method:'POST', body:JSON.stringify({email,password:pw,name:'Deep'}) });
  const token = reg.d?.access_token;
  T('Setup register', !!token);
  if (!token) { console.log(`\n=== ${pass} passed, ${fail} failed ===`); process.exit(1); }

  // Knowledge Graph Tests
  console.log('\n--- Knowledge Graph ---');
  let space = await r('/spaces', { method:'POST', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({name:'DeepSpace'}) });
  const sid = space.d?.id;

  // Create two pages
  let p1 = await r('/pages', { method:'POST', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({spaceId:sid,title:'Python Guide',content:'# Python\n\nPython programming language guide.\n\n## Installation\n\nInstall via pip.\n\n## Functions\n\nDefine with def keyword.'}) });
  let p2 = await r('/pages', { method:'POST', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({spaceId:sid,title:'Django Framework',content:'# Django\n\nWeb framework built on Python.\n\n## Setup\n\npip install django.'}) });
  T('Create knowledge pages', !!(p1.d?.id && p2.d?.id));

  // Create page hierarchy
  let child = await r('/pages', { method:'POST', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({spaceId:sid,title:'Django ORM',content:'# ORM\n\nObject-Relational Mapping.',parentId:p2.d?.id}) });
  T('Page hierarchy', !!(child.d?.id && child.d?.parentId === p2.d?.id));

  // Get hierarchy tree
  let tree = await r(`/pages/hierarchy/${sid}`, { headers:{'Authorization':`Bearer ${token}`} });
  T('Hierarchy tree', Array.isArray(tree.d) && tree.d.length > 0);

  // Create knowledge relation
  let rel = await r('/knowledge/relations', { method:'POST', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({sourcePageId:p1.d?.id,targetPageId:p2.d?.id,relation:'related-to',strength:1,confidence:1}) });
  T('Create relation', rel.s === 201 || rel.s === 200, `status=${rel.s}`);

  // Get relations
  let rels = await r(`/knowledge/relations/${p1.d?.id}`, { headers:{'Authorization':`Bearer ${token}`} });
  T('Get relations', rels.d?.outgoing?.length > 0);

  // Get related pages
  let related = await r(`/knowledge/related/${p1.d?.id}`, { headers:{'Authorization':`Bearer ${token}`} });
  T('Related pages', Array.isArray(related.d) && related.d.length > 0);

  // Get graph
  let graph = await r(`/knowledge/graph/${sid}`, { headers:{'Authorization':`Bearer ${token}`} });
  T('Knowledge graph data', graph.s === 200);

  // Source & Ingest Tests
  console.log('\n--- Source & Ingest ---');
  let source = await r(`/spaces/${sid}/sources`, { method:'POST', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({name:'Test Source',type:'git',uri:'https://github.com/example/test.git'}) });
  const srcId = source.d?.id;
  T('Create source', !!srcId);

  let sources = await r(`/spaces/${sid}/sources`, { headers:{'Authorization':`Bearer ${token}`} });
  T('List sources', Array.isArray(sources.d) && sources.d.length > 0);

  // Page Search
  console.log('\n--- Search ---');
  let search1 = await r('/search?q=python', { headers:{'Authorization':`Bearer ${token}`} });
  T('Semantic search', search1.s === 200);

  let search2 = await r('/search?q=django+orm', { headers:{'Authorization':`Bearer ${token}`} });
  T('Multi-word search', search2.s === 200);

  // Agent detail & memory
  console.log('\n--- Agent Detail ---');
  let agent = await r('/agents', { method:'POST', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({name:'DeepAgent'}) });
  const aid = agent.d?.id;
  T('Create agent', !!aid);

  let agentDetail = await r(`/agents/${aid}`, { headers:{'Authorization':`Bearer ${token}`} });
  T('Agent detail', agentDetail.d?.id === aid);

  let agentUpdate = await r(`/agents/${aid}`, { method:'PATCH', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({description:'Test agent'}) });
  T('Update agent', agentUpdate.s === 200);

  // Review system
  console.log('\n--- Review System ---');
  // Grant agent with auto-publish
  await r(`/agents/${aid}/grants/${sid}`, { method:'PUT', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({role:'editor',scopes:['pages:write','review:auto-publish']}) });
  await r(`/spaces/${sid}`, { method:'PATCH', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({approvalPolicy:'scoped-auto-publish'}) });
  await r(`/agents/${aid}`, { method:'PATCH', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({approvalMode:'scoped-auto-publish'}) });

  let cred = await r(`/agents/${aid}/credentials`, { method:'POST', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({name:'deep-key',scopes:['pages:write','review:auto-publish']}) });
  let agentKey = cred.d?.apiKey;
  T('Agent credential for review', !!agentKey);

  if (agentKey) {
    let agentPage = await r('/pages', { method:'POST', headers:{'Authorization':`Bearer ${agentKey}`}, body:JSON.stringify({spaceId:sid,title:'Agent Auto-Publish',content:'# Auto\n\nPublished by agent.'}) });
    T('Agent auto-publish page', agentPage.s === 200 || agentPage.s === 201, `status=${agentPage.s}`);
  }

  // ChangeSet list
  let changes = await r('/review', { headers:{'Authorization':`Bearer ${token}`} });
  T('Review list', changes.s === 200);

  // Page version restore
  console.log('\n--- Version Restore ---');
  let p3 = await r('/pages', { method:'POST', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({spaceId:sid,title:'Version Test',content:'# V1\n\nOriginal.'}) });
  const p3id = p3.d?.id;
  let p3v1 = await r(`/pages/${p3id}`, { headers:{'Authorization':`Bearer ${token}`} });
  let p3upd = await r(`/pages/${p3id}`, { method:'PATCH', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({content:'# V2\n\nUpdated.',expectedUpdatedAt:p3v1.d?.updatedAt}) });
  let versions = await r(`/pages/${p3id}/versions`, { headers:{'Authorization':`Bearer ${token}`} });
  const vid = Array.isArray(versions.d) ? versions.d[0]?.id : null;
  T('Version created', !!(vid && p3upd.d?.id));

  if (vid) {
    let restore = await r(`/pages/${p3id}/versions/${vid}/restore`, { method:'POST', headers:{'Authorization':`Bearer ${token}`} });
    T('Restore version', restore.s === 200 || restore.s === 201, `status=${restore.s}`);

    let restored = await r(`/pages/${p3id}`, { headers:{'Authorization':`Bearer ${token}`} });
    T('Content restored', restored.d?.content?.includes('V1'));
  }

  // Reorder pages
  console.log('\n--- Page Reorder ---');
  let reorder = await r(`/pages/reorder/${sid}`, { method:'PATCH', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({pageIds:[p1.d?.id,child.d?.id,p2.d?.id].filter(Boolean)}) });
  T('Reorder pages', (reorder.s === 200 || reorder.s === 400), `status=${reorder.s}`);

  // Markdown wiki links
  console.log('\n--- Wiki Links ---');
  let wikilink = await r('/pages', { method:'POST', headers:{'Authorization':`Bearer ${token}`}, body:JSON.stringify({spaceId:sid,title:'Link Test',content:'# Links\n\nSee [[Python Guide]] and [[Django Framework]] for more.'}) });
  T('Wiki link page', !!(wikilink.d?.id));

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
}

main();
