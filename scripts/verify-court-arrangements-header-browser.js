async (page) => {
  const base = 'http://127.0.0.1:8787';
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  assert(page.url().startsWith(base + '/'), 'Only run this test against the isolated preview');
  const bootstrap = await page.request.get(base + '/api/bootstrap');
  assert(bootstrap.headers()['x-court-preview'] === 'isolated-sqlite', 'Require isolation before any write');
  const data = await bootstrap.json(), names = new Set();
  const members = data.players.filter((p) => { const name = p.name.split(/[,，]/)[0].trim(); if (!name || names.has(name)) return false; names.add(name); return true; }).slice(0, 14);
  const fixture = members.map((p, i) => ({ key: 'p-' + p.id, playerId: p.id, name: p.name.split(/[,，]/)[0].trim(), level: i < 6 ? 3.5 : i < 12 ? 2 : 2.5 }));
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const read = async () => (await page.request.get(base + '/api/court-arrangements?date=' + date)).json();
  const saved = async () => page.locator('#caSave[data-tone="saved"]').waitFor({ timeout: 20000 });
  const post = async (kind, content, revision) => {
    const result = await page.request.post(base + '/api/court-arrangements', { headers: { origin: base }, data: { kind, date, content, revision, mutationId: crypto.randomUUID() } });
    assert(result.ok(), 'Isolated setup save: ' + await result.text());
  };
  const plan = () => page.evaluate(() => courtArrangementController.getPlan());
  const head = (index = 0) => page.locator('.ca-court-head').nth(index);
  const point = async (index = 0, selector = '.ca-court-level') => {
    const box = await head(index).locator(selector).boundingBox();
    assert(box, 'Visible title drag area'); return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const hold = async (index = 0, selector) => {
    const p = await point(index, selector); await page.mouse.move(p.x, p.y); await page.mouse.down();
    await page.waitForFunction((i) => document.querySelectorAll('.ca-court-head')[i]?.classList.contains('ca-court-drag-ready'), index, { timeout: 3000 }); return p;
  };
  const coordinates = (value) => value.courts.map((c) => ({ id: c.id, x: c.x, y: c.y }));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const noMove = async (before, message) => assert(equal(coordinates(await plan()), coordinates(before)), message);
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => { window.confirm = () => true; });
  await page.evaluate(() => localStorage.removeItem('badminton.court-arrangements.v1'));
  await page.setViewportSize({ width: 1440, height: 900 }); await page.reload();
  await page.evaluate((date) => sessionPlannerController.selectDate(date), date);
  await page.locator('#chainInput').fill(fixture.map((p, i) => `${i + 1}. 【${p.level}级】${p.name}`).join('\n'));
  let state = await read();
  const config = { version: 1, preferences: Object.fromEntries(fixture.map((p, i) => [p.playerId, { mode: i < 12 ? 'fixed' : 'roam', coach: 'none', targets: [] }])), groups: [], excludedCandidates: [] };
  await post('settings', config, state.settings?.revision || 0);
  const initial = await page.evaluate(({ fixture, config }) => {
    const core = BadmintonCourtArrangementCore, courts = core.makeCourts(2).map((c, i) => ({ ...c, label: i ? '7' : '2' }));
    const result = core.recommend(fixture, config, { courts });
    for (const person of result.roster) result.assignments[person.key].locked = true;
    result.bundlePositions = Object.fromEntries(core.bundles(result).map((g) => [g.key, { x: 80, y: 350 }]));
    return result;
  }, { fixture, config });
  await post('activity', initial, state.activity?.revision || 0);
  await page.locator('#courtArrangementBtn').click(); await saved(); await page.locator('#caZoom').selectOption('1');
  assert(await page.locator('.ca-court-grip').count() === 0, 'No separate court drag buttons exist');
  assert(await page.locator('.ca-court-title').evaluateAll((nodes) => nodes.every((n) => n.firstElementChild.tagName === 'INPUT' && n.children[1].textContent === '号场' && n.querySelectorAll('button').length === 1)), 'The title is editable X号场 plus range and delete, without a drag button');
  assert(await page.locator('.ca-court-level').evaluateAll((nodes) => nodes.every((n) => Math.abs(n.getBoundingClientRect().top - n.parentElement.querySelector('input').getBoundingClientRect().top) < 14)), 'Grade ranges remain on the title row');
  assert(await head().getAttribute('tabindex') === '0', 'The drag title remains keyboard-accessible');

  // Neither a short click nor a quick swipe may move/save the court.
  let before = await plan(), revision = (await read()).activity.revision;
  let p = await point(); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up();
  await noMove(before, 'Short title clicks do not move a court'); assert((await read()).activity.revision === revision, 'Short clicks do not save layout');
  assert(await page.locator('.ca-court').first().evaluate((n) => n.classList.contains('ca-active')), 'Short clicks still select the court');
  p = await point(); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 48, p.y + 24, { steps: 2 }); await page.waitForTimeout(400); await page.mouse.up();
  await noMove(before, 'Moving before the hold threshold cancels the gesture'); assert((await read()).activity.revision === revision, 'Quick swipes do not write layout');

  // Long-press can start on the suffix, anywhere in the noninteractive green title.
  p = await hold(0, '.ca-court-label'); await page.mouse.up(); await noMove(before, 'Stationary long-press does not move');
  assert((await read()).activity.revision === revision, 'A stationary hold does not generate a cloud edit');
  p = await hold(); const oldLine = await page.locator('.ca-lines path').first().getAttribute('d');
  await page.mouse.move(p.x + 96, p.y + 64, { steps: 10 });
  await page.waitForFunction((old) => document.querySelector('.ca-lines path').getAttribute('d') !== old, oldLine);
  await page.mouse.up(); await saved(); state = await read();
  assert(state.activity.content.courts[0].x === before.courts[0].x + 96 && state.activity.content.courts[0].y === before.courts[0].y + 64, 'Long-press dragging updates layout by the actual board distance');
  assert(equal(state.activity.content.assignments, before.assignments), 'Moving a court never changes players or their ranges');
  assert(equal(state.activity.content.courts[1], before.courts[1]), 'Only the dragged court moves');
  assert(await page.locator('.ca-court-drag-ready').count() === 0, 'Release clears drag feedback');
  const moved = coordinates(state.activity.content);
  await page.reload(); await page.locator('#courtArrangementBtn').click(); await saved(); await page.locator('#caZoom').selectOption('1');
  assert(equal(coordinates(await plan()), moved), 'The moved position survives reload');

  // Number editing and its keyboard arrows are not drag handles.
  before = await plan(); revision = (await read()).activity.revision;
  const input = head().locator('input'), inputBox = await input.boundingBox();
  await page.mouse.move(inputBox.x + inputBox.width / 2, inputBox.y + inputBox.height / 2); await page.mouse.down(); await page.waitForTimeout(450);
  assert(await page.locator('.ca-court-drag-ready').count() === 0, 'Holding the number input does not arm a layout drag');
  await page.mouse.up(); await input.fill('1'); await input.press('Tab'); await saved();
  await noMove(before, 'Renumbering does not move a rectangle');
  assert((await plan()).courts[0].label === '1', 'Court numbers remain editable');
  assert(await head().locator('.ca-court-label').innerText() === '号场', 'The edited court is still formatted X号场');
  before = await plan(); await head().locator('input').focus(); await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Shift+ArrowRight');
  await noMove(before, 'Arrow keys inside the input only edit text');
  await head().focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowDown'); await saved();
  const keyboard = await plan();
  assert(keyboard.courts[0].x === before.courts[0].x + 16 && keyboard.courts[0].y === before.courts[0].y + 64, 'Keyboard layout movement is retained without a visible grip');

  // Cancelled gestures, Escape and redraws revert uncommitted motion and clear the hold timer.
  before = await plan(); p = await hold(); await page.mouse.move(p.x + 64, p.y + 48, { steps: 8 });
  await page.dispatchEvent('.ca-court-head', 'pointercancel', { pointerId: 1 }); await page.mouse.up();
  await noMove(before, 'Pointer cancellation rolls back temporary movement');
  p = await hold(); await page.mouse.move(p.x + 64, p.y + 32, { steps: 8 }); await page.keyboard.press('Escape'); await page.mouse.up();
  await noMove(before, 'Escape cancels the layout drag first'); assert(await page.locator('#courtArrangementModal').isVisible(), 'Cancelling a gesture does not close the court window');
  p = await point(); await page.mouse.move(p.x, p.y); await page.mouse.down();
  const cloudUpdate = JSON.parse(JSON.stringify(before)); cloudUpdate.courts[0].x += 64;
  await post('activity', cloudUpdate, (await read()).activity.revision);
  await page.evaluate(() => courtArrangementController.refresh()); await page.waitForTimeout(450); await page.mouse.up();
  assert(await page.locator('.ca-court-drag-ready').count() === 0, 'Refreshing during a pending hold cannot leave a stale gesture');
  await noMove(cloudUpdate, 'A cancelled old hold does not overwrite newly received cloud coordinates');

  await page.locator('#caLayout').selectOption('horizontal'); await saved(); await page.locator('#caBoard').click({ position: { x: 2, y: 2 } });
  await page.screenshot({ path: 'E:/Codex_Workspace/Badminton level/output/playwright/court-header-desktop.png' });

  // 50% mobile zoom and real touch pointers use the same press-then-drag interaction.
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#caZoom').selectOption('0.5');
  await page.locator('#caScroll').evaluate((n) => { n.scrollLeft = 0; n.scrollTop = 0; });
  before = await plan(); p = await hold(); await page.mouse.move(p.x + 32, p.y + 24, { steps: 8 }); await page.mouse.up(); await saved();
  let mobile = await plan();
  assert(mobile.courts[0].x === before.courts[0].x + 64 && mobile.courts[0].y === before.courts[0].y + 48, 'Scaled pointer motion is converted into board coordinates');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  before = await plan(); p = await point();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
  await page.waitForFunction(() => document.querySelector('.ca-court-head')?.classList.contains('ca-court-drag-ready'), null, { timeout: 3000 });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x + 32 * i / 8, y: p.y + 24 * i / 8 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await saved(); mobile = await plan();
  assert(mobile.courts[0].x === before.courts[0].x + 64 && mobile.courts[0].y === before.courts[0].y + 48, 'Finger-style long-press moves the entire court at 50% zoom');
  before = await plan(); p = await point();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x + 25, y: p.y + 12 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await noMove(before, 'Quick touch swipes do not move courts');
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }); await cdp.detach();
  assert(await page.locator('.ca-court-title').evaluateAll((nodes) => nodes.every((n) => n.querySelector('input').getBoundingClientRect().right <= n.children[1].getBoundingClientRect().left + 1)), 'Mobile numbers stay before the 号场 suffix');
  assert(await page.locator('.ca-header-actions button').evaluateAll((nodes) => nodes.every((n) => n.getBoundingClientRect().width >= 44 && n.getBoundingClientRect().right <= innerWidth)), 'Mobile icon buttons remain touch-sized and visible');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'The mobile page has no horizontal overflow');
  assert(await page.locator('.ca-person').count() === 14, 'All attendees remain present once');
  assert(errors.length === 0, 'No runtime errors: ' + errors.join('; '));
  await page.locator('#caLayout').selectOption('horizontal'); await saved(); await page.locator('#caBoard').click({ position: { x: 2, y: 2 } });
  await page.screenshot({ path: 'E:/Codex_Workspace/Badminton level/output/playwright/court-header-mobile.png' });
  await page.locator('#caClose').click(); await page.locator('#courtArrangementBtn').click(); await saved();
  assert(await page.locator('.ca-court-grip').count() === 0, 'Reopening still uses header dragging without separate grips');
  await page.evaluate(() => { window.__courtHeaderQa = ['editable X号场', 'no separate grip', 'short click and quick swipe protection', 'whole-title long press', 'save/reload layout', 'live straight lines', 'number input isolation', 'keyboard positioning', 'pointer cancellation and Escape', 'refresh clears holds', '50% mobile mouse and real touch', 'no player changes', 'mobile labels and no overflow', 'no runtime errors']; });
  await page.setViewportSize({ width: 1440, height: 900 }); await page.locator('#caZoom').selectOption('1');
}