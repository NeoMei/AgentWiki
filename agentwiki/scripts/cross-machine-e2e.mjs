const API = 'https://agentwiki.quukk.com/api';
const OK = '\x1b[32mPASS\x1b[0m', FAIL = '\x1b[31mFAIL\x1b[0m';

async function req(path, opts = {}) {
  const res = await fetch(`${API}${path}`, { headers: { 'Content-Type': 'application/json', ...opts.headers }, ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; } catch { return { status: res.status, text }; }
}

async function main() {
  console.log('=== Cross-Machine Sync E2E ===\n');
  const email = `e2e-${Date.now()}@t.local`;
  const reg = await req('/auth/register', { method: 'POST', body: JSON.stringify({ email, password: 'Test12345678', name: 'E2E' }) });
  const token = reg.data.access_token;
  const space = await req('/spaces', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ name: `E2E-${Date.now()}` }) });
  const spaceId = space.data.id;
  const agent = await req('/agents', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ name: 'E2E-Agent' }) });
  const agentId = agent.data.id;

  await req(`/agents/${agentId}/grants/${spaceId}`, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ role: 'editor', scopes: ['pages:read', 'pages:write', 'review:auto-publish'] }) });
  await req(`/spaces/${spaceId}`, { method: 'PATCH', headers: { 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ approvalPolicy: 'scoped-auto-publish' }) });
  await req(`/agents/${agentId}`, { method: 'PATCH', headers: { 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ approvalMode: 'scoped-auto-publish' }) });
  const cred = await req(`/agents/${agentId}/credentials`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ name: 'e2e-key', scopes: ['pages:read', 'pages:write', 'review:auto-publish'] }) });
  const agentKey = cred.data.apiKey;

  let allPass = true;

  // 1. Agent (Machine A) creates pages
  const p1 = await req('/pages', { method: 'POST', headers: { 'Authorization': `Bearer ${agentKey}` }, body: JSON.stringify({ spaceId, title: 'Machine A Page', content: '# Page A\n\nFrom machine A.' }) });
  const p2 = await req('/pages', { method: 'POST', headers: { 'Authorization': `Bearer ${agentKey}` }, body: JSON.stringify({ spaceId, title: 'Shared Page', content: '# Shared\n\nCreated by agent on A.' }) });
  const test1 = p1.data.id && p2.data.id;
  console.log(`1. Agent creates pages: ${test1 ? OK : FAIL}`);
  if (!test1) allPass = false;

  // 2. User (Machine B) reads pages
  const pagesRes = await req(`/pages?spaceId=${spaceId}`, { headers: { 'Authorization': `Bearer ${token}` } });
  const pages = Array.isArray(pagesRes.data) ? pagesRes.data : (pagesRes.data?.data || []);
  const test2 = pages.length === 2;
  console.log(`2. User reads pages: ${test2 ? OK : FAIL} (${pages.length} pages)`);
  if (!test2) allPass = false;

  // 3. User (Machine B) updates page
  const shared = pages.find(p => p.title === 'Shared Page');
  const upd = shared ? await req(`/pages/${shared.id}`, { method: 'PATCH', headers: { 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ content: '# Shared\n\nUpdated from Machine B!', expectedUpdatedAt: shared.updatedAt }) }) : { data: {} };
  const test3 = !!upd.data.id;
  console.log(`3. User updates page: ${test3 ? OK : FAIL}`);
  if (!test3) allPass = false;

  // 4. Agent re-reads to verify cross-machine sync
  const reread = shared ? await req(`/pages/${shared.id}`, { headers: { 'Authorization': `Bearer ${agentKey}` } }) : { data: {} };
  const test4 = reread.data?.content?.includes('Machine B');
  console.log(`4. Cross-machine sync: ${test4 ? OK : FAIL}`);
  if (!test4) allPass = false;

  // 5. Knowledge revision exists
  const rev = await req(`/spaces/${spaceId}/knowledge-revisions/current`, { headers: { 'Authorization': `Bearer ${token}` } });
  console.log(`5. Knowledge revisions: ${rev.data?.sequence !== undefined ? OK : FAIL} (seq=${rev.data?.sequence || 0})`);

  console.log(`\n=== ${allPass ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'} ===`);
}

main().catch(err => { console.error('FAILED:', err.message); process.exit(1); });
