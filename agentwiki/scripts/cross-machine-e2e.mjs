const API = 'https://agentwiki.quukk.com/api';

async function req(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  });
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; } catch { return { status: res.status, text }; }
}

const OK = '\x1b[32mPASS\x1b[0m', FAIL = '\x1b[31mFAIL\x1b[0m';

async function main() {
  const email = `e2e-${Date.now()}@t.local`;
  const reg = await req('/auth/register', { method: 'POST', body: JSON.stringify({ email, password: 'Test12345678', name: 'E2E' }) });
  const token = reg.data.access_token;
  const space = await req('/spaces', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ name: `E2E-${Date.now()}` }) });
  const spaceId = space.data.id;
  const agent = await req('/agents', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ name: 'E2E-Agent' }) });
  const agentId = agent.data.id;
  console.log(`Setup: space=${spaceId?.slice(0,12)} agent=${agentId?.slice(0,12)}`);

  // Grant with all needed scopes
  await req(`/agents/${agentId}/grants/${spaceId}`, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ role: 'editor', scopes: ['pages:read', 'pages:write', 'review:auto-publish'] }) });
  await req(`/spaces/${spaceId}`, { method: 'PATCH', headers: { 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ approvalPolicy: 'scoped-auto-publish' }) });
  await req(`/agents/${agentId}`, { method: 'PATCH', headers: { 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ approvalMode: 'scoped-auto-publish' }) });
  const cred = await req(`/agents/${agentId}/credentials`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ name: 'e2e-key', scopes: ['pages:read', 'pages:write', 'review:auto-publish'] }) });
  const agentKey = cred.data.apiKey;
  console.log(`Agent key: ${agentKey.slice(0,15)}...`);

  // Machine A: create pages
  console.log('\n--- Machine A pushes ---');
  const p1 = await req('/pages', { method: 'POST', headers: { 'Authorization': `Bearer ${agentKey}` }, body: JSON.stringify({ spaceId, title: 'Machine A Page', content: '# Machine A\n\nContent from machine A.\n\n## Section\n\nDetails.' }) });
  console.log(`Create page 1: ${p1.data.id ? OK : FAIL}`);
  const p2 = await req('/pages', { method: 'POST', headers: { 'Authorization': `Bearer ${agentKey}` }, body: JSON.stringify({ spaceId, title: 'Shared Page', content: '# Shared\n\nOriginal from A.' }) });
  console.log(`Create page 2: ${p2.data.id ? OK : FAIL}`);

  // Machine B: read & update
  console.log('\n--- Machine B reads & updates ---');
  const pagesRes = await req(`/pages?spaceId=${spaceId}`, { headers: { 'Authorization': `Bearer ${token}` } });
  const pages = Array.isArray(pagesRes.data) ? pagesRes.data : (pagesRes.data?.data || pagesRes.data?.pages || []);
  console.log(`Read ${pages.length} pages: ${pages.length === 2 ? OK : FAIL}`);
  
  const shared = pages.find(p => p.title === 'Shared Page');
  if (shared) {
    const upd = await req(`/pages/${shared.id}`, { method: 'PATCH', headers: { 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ content: '# Shared\n\nUpdated from Machine B!', expectedUpdatedAt: shared.updatedAt }) });
    console.log(`Update page: ${upd.data.id ? OK : FAIL}`);
  }

  // Agent re-reads to verify cross-machine visibility
  console.log('\n--- Cross-machine verify ---');
  if (shared) {
    const reread = await req(`/pages/${shared.id}`, { headers: { 'Authorization': `Bearer ${agentKey}` } });
    const hasUpdate = reread.data?.content?.includes('Machine B');
    console.log(`Agent sees B update: ${hasUpdate ? OK : FAIL}`);
  }

  // Knowledge submission
  console.log('\n--- Knowledge submission ---');
  const bundle = { schemaVersion: '1.0.0', recipeVersion: 'code-wiki@1', pages: [{ path: 'pages/test-kb.md', title: 'Test KB', body: '# Test KB\n\nSynced knowledge.', order: 0 }], memories: [], relations: [], provenance: [{ adapter: 'manual', timestamp: new Date().toISOString() }] };
  const body = Buffer.from(JSON.stringify(bundle)).toString('base64');
  const sub = await req(`/spaces/${spaceId}/knowledge-submissions`, { method: 'POST', headers: { 'Authorization': `Bearer ${agentKey}`, 'x-agentwiki-user-confirmed': 'true' }, body: JSON.stringify({ body, idempotencyKey: `e2e-${Date.now()}` }) });
  console.log(`Submit: ${sub.status === 202 ? OK : FAIL + ' ' + sub.status + ' ' + JSON.stringify(sub.data).slice(0, 150)}`);

  if (sub.status === 202) {
    await new Promise(r => setTimeout(r, 4000));
    const after = await req(`/pages?spaceId=${spaceId}`, { headers: { 'Authorization': `Bearer ${token}` } });
    const afterList = Array.isArray(after.data) ? after.data : (after.data?.data || after.data?.pages || []);
    console.log(`After sync: ${afterList.length} pages, "Test KB": ${afterList.some(p => p.title === 'Test KB') ? OK : FAIL}`);
    const rev = await req(`/spaces/${spaceId}/knowledge-revisions/current`, { headers: { 'Authorization': `Bearer ${token}` } });
    console.log(`Revision: seq=${rev.data?.sequence || 0} ${rev.data?.sequence > 0 ? OK : 'INFO (expected 0 for knowledge sub)'}`);
  }

  console.log('\n=== E2E COMPLETE ===');
}

main().catch(err => { console.error('FAILED:', err.message); process.exit(1); });
