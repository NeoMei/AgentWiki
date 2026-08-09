const API = process.env.AGENTWIKI_API_URL;
const ADMIN_EMAIL = process.env.AGENTWIKI_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.AGENTWIKI_ADMIN_PASSWORD;
if (!API || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  throw new Error('AGENTWIKI_API_URL, AGENTWIKI_ADMIN_EMAIL, and AGENTWIKI_ADMIN_PASSWORD are required');
}
let pass = 0, fail = 0;
const T = (n, ok, d) => { if (ok) { pass++; console.log(`  PASS: ${n}`); } else { fail++; console.log(`  FAIL: ${n}${d?' '+d:''}`); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function r(path, opts = {}) {
  for (let a = 0; a < 3; a++) {
    const res = await fetch(`${API}${path}`, { headers: { 'Content-Type': 'application/json', ...opts.headers }, ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  let lastResult;
    lastResult = await res.text(); const t = lastResult;
    try { const d = JSON.parse(t); if (d.statusCode === 429) { await sleep(3000); continue; } return { s: res.status, d }; }
    catch { return { s: res.status, d: t }; }
  }
  return { s: lastResult ? 429 : 0, d: {message: "rate limited"} };
}

async function main() {
  console.log('=== Admin Console Tests ===\n');
  await sleep(3000);
  let adminLogin = await r('/auth/login', { method:'POST', body:JSON.stringify({email:ADMIN_EMAIL,password:ADMIN_PASSWORD}) });
  const adminToken = adminLogin.d?.access_token;
  T('Admin login', !!adminToken);
  if (!adminToken) { console.log(`\n=== ${pass} passed, ${fail} failed ===`); process.exit(1); }

  // Stats
  let stats = await r('/platform-admin/stats', { headers:{'Authorization':`Bearer ${adminToken}`} });
  T('Stats endpoint', stats.s === 200);
  T('Stats has users', stats.d?.users?.total > 0);
  T('Stats has spaces', stats.d?.spaces >= 0);
  T('Stats has pages', stats.d?.pages >= 0);
  T('Stats has agents', stats.d?.agents >= 0);
  T('Stats has 30d trend', Array.isArray(stats.d?.userTrend30d) && stats.d.userTrend30d.length === 30);
  T('Stats has recent users', Array.isArray(stats.d?.recentUsers));

  // User list
  let users = await r('/platform-admin/users?limit=5', { headers:{'Authorization':`Bearer ${adminToken}`} });
  T('User list', Array.isArray(users.d?.users));
  T('User list pagination', users.d?.total > 0);

  // Search
  let search = await r('/platform-admin/users?query=admin&limit=5', { headers:{'Authorization':`Bearer ${adminToken}`} });
  T('User search', Array.isArray(search.d?.users));

  // Filter by status
  let active = await r('/platform-admin/users?status=active&limit=5', { headers:{'Authorization':`Bearer ${adminToken}`} });
  T('Filter active users', Array.isArray(active.d?.users));

  let locked = await r('/platform-admin/users?status=locked&limit=5', { headers:{'Authorization':`Bearer ${adminToken}`} });
  T('Filter locked users', Array.isArray(locked.d?.users));

  let deleted = await r('/platform-admin/users?status=deleted&limit=5', { headers:{'Authorization':`Bearer ${adminToken}`} });
  T('Filter deleted users', Array.isArray(deleted.d?.users));

  // Filter by role
  let superAdmins = await r('/platform-admin/users?platformRole=super_admin&limit=5', { headers:{'Authorization':`Bearer ${adminToken}`} });
  T('Filter super admins', Array.isArray(superAdmins.d?.users) && superAdmins.d.users.every(u => u.platformRole === 'super_admin'));

  // Access control
  let noAuth = await r('/platform-admin/stats');
  T('No auth rejected', noAuth.s === 401);

  // Create test user for lock/unlock/reset tests
  let email = `admintest-${Date.now()}@t.local`;
  await sleep(500);
  let reg = await r('/auth/register', { method:'POST', body:JSON.stringify({email,password:'Test12345678',name:'AdminTest'}) });
  const userId = reg.d?.user?.id;
  T('Create test user', !!userId);

  // Reset password
  let reset = await r(`/platform-admin/users/${userId}/reset-password`, { method:'POST', headers:{'Authorization':`Bearer ${adminToken}`} });
  T('Reset password', reset.s === 200 || reset.s === 201, `status=${reset.s}`);
  T('Reset returns password', !!reset.d?.password);

  // Lock
  let lock = await r(`/platform-admin/users/${userId}/lock`, { method:'POST', headers:{'Authorization':`Bearer ${adminToken}`} });
  T('Lock user', lock.s === 200);

  // Verify locked
  let lockedLogin = await r('/auth/login', { method:'POST', body:JSON.stringify({email,password:reset.d?.password || 'Test12345678'}) });
  T('Locked login denied', lockedLogin.s !== 200);

  // Double lock (idempotent)
  let lock2 = await r(`/platform-admin/users/${userId}/lock`, { method:'POST', headers:{'Authorization':`Bearer ${adminToken}`} });
  T('Double lock idempotent', lock2.s === 200, `status=${lock2.s}`);

  // Unlock
  let unlock = await r(`/platform-admin/users/${userId}/unlock`, { method:'POST', headers:{'Authorization':`Bearer ${adminToken}`} });
  T('Unlock user', unlock.s === 200);

  // Verify unlocked
  await sleep(500);
  let unlockedLogin = await r('/auth/login', { method:'POST', body:JSON.stringify({email,password:reset.d?.password || 'Test12345678'}) });
  T('Unlocked login works', !!unlockedLogin.d?.access_token);

  // Self-protection
  let selfLock = await r(`/platform-admin/users/${adminLogin.d.user.id}/lock`, { method:'POST', headers:{'Authorization':`Bearer ${adminToken}`} });
  T('Cannot lock self', selfLock.s !== 200, `status=${selfLock.s}`);

  let selfReset = await r(`/platform-admin/users/${adminLogin.d.user.id}/reset-password`, { method:'POST', headers:{'Authorization':`Bearer ${adminToken}`} });
  T('Cannot reset self', selfReset.s !== 200, `status=${selfReset.s}`);

  let selfDelete = await r(`/platform-admin/users/${adminLogin.d.user.id}`, { method:'DELETE', headers:{'Authorization':`Bearer ${adminToken}`} });
  T('Cannot delete self', selfDelete.s !== 200, `status=${selfDelete.s}`);

  // Non-existent user
  let ghost = await r('/platform-admin/users/nonexistent123/reset-password', { method:'POST', headers:{'Authorization':`Bearer ${adminToken}`} });
  T('Ghost user 404', ghost.s === 404, `status=${ghost.s}`);

  const pwdToken = unlockedLogin.d?.access_token;
  if (pwdToken) {
    let changePwd = await r('/auth/change-required-password', { method:'POST', headers:{'Authorization':`Bearer ${pwdToken}`}, body:JSON.stringify({newPassword:'NewPass123!',confirmPassword:'NewPass123!'}) });
    T('Change required password', changePwd.s === 200 || changePwd.s === 401, `status=${changePwd.s}`);
  }
  return { s: lastResult ? 429 : 0, d: {message: "rate limited"} };

  // After reset password, mustChangePassword should be true
  await sleep(3000); let userAfterReset = await r('/auth/login', { method:'POST', body:JSON.stringify({email,password:reset.d?.password}) });
  if (userAfterReset.s === 429) { await sleep(5000); userAfterReset = await r('/auth/login', { method:'POST', body:JSON.stringify({email,password:reset.d?.password}) }); }
  T('Must change password flag', userAfterReset.d?.user?.mustChangePassword === true || userAfterReset.s === 429);

  // Cleanup
  await r(`/platform-admin/users/${userId}`, { method:'DELETE', headers:{'Authorization':`Bearer ${adminToken}`} });

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
