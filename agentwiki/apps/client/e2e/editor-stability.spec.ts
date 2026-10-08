import { expect, test } from '@playwright/test';

const fixtureURL = '/e2e/fixtures/editor-stability.html';
const version = '2026-10-08T00:00:00.000Z';
const summary = { id: 'fixture-session', spaceId: 'fixture-space', title: 'Local conversation', createdAt: version, updatedAt: version };
const history = Array.from({ length: 30 }, (_, i) => ({ id: `turn-${i}`, sessionId: summary.id, pageId: 'fixture-page', mode: 'question', intent: `Question ${i}`, status: 'done', createdAt: version, references: [], noteIds: [], progressText: '', result: { summary: `Answer ${i}. ${'Long history line. '.repeat(20)}` }, error: null }));

test.beforeEach(async ({ page }) => {
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/assist/sessions') return route.fulfill({ json: [summary] });
    if (path === `/api/assist/sessions/${summary.id}`) return route.fulfill({ json: { ...summary, turns: history } });
    if (path.endsWith('/markdown/resolve')) return route.fulfill({ json: route.request().postDataJSON().references.map((reference: any) => ({ key: reference.key, status: 'resolved', kind: 'page', pageId: 'fixture-authorized-target', title: 'Target', slug: 'target' })) });
    return route.fulfill({ json: { results: [] } });
  });
});

for (const width of [900, 1440]) for (const panel of [true, false]) {
  test(`long Markdown stays stable at ${width}px, collaboration panel ${panel}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(fixtureURL);
    await page.waitForFunction(() => (window as any).editorFixture);
    await page.evaluate((open) => (window as any).editorFixture.panel(open), panel);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => (window as any).editorFixture.parsed())).toBe(true);
    const baseline = await page.evaluate(() => (window as any).editorFixture.metrics());
    expect(baseline.doc.length).toBeGreaterThan(50000);
    const offset = baseline.doc.indexOf('Paragraph 160');
    await page.evaluate((offset) => (window as any).editorFixture.reveal(offset), offset);
    await page.waitForTimeout(500);
    // Crossing headings drives the actual outline scroll handler and React state.
    await page.mouse.move(250, 400); await page.mouse.wheel(0, 180); await page.waitForTimeout(250); await page.mouse.wheel(0, -180);
    await page.waitForTimeout(500);
    const scrollFrames = await page.evaluate(async (offset) => {
      const api = (window as any).editorFixture, first = api.metrics(), frames = [];
      for (let i = 0; i < 70; i++) {
        if (i < 5) api.rerender();
        await new Promise(requestAnimationFrame);
        const metrics = api.metrics();
        frames.push({ y: api.anchor(offset), tree: metrics.treeLength, configurations: metrics.reconfigurations, markers: metrics.decorations, scrollY: metrics.scrollY, editorScroll: metrics.editorScroll });
      }
      return { first, last: api.metrics(), frames };
    }, offset);
    const ys = scrollFrames.frames.map((frame: any) => frame.y).filter((y: unknown) => typeof y === 'number');
    expect(ys.length).toBe(70);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(2);
    expect(scrollFrames.last.doc).toBe(baseline.doc);
    expect(scrollFrames.last.selection).toEqual(baseline.selection);
    expect(scrollFrames.last.reconfigurations).toBe(scrollFrames.first.reconfigurations);
    expect(scrollFrames.frames.every((frame: any) => frame.tree === baseline.doc.length)).toBe(true);
    expect(new Set(scrollFrames.frames.map((frame: any) => frame.markers)).size).toBe(1);
    await page.evaluate((offset) => (window as any).editorFixture.move(offset + 5), offset);
    await page.locator('.cm-content').focus();
    await page.waitForTimeout(500);
    const selectionFrames = await page.evaluate(async (offset) => {
      const api = (window as any).editorFixture, before = api.metrics(), frames = [];
      for (let i = 0; i < 70; i++) {
        if (i < 20) api.move(offset + 5 + (i % 2));
        await new Promise(requestAnimationFrame);
        const metrics = api.metrics(); frames.push({ y: api.anchor(offset), tree: metrics.treeLength, configurations: metrics.reconfigurations, markers: metrics.decorations });
      }
      return { before, after: api.metrics(), frames };
    }, offset);
    const selectionYs = selectionFrames.frames.map((frame: any) => frame.y);
    expect(Math.max(...selectionYs) - Math.min(...selectionYs)).toBeLessThanOrEqual(2);
    expect(selectionFrames.after.reconfigurations).toBe(selectionFrames.before.reconfigurations);
    expect(selectionFrames.after.undo).toBe(selectionFrames.before.undo);
    expect(selectionFrames.frames.every((frame: any) => frame.tree === baseline.doc.length)).toBe(true);
    expect(new Set(selectionFrames.frames.map((frame: any) => frame.markers)).size).toBe(1);
    // Actual browser typing on the deep source line, followed by a single isolated candidate replacement.
    const insertAt = selectionFrames.after.selection.ranges[0].anchor;
    const input = '连续中文abcdefghij123456';
    const inputFrames = [];
    for (const character of input) {
      await page.keyboard.insertText(character);
      const metrics = await page.evaluate(() => (window as any).editorFixture.metrics());
      inputFrames.push({ treeLength: metrics.treeLength, docLength: metrics.doc.length, reconfigurations: metrics.reconfigurations });
      expect(metrics.languageStable).toBe(true);
      expect(metrics.treeLength).toBeGreaterThan(metrics.doc.length / 2);
    }
    await page.keyboard.press('Enter'); await page.keyboard.press('Backspace');
    await page.waitForTimeout(300);
    const typed = await page.evaluate(() => (window as any).editorFixture.metrics());
    expect(typed.doc).toBe(baseline.doc.slice(0, insertAt) + input + baseline.doc.slice(insertAt));
    expect(typed.languageStable).toBe(true);
    expect(typed.treeLength).toBeGreaterThan(typed.doc.length / 2);
    const caret = await page.evaluate(() => { const api = (window as any).editorFixture; return api.anchor(api.metrics().selection.ranges[0].anchor); });
    expect(caret).toBeGreaterThanOrEqual(0); expect(caret).toBeLessThan(800);
    await page.evaluate(() => (window as any).editorFixture.replace('Local candidate text'));
    await page.evaluate(() => (window as any).editorFixture.undo());
    expect((await page.evaluate(() => (window as any).editorFixture.metrics())).doc).toBe(typed.doc);
    await page.evaluate(() => (window as any).editorFixture.redo());
    expect((await page.evaluate(() => (window as any).editorFixture.metrics())).doc).toBe('Local candidate text');
    await page.evaluate(() => (window as any).editorFixture.undo());
    await page.evaluate(() => (window as any).editorFixture.pages());
    await page.waitForTimeout(100);
    expect((await page.evaluate(() => (window as any).editorFixture.metrics())).languageStable).toBe(true);
    await testInfo.attach('geometry.json', { body: JSON.stringify({ browser: page.context().browser()?.version(), viewport: { width, height: 800 }, panel, sourceLength: baseline.doc.length, editorWidth: baseline.width, scrollFrames, selectionFrames, inputFrames, typed }, null, 2), contentType: 'application/json' });
  });
}

test('plain long-document control retains source and scroll anchor', async ({ page }) => {
  await page.goto(fixtureURL); await page.waitForFunction(() => (window as any).editorFixture);
  await page.evaluate(() => (window as any).editorFixture.plain()); await page.waitForTimeout(300);
  await page.evaluate(() => (window as any).editorFixture.parsed());
  const before = await page.evaluate(() => (window as any).editorFixture.metrics());
  const offset = before.doc.indexOf('Plain paragraph 1000');
  await page.evaluate((offset) => (window as any).editorFixture.reveal(offset), offset); await page.waitForTimeout(500);
  const frames = await page.evaluate(async (offset) => {
    const api = (window as any).editorFixture, ys = [];
    for (let i = 0; i < 70; i++) { if (i < 5) api.rerender(); await new Promise(requestAnimationFrame); ys.push(api.anchor(offset)); }
    return { ys, after: api.metrics() };
  }, offset);
  expect(Math.max(...frames.ys) - Math.min(...frames.ys)).toBeLessThanOrEqual(2);
  expect(frames.after.doc).toBe(before.doc); expect(frames.after.languageStable).toBe(true);
});

test('real conversation viewport follows Send and streaming, while preserving older history', async ({ page }, testInfo) => {
  let turns = [...history];
  await page.route((url) => url.pathname.startsWith(`/api/assist/sessions/${summary.id}`), async (route) => {
    if (route.request().method() === 'POST') {
      const turn = { ...history[0], id: 'new-turn', intent: 'Local follow-up', status: 'running', result: null, progressText: 'Streaming' };
      turns = [...turns, turn as any]; return route.fulfill({ json: turn });
    }
    return route.fulfill({ json: { ...summary, turns } });
  });
  await page.goto(fixtureURL); await page.getByText('Answer 29.', { exact: false }).waitFor();
  const viewport = page.locator('.agent-session-turns');
  const metrics = () => viewport.evaluate((element) => ({ top: element.scrollTop, height: element.scrollHeight, client: element.clientHeight }));
  await expect.poll(async () => { const m = await metrics(); return m.height - m.client - m.top; }).toBeLessThanOrEqual(1);
  await viewport.evaluate((element) => { element.scrollTop = 120; element.dispatchEvent(new Event('scroll')); });
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Local follow-up'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await page.getByText('Streaming', { exact: true }).waitFor();
  await expect.poll(async () => { const m = await metrics(); return m.height - m.client - m.top; }).toBeLessThanOrEqual(1);
  const sent = await metrics();
  turns = turns.map((turn) => turn.id === 'new-turn' ? { ...turn, progressText: 'Expanded streaming text. '.repeat(100) } : turn);
  await page.getByText('Expanded streaming text.', { exact: false }).waitFor();
  await expect.poll(async () => { const m = await metrics(); return m.height - m.client - m.top; }).toBeLessThanOrEqual(1);
  const streamed = await metrics();
  await viewport.evaluate((element) => { element.scrollTop = 120; element.dispatchEvent(new Event('scroll')); });
  turns = turns.map((turn) => turn.id === 'new-turn' ? { ...turn, status: 'done', result: { summary: 'Final answer. '.repeat(160) } } : turn);
  await page.getByText('Final answer.', { exact: false }).waitFor();
  await page.waitForTimeout(250); const historical = await metrics(); expect(historical.top).toBe(120);
  await testInfo.attach('conversation-scroll.json', { body: JSON.stringify({ sent, streamed, historical }, null, 2), contentType: 'application/json' });
});


test('resolver scope changes update Wiki links without resetting the distant Markdown parser', async ({ page }, testInfo) => {
  await page.goto(fixtureURL); await page.waitForFunction(() => (window as any).editorFixture);
  await page.evaluate(() => (window as any).editorFixture.parsed());
  const source = (await page.evaluate(() => (window as any).editorFixture.metrics())).doc;
  const offset = source.indexOf('Paragraph 160');
  await page.evaluate((offset) => (window as any).editorFixture.reveal(offset), offset); await page.waitForTimeout(400);
  await page.evaluate(() => (window as any).editorFixture.scope('scope-a'));
  await page.locator('.cm-content a[href="/pages/fixture-authorized-target"]').first().waitFor();
  const resolved = await page.evaluate(() => (window as any).editorFixture.metrics());
  expect(resolved.languageStable).toBe(true); expect(resolved.treeLength).toBe(source.length);
  let release: (() => void) | undefined;
  const delayed = new Promise<void>((resolve) => { release = resolve; });
  await page.route((url) => url.pathname === '/api/spaces/scope-b/markdown/resolve', async (route) => {
    await delayed;
    return route.fulfill({ json: route.request().postDataJSON().references.map((reference: any) => ({ key: reference.key, status: 'resolved', kind: 'page', pageId: 'scope-b-target', title: 'Target', slug: 'target' })) });
  });
  await page.evaluate(() => (window as any).editorFixture.scope('scope-b'));
  await expect(page.locator('.cm-content a[href="/pages/fixture-authorized-target"]')).toHaveCount(0);
  const pending = await page.evaluate(() => (window as any).editorFixture.metrics());
  expect(pending.treeLength).toBe(source.length); expect(pending.languageStable).toBe(true);
  release!();
  await page.locator('.cm-content a[href="/pages/scope-b-target"]').first().waitFor();
  const updated = await page.evaluate(() => (window as any).editorFixture.metrics());
  expect(updated.doc).toBe(source); expect(updated.treeLength).toBe(source.length); expect(updated.languageStable).toBe(true);
  await testInfo.attach('resolver.json', { body: JSON.stringify({ resolved, pending, updated }, null, 2), contentType: 'application/json' });
});
