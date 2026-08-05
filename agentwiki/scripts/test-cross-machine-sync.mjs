const API = 'https://agentwiki.quukk.com/api';

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

async function main() {
  // Step 1: Setup - Register, create space, create agent
  console.log('=== Step 1: Setup ===');
  const email = `cross-${Date.now()}@t.local`;
  const reg = await apiFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password: 'Test12345678', name: 'Cross Tester' }),
  });
  const token = reg.access_token;
  console.log(`   User: ${reg.user.id}`);

  const space = await apiFetch('/spaces', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ name: `CrossSync-${Date.now()}` }),
  });
  console.log(`   Space: ${space.id}`);

  const agent = await apiFetch('/agents', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ name: `CrossAgent`, provider: 'custom' }),
  });
  console.log(`   Agent: ${agent.id}`);

  // Add agent to space
  await apiFetch(`/spaces/${space.id}/members`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ agentId: agent.id, role: 'editor' }),
  });
  console.log('   Agent added to space');

  // Get credential
  const cred = await apiFetch(`/agents/${agent.id}/credentials`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ name: 'cross-key' }),
  });
  console.log(`   Credential: key=${cred.key?.slice(0, 12)}...`);

  // Step 2: Push knowledge via agent credential
  console.log('\n=== Step 2: Push knowledge from Machine A ===');
  const bundle = {
    schemaVersion: '1.0.0',
    recipeVersion: 'code-wiki@1',
    pages: [
      { path: 'pages/page-one.md', title: 'Machine A Page', body: '# Machine A Page\n\nContent from machine A.\n\n## Section 1\n\nA section 1.', order: 0 },
      { path: 'pages/page-two.md', title: 'Shared Page', body: '# Shared Page\n\nOriginal content.', order: 1 },
    ],
    memories: [],
    relations: [
      { sourcePath: 'pages/page-one.md', targetPath: 'pages/page-two.md', relationType: 'related', strength: 1, confidence: 1 },
    ],
    provenance: [{ adapter: 'manual', timestamp: new Date().toISOString() }],
  };

  const submitRes = await fetch(`${API}/spaces/${space.id}/knowledge-submissions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cred.key}`,
      'x-agentwiki-user-confirmed': 'true',
    },
    body: JSON.stringify({
      body: Buffer.from(JSON.stringify(bundle)).toString('base64'),
      idempotencyKey: `cross-${Date.now()}`,
    }),
  });
  const submitData = await submitRes.json();
  console.log(`   Submit: status=${submitRes.status} id=${submitData.id?.slice(0, 12)}...`);

  // Wait for processing
  await new Promise(r => setTimeout(r, 3000));

  // Step 3: Verify pages were created
  console.log('\n=== Step 3: Verify pages on Machine B ===');
  const pagesRes = await apiFetch('/pages', {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const spacePages = Array.isArray(pagesRes) ? pagesRes.filter(p => p.spaceId === space.id) : [];
  console.log(`   Pages: ${spacePages.length}`);
  for (const p of spacePages) {
    console.log(`     - ${p.title}: ${p.content?.slice(0, 50)}...`);
  }

  const titles = spacePages.map(p => p.title).sort();
  const expected = ['Machine A Page', 'Shared Page'];
  const allPages = expected.every(t => titles.includes(t));
  console.log(`   All pages synced: ${allPages ? 'PASS' : 'FAIL'}`);

  // Step 4: Verify relations
  console.log('\n=== Step 4: Verify relations ===');
  if (spacePages.length > 0) {
    const rels = await apiFetch(`/knowledge/relations/${spacePages[0].id}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const relCount = Array.isArray(rels) ? rels.length : 0;
    console.log(`   Relations: ${relCount} ${relCount > 0 ? 'PASS' : 'FAIL'}`);
  }

  // Step 5: Verify knowledge revision
  console.log('\n=== Step 5: Verify knowledge revision ===');
  const rev = await apiFetch(`/spaces/${space.id}/knowledge-revisions/current`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  console.log(`   Revision: seq=${rev.sequence} hash=${rev.contentHash?.slice(0, 16)}... ${rev.sequence > 0 ? 'PASS' : 'FAIL'}`);

  // Step 6: Update page from another "machine" (user B)
  console.log('\n=== Step 6: Update from Machine B ===');
  const shared = spacePages.find(p => p.title === 'Shared Page');
  if (shared) {
    const upd = await apiFetch(`/pages/${shared.id}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ content: '# Shared Page\n\nUpdated from Machine B.', expectedUpdatedAt: shared.updatedAt }),
    });
    console.log(`   Update: ${upd.id ? 'OK' : 'FAIL: ' + JSON.stringify(upd).slice(0, 80)}`);
  }

  console.log('\n=== CROSS-MACHINE SYNC TEST COMPLETE ===');
}

main().catch(err => {
  console.error('TEST FAILED:', err.message);
  process.exit(1);
});
