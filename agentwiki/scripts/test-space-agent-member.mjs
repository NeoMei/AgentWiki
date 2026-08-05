import { chromium } from 'playwright';

const BASE = 'https://agentwiki.quukk.com';
const API = 'https://agentwiki.quukk.com/api';
const TEST_EMAIL = `vtest-${Date.now()}@t.local`;
const TEST_PASS = 'Test12345678';
const TEST_NAME = 'Visual Tester';
const SPACE_NAME = `V-Test-Space-${Date.now()}`;
const AGENT_NAME = `V-Test-Agent-${Date.now()}`;

let browser, page;

async function main() {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  // Step 1: Register via API (faster)
  console.log('1. Registering...');
  const regRes = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASS, name: TEST_NAME }),
  });
  const regData = await regRes.json();
  const token = regData.access_token;
  console.log(`   User: ${regData.user?.id} | token: ${token ? 'OK' : 'MISSING'}`);

  // Step 2: Create Space via API
  console.log('2. Creating space...');
  const spaceRes = await fetch(`${API}/spaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ name: SPACE_NAME }),
  });
  const space = await spaceRes.json();
  console.log(`   Space ID: ${space.id}`);

  // Step 3: Create Agent via API
  console.log('3. Creating agent...');
  const agentRes = await fetch(`${API}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ name: AGENT_NAME, provider: 'custom' }),
  });
  const agent = await agentRes.json();
  console.log(`   Agent ID: ${agent.id}`);

  // Step 4: Navigate to Space Members page
  console.log('4. Navigating to space members page...');
  // First login via browser
  await page.goto(`${BASE}/?intent=workspace#login`);
  await page.waitForTimeout(1000);
  // Fill login form
  await page.fill('input[type="email"]', TEST_EMAIL);
  await page.fill('input[type="password"]', TEST_PASS);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
  console.log(`   Login URL: ${page.url()}`);

  // Navigate to space members
  await page.goto(`${BASE}/spaces/${space.id}/members`);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/vtest-members-list.png', fullPage: true });
  console.log('   Screenshot: /tmp/vtest-members-list.png');

  // Step 5: Open Add Member dialog
  console.log('5. Opening add member dialog...');
  const addBtn = page.locator('button').filter({ hasText: /add|添加|邀请|invite/i }).first();
  if (await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await addBtn.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/tmp/vtest-add-member-dialog.png' });
    console.log('   Screenshot: /tmp/vtest-add-member-dialog.png');

    // Look for agent/user tab
    const agentTab = page.locator('button, [role="tab"]').filter({ hasText: /agent|智能体|bot/i }).first();
    if (await agentTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await agentTab.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: '/tmp/vtest-add-agent-tab.png' });
      console.log('   Screenshot: /tmp/vtest-add-agent-tab.png');
    }
  } else {
    // Try API instead
    console.log('   Add button not found, testing via API...');
    const addRes = await fetch(`${API}/spaces/${space.id}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ agentId: agent.id, role: 'editor' }),
    });
    const addData = await addRes.json();
    console.log(`   API add result: ${JSON.stringify(addData).slice(0, 100)}`);

    // Verify member list
    const membersRes = await fetch(`${API}/spaces/${space.id}/members`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const members = await membersRes.json();
    const found = Array.isArray(members) && members.some(m => m.agentId === agent.id);
    console.log(`   Agent in members: ${found ? 'PASS' : 'FAIL'}`);
  }

  // Step 6: Mobile viewport test
  console.log('6. Mobile viewport test...');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/spaces/${space.id}/members`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '/tmp/vtest-members-mobile.png', fullPage: true });
  console.log('   Screenshot: /tmp/vtest-members-mobile.png');

  // Cleanup
  await fetch(`${API}/agents/${agent.id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
  await fetch(`${API}/spaces/${space.id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });

  console.log('\n=== VISUAL VERIFICATION COMPLETE ===');
  await browser.close();
}

main().catch(err => {
  console.error('TEST FAILED:', err.message);
  process.exit(1);
});
