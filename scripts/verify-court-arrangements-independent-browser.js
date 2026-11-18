async (page) => {
  const base = 'http://127.0.0.1:8787';
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  assert(page.url().startsWith(base + '/'), 'Only use the isolated local preview');
  const bootstrap = await page.request.get(base + '/api/bootstrap');
  assert(bootstrap.headers()['x-court-preview'] === 'isolated-sqlite', 'Require the isolation marker before any write');
  const data = await bootstrap.json(), names = new Set();
  const members = data.players.filter((p) => { const name = p.name.split(/[,，]/)[0].trim(); if (!name || names.has(name)) return false; names.add(name); return true; }).slice(0, 20);
  const fixture = members.map((p, i) => ({ key: 'p-' + p.id, playerId: p.id, name: p.name.split(/[,，]/)[0].trim(), level: i < 4 ? 2.5 : i < 12 ? 1 : 3.5 }));
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const read = async () => (await page.request.get(base + '/api/court-arrangements?date=' + date)).json();
  const saved = async () => page.locator('#caSave[data-tone="saved"]').waitFor({ timeout: 20000 });
  const post = async (kind, content, revision) => {
    const response = await page.request.post(base + '/api/court-arrangements', { headers: { origin: base }, data: { kind, date, content, revision, mutationId: crypto.randomUUID() } });
    assert(response.ok(), 'Isolated fixture POST: ' + await response.text());
  };
  const group = (key) => page.locator('.ca-bundle[data-bundle="' + key + '"]');
  const person = (key) => page.locator('.ca-person[data-person="' + key + '"]');
  const editor = page.locator('#caInspector');
  const clearSelection = async () => page.locator('#caBoard').click({ position: { x: 2, y: 2 } });
  const doubleFrame = async (key) => {
    await group(key).scrollIntoViewIfNeeded(); const box = await group(key).boundingBox();
    await group(key).dblclick({ position: { x: 8, y: box.height - 5 } });
  };
  const allNamesOnce = async () => assert(await page.locator('.ca-person').evaluateAll((nodes) => nodes.length === 20 && new Set(nodes.map((n) => n.dataset.person)).size === 20), 'All 20 attendees appear exactly once');
  const noBlankFrames = async () => assert(await page.locator('.ca-bundle').evaluateAll((nodes) => nodes.every((n) => n.querySelectorAll('.ca-person').length >= 2)), 'There are no empty or singleton frames');
  const memberships = (content) => fixture.slice(0, 4).map((p) => [p.key, content.assignments[p.key].roamingGroupId]);
  const expectedMembers = fixture.slice(0, 4).map((p, i) => [p.key, i < 2 ? 'flow-ab' : 'flow-cd']);
  const sameGroups = async () => {
    const state = await read();
    assert(JSON.stringify(memberships(state.activity.content)) === JSON.stringify(expectedMembers), 'AB and CD keep distinct memberships');
    assert(await page.locator('.ca-bundle').count() === 2, 'Two independent pairs are rendered');
    await allNamesOnce(); await noBlankFrames(); return state;
  };
  const pointDrag = async (from, to) => {
    await from.scrollIntoViewIfNeeded(); const a = await from.boundingBox(), b = await to.boundingBox();
    assert(a && b, 'Visible person/group drop target');
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
    assert(await to.evaluate((n) => n.classList.contains('ca-drop-target')), 'An explicit target group highlights');
    await page.mouse.up(); await saved();
  };
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => { window.confirm = () => true; });
  await page.evaluate(() => localStorage.removeItem('badminton.court-arrangements.v1'));
  await page.setViewportSize({ width: 1440, height: 900 }); await page.reload();
  await page.evaluate((date) => sessionPlannerController.selectDate(date), date);
  await page.locator('#chainInput').fill(fixture.map((p, i) => `${i + 1}. 【${p.level}级】${p.name}`).join('\n'));
  let state = await read();
  const config = { version: 1, preferences: Object.fromEntries(fixture.map((p, i) => [p.playerId, { mode: i < 4 ? 'roam' : 'fixed', coach: 'none', targets: [] }])), groups: [], excludedCandidates: [] };
  await post('settings', config, state.settings?.revision || 0);
  const plan = await page.evaluate(({ fixture, config }) => {
    const core = BadmintonCourtArrangementCore;
    const courts = core.makeCourts(3).map((c, i) => ({ ...c, label: ['1', '2', '8'][i] }));
    const plan = core.recommend(fixture, config, { courts });
    fixture.slice(0, 4).forEach((p, i) => { plan.assignments[p.key] = { courtId: null, allowed: courts.slice(i < 2 ? 0 : 1, i < 2 ? 2 : 3).map((c) => c.id), locked: true, roamingGroupId: i < 2 ? 'flow-ab' : 'flow-cd' }; });
    plan.bundlePositions = { 'flow-ab': { x: 40, y: 384 }, 'flow-cd': { x: 416, y: 416 } };
    plan.lineMode = 'selected'; return plan;
  }, { fixture, config });
  await post('activity', plan, state.activity?.revision || 0);
  await page.locator('#courtArrangementBtn').click(); await saved(); await page.locator('#caZoom').selectOption('1');
  state = await sameGroups();
  assert(await page.locator('#caFit, #caLineMode, #caLayout option[value="vertical"]').count() === 0, 'Removed controls are absent, not merely hidden');
  assert((await page.locator('#caLayout option').allTextContents()).join(',') === '手动布局,自动排列,横向排列', 'Only supported layout choices remain');
  assert(await editor.isHidden(), 'No permanent inspector');
  await page.waitForFunction(() => document.querySelectorAll('.ca-lines path').length === 4);
  assert(state.activity.content.lineMode === 'bundled', 'Old selected-only settings upgrade to default bundled lines');
  const initialPositions = JSON.stringify(state.activity.content.bundlePositions);
  const initialRevision = state.activity.revision;
  const initialCdAllowed = JSON.stringify(state.activity.content.assignments[fixture[2].key].allowed);

  // Double-click the frame, not a person, and keep the edit atomic until Save.
  await doubleFrame('flow-cd');
  assert(await editor.isVisible() && await editor.locator('.ca-bundle-form').count() === 1, 'Frame double-click opens a group editor');
  assert(await editor.locator('.ca-preference-form').count() === 0, 'A group edit is not a personal/social-group form');
  assert(await editor.getByRole('checkbox').count() === 3, 'All nonconsecutive court numbers are available');
  await editor.getByRole('checkbox', { name: '1号场', exact: true }).check();
  await editor.getByRole('checkbox', { name: '8号场', exact: true }).uncheck();
  assert(JSON.stringify((await read()).activity.content.assignments[fixture[2].key].allowed) === initialCdAllowed, 'Editing checkboxes alone does not change the cloud');
  await page.keyboard.press('Escape');
  assert(await editor.isHidden(), 'Esc cancels the whole group draft');
  assert((await read()).activity.revision === initialRevision, 'Cancellation does not write');
  assert(await group('flow-cd').evaluate((n) => n === document.activeElement), 'Cancel restores focus to the group');

  // F2 is a keyboard equivalent, and an empty range cannot be saved.
  await group('flow-cd').focus(); await page.keyboard.press('F2');
  for (const label of ['1号场', '2号场', '8号场']) await editor.getByRole('checkbox', { name: label, exact: true }).uncheck();
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  assert(await editor.getByRole('alert').isVisible(), 'An empty range shows an actionable error');
  assert((await read()).activity.revision === initialRevision, 'An invalid range is not saved');
  await editor.getByRole('checkbox', { name: '1号场', exact: true }).check();
  await editor.getByRole('checkbox', { name: '2号场', exact: true }).check();
  await editor.getByRole('button', { name: '保存', exact: true }).click(); await saved();
  state = await sameGroups();
  for (const p of fixture.slice(0, 4)) assert(JSON.stringify(state.activity.content.assignments[p.key].allowed) === JSON.stringify(plan.courts.slice(0, 2).map((c) => c.id)), 'Both independent pairs may use the same courts');
  assert(JSON.stringify(state.activity.content.bundlePositions) === initialPositions, 'Batch edits do not move either group');
  assert(await editor.isHidden(), 'Save closes the contextual editor');
  await clearSelection(); await page.waitForFunction(() => document.querySelectorAll('.ca-lines path').length === 4);
  assert(await page.locator('.ca-lines path').evaluateAll((paths) => paths.every((n) => /^M [-\d.]+ [-\d.]+ L [-\d.]+ [-\d.]+$/.test(n.getAttribute('d')))), 'Every group connection is a simple straight segment');

  // Same-destination frames still drag independently, with positions saved by group ID.
  let grip = await group('flow-cd').locator('.ca-bundle-grip').boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 80, grip.y + grip.height / 2 + 64, { steps: 10 }); await page.mouse.up(); await saved();
  state = await sameGroups();
  assert(state.activity.content.bundlePositions['flow-cd'].x > plan.bundlePositions['flow-cd'].x, 'Only the dragged group moves');
  assert(JSON.stringify(state.activity.content.bundlePositions['flow-ab']) === JSON.stringify(plan.bundlePositions['flow-ab']), 'The other matching-destination group stays put');
  const movedPositions = JSON.stringify(state.activity.content.bundlePositions);
  await page.reload(); await page.locator('#courtArrangementBtn').click(); await saved(); await page.locator('#caZoom').selectOption('1');
  state = await sameGroups(); assert(JSON.stringify(state.activity.content.bundlePositions) === movedPositions, 'Group IDs and coordinates survive reload');
  await page.locator('#caRecommend').click(); await saved(); state = await sameGroups();
  assert(JSON.stringify(state.activity.content.bundlePositions) === movedPositions, 'Recommending again preserves independent locked groups and their positions');
  await clearSelection();
  await page.screenshot({ path: 'E:/Codex_Workspace/Badminton level/output/playwright/court-independent-desktop.png' });
  await doubleFrame('flow-cd');
  await page.screenshot({ path: 'E:/Codex_Workspace/Badminton level/output/playwright/court-independent-editor.png' });
  await editor.getByRole('button', { name: '取消', exact: true }).click();

  await group('flow-cd').locator('.ca-bundle-grip').dblclick();
  assert(await editor.locator('.ca-bundle-form').isVisible(), 'Double-clicking the grip also opens the group editor');
  await editor.getByRole('button', { name: '取消', exact: true }).click();

  // Double-clicking a member still edits only that person, never the whole frame.
  const editedKey = fixture[2].key, partnerKey = fixture[3].key;
  await person(editedKey).dblclick();
  assert(await editor.locator('.ca-preference-form').count() === 1 && await editor.locator('.ca-bundle-form').count() === 0, 'Person double-click retains its own editor');
  await editor.locator('.ca-checks').getByRole('checkbox', { name: '1号场', exact: true }).uncheck(); await saved();
  state = await read();
  assert(state.activity.content.assignments[editedKey].roamingGroupId !== 'flow-cd', 'An individual range edit detaches that member');
  assert(state.activity.content.assignments[partnerKey].allowed.length === 2, 'The partner range is untouched');
  await editor.locator('.ca-checks').getByRole('checkbox', { name: '1号场', exact: true }).check(); await saved();
  assert((await read()).activity.content.assignments[editedKey].roamingGroupId !== 'flow-cd', 'Restoring the range does not auto-merge');
  await page.keyboard.press('Escape');
  assert(await page.locator('.ca-bundle').count() === 1 && await page.locator('.ca-flow-single').count() === 2, 'The split uses two unframed singles and one unaffected pair');
  await pointDrag(person(editedKey), person(partnerKey));
  await sameGroups();
  assert((await read()).activity.content.assignments[editedKey].roamingGroupId === 'flow-cd', 'Explicit person-to-single drop reforms only that pair');

  // Mobile users select a frame and use the same contextual icon without needing a double-click.
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#caZoom').selectOption('0.5');
  await page.locator('#caScroll').evaluate((n) => { n.scrollLeft = 0; n.scrollTop = 0; }); await clearSelection();
  await group('flow-cd').locator('.ca-bundle-grip').click();
  const editGroup = page.getByRole('button', { name: '编辑选中分组', exact: true });
  assert(await editGroup.isVisible(), 'A selected group exposes its compact edit icon');
  assert(await editGroup.evaluate((n) => n.getBoundingClientRect().width >= 44 && n.getBoundingClientRect().height >= 44), 'The mobile edit target is at least 44px');
  await editGroup.click(); assert(await editor.isVisible(), 'Mobile icon opens the group range editor');
  assert(await editor.getByRole('checkbox').evaluateAll((nodes) => nodes.every((n) => n.closest('label').getBoundingClientRect().height >= 44)), 'Mobile court choices have touch-sized rows');
  assert(await editor.evaluate((n) => { const r = n.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; }), 'The contextual editor fits the mobile screen');
  await page.screenshot({ path: 'E:/Codex_Workspace/Badminton level/output/playwright/court-independent-mobile.png' });
  await editor.getByRole('checkbox', { name: '2号场', exact: true }).uncheck();
  await editor.getByRole('button', { name: '保存', exact: true }).click(); await saved();
  state = await sameGroups();
  assert(state.activity.content.assignments[fixture[2].key].allowed.length === 1 && state.activity.content.assignments[fixture[3].key].allowed.length === 1, 'Mobile batch save updates every member in only the selected group');
  assert(state.activity.content.assignments[fixture[0].key].allowed.length === 2, 'The other pair is untouched by the mobile batch edit');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'The mobile page does not overflow horizontally');
  await clearSelection(); await group('flow-cd').locator('.ca-bundle-grip').click(); await editGroup.click();
  await editor.getByRole('checkbox', { name: '2号场', exact: true }).check();
  await editor.getByRole('button', { name: '保存', exact: true }).click(); await saved(); await sameGroups();
  assert(errors.length === 0, 'No runtime errors: ' + errors.join('; '));
  await page.evaluate(() => { window.__courtIndependentQa = ['frame double-click batch editor', 'F2 and focus return', 'atomic cancel', 'empty range validation', 'same courts without auto-merge', 'independent drag and reload positions', 'reroll preservation', 'straight default links', 'individual editor isolation and split', 'explicit singleton join', 'removed controls', 'mobile edit icon and touch rows', 'mobile batch save', 'no duplicated players/blank frames', 'no runtime errors']; });
  await page.setViewportSize({ width: 1440, height: 900 }); await page.locator('#caZoom').selectOption('1'); await clearSelection();
}