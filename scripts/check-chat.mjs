// Run against `npm run preview -- --port 5174`. All backend traffic is mocked.
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch();
await mkdir('test-results/chat', { recursive: true });
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, reducedMotion: mobile ? 'reduce' : 'no-preference' });
    let restored = false;
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.EventSource = class {
        static OPEN = 1; static CLOSED = 2; readyState = 1;
        constructor() { window.chatEvents = this; setTimeout(() => this.onopen?.({}), 0); }
        close() { this.readyState = 2; }
      };
    });
    await page.route('**/sdk/**', async (route) => {
      const type = new URL(route.request().url()).pathname.split('/').at(-1);
      const data = type === 'session.get' ? { conversation_id: 7, busy: false, mode: 'ask' }
        : type === 'conv.read' ? { messages: restored ? [{ id: 1, role: 'assistant', content: 'Recovered reply', timestamp: 1, tool_call_id: null, tool_name: null }] : [], conversation: { id: 7, title: 'Chat rendering check' } }
        : type === 'ledger.read' ? (restored && !route.request().postDataJSON().since_id ? [{ id: 1, ts: 2, origin: 'agent', action_type: 'call_tool', conversation_id: 7, ok: 1, error_code: null, args_json: '{}', data_json: JSON.stringify({ attachments: ['/one.png', '/two.png'] }) }] : [])
        : type === 'frontend.pending' ? null : type === 'llm.list' ? { profiles: [] }
        : type === 'config.read' ? null : [];
      await route.fulfill({ json: { data } });
    });
    await page.route('**/files?**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 350));
      await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#334155"/><circle cx="300" cy="200" r="130" fill="#94a3b8"/></svg>' });
    });
    await page.goto('http://localhost:5174/?thread=chat-check');
    await page.getByPlaceholder('Message Second Brain').waitFor();
    await page.waitForTimeout(500);
    const emit = async (kind, payload) => {
      await page.evaluate(({ kind, payload }) => window.chatEvents.onmessage({ data: JSON.stringify({ kind, payload }) }), { kind, payload });
      await page.waitForTimeout(70);
    };
    await page.getByPlaceholder('Message Second Brain').fill('Please show some files.');
    await page.getByPlaceholder('Message Second Brain').press('Enter');
    await emit('typing', true);
    const userMessage = page.locator('[data-role="user"]').last();
    await expect.poll(async () => userMessage.evaluate((node) => {
      const viewport = node.closest('[data-slot="chat-viewport"]');
      return Math.abs(node.getBoundingClientRect().top - viewport.getBoundingClientRect().top);
    })).toBeLessThan(18);
    await emit('stream_delta', { stream_id: 's1', seq: 1, delta: 'First, the gallery.', done: false });
    await emit('attachments', ['/one.png', '/two.png', '/three.png', '/four.png', '/five.png']);
    await emit('stream_delta', { stream_id: 's1', seq: 2, delta: '\n\nNow, a separate image.', done: false });
    await emit('tool_status', { call_id: 'c1', tool_name: 'show_files', status: 'started', args: { paths: ['/last.png'], caption: 'Exact *literal* caption' } });
    await emit('attachments', ['/last.png']);
    await emit('tool_status', { call_id: 'c1', status: 'finished', ok: true });
    await emit('stream_delta', { stream_id: 's1', seq: 3, delta: '\n\nAll done.', done: true, final_text: 'First, the gallery.\n\nNow, a separate image.\n\nAll done.' });
    await expect(page.locator('[data-slot="attachment-group"]')).toHaveCount(0);
    await emit('typing', false);
    // The backend can publish attachment delivery after its completion signal.
    await emit('attachments', ['/late.md']);
    const reply = page.locator('[data-role="assistant"]');
    await expect(reply).toHaveCount(1);
    await expect(reply.locator('img')).toHaveCount(4);
    await expect(page.locator('[data-slot="reply-activity"]')).toHaveCount(0);
    await page.screenshot({ path: 'test-results/chat/before-expand.png', fullPage: true });
    await reply.getByRole('button', { name: 'Show 3 more' }).click();
    await expect(reply.locator('img')).toHaveCount(6);
    await expect(reply.getByRole('button', { name: 'Open late.md' })).toBeVisible();
    await page.waitForFunction(() => [...document.querySelectorAll('[data-role="assistant"] img')].every((img) => img.complete));
    const geometry = await reply.evaluate((node) => {
      const footer = node.querySelector('[data-slot="assistant-message-footer"]');
      const groups = [...node.querySelectorAll('[data-slot="attachment-group"]')];
      return { footerLast: footer.parentElement.lastElementChild === footer, above: groups.every((group) => group.getBoundingClientRect().bottom <= footer.getBoundingClientRect().top), overflow: document.documentElement.scrollWidth > innerWidth };
    });
    expect(geometry).toEqual({ footerLast: true, above: true, overflow: false });
    await reply.locator('[data-slot="assistant-message-footer"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/chat/${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
    await reply.getByRole('button', { name: '7 files', exact: true }).click();
    await expect(page.locator('[data-file-path]')).toHaveCount(7);
    await page.waitForTimeout(300);
    const highlighted = await page.locator('[data-file-highlight]').evaluateAll((nodes) => nodes.some((node) => Number(getComputedStyle(node).opacity) > 0.8));
    expect(highlighted).toBe(true);
    await page.screenshot({ path: `test-results/chat/${mobile ? 'mobile' : 'desktop'}-drawer.png`, fullPage: true });
    await page.waitForTimeout(1700);
    expect(await page.locator('[data-file-highlight]').evaluateAll((nodes) => nodes.every((node) => Number(getComputedStyle(node).opacity) === 0))).toBe(true);
    if (mobile) await page.keyboard.press('Escape');
    await reply.getByRole('button', { name: '7 files', exact: true }).click();
    await page.waitForTimeout(300);
    expect(await page.locator('[data-file-highlight]').evaluateAll((nodes) => nodes.some((node) => Number(getComputedStyle(node).opacity) > 0.8))).toBe(true);
    await page.keyboard.press('Escape');
    await reply.getByRole('button', { name: 'Open two.png' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'two.png', exact: true })).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('heading', { name: 'three.png', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    const viewport = page.locator('[data-slot="chat-viewport"]');
    await viewport.evaluate((node) => { node.style.scrollBehavior = 'auto'; node.scrollTop = 0; });
    await page.waitForTimeout(150);
    await emit('typing', true);
    await emit('stream_delta', { stream_id: 's2', seq: 1, delta: 'New content while you read earlier messages. '.repeat(30), done: false });
    expect(await viewport.evaluate((node) => node.scrollTop)).toBeLessThan(10);
    await viewport.evaluate((node) => { node.scrollTop = node.scrollHeight; });
    await page.waitForTimeout(200);
    await emit('stream_delta', { stream_id: 's2', seq: 2, delta: '\\n\\nFollowing new content. '.repeat(40), done: false });
    // Top anchoring leaves the reader in place as the reply grows.
    await expect(page.getByText('New content while you read earlier messages.', { exact: false })).toBeAttached();
    await emit('typing', false);
    // Expanding both the group and its nested details must keep the trigger fixed.
    const trigger = page.locator('[data-slot="tool-group-trigger"]').first();
    await trigger.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    for (let pass = 0; pass < 2; pass++) {
      const before = await trigger.boundingBox();
      await trigger.click();
      await page.waitForTimeout(300);
      const after = await trigger.boundingBox();
      expect(Math.abs(after.y - before.y)).toBeLessThan(6);
      if (pass === 0) {
        const summary = page.locator('details.group\\/tool > summary').first();
        const detailBefore = await summary.boundingBox();
        await summary.click();
        await page.waitForTimeout(100);
        expect(Math.abs((await summary.boundingBox()).y - detailBefore.y)).toBeLessThan(6);
      }
    }
    await page.getByPlaceholder('Message Second Brain').fill('One more question after a long reply.');
    await page.getByPlaceholder('Message Second Brain').press('Enter');
    await emit('typing', true);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `test-results/chat/${mobile ? 'mobile' : 'desktop'}-send-debug.png` });
    await expect.poll(async () => page.locator('[data-role="user"]').last().evaluate((node) => {
      const viewport = node.closest('[data-slot="chat-viewport"]');
      return Math.abs(node.getBoundingClientRect().top - viewport.getBoundingClientRect().top);
    })).toBeLessThan(18);
    await page.screenshot({ path: `test-results/chat/${mobile ? 'mobile' : 'desktop'}-send-anchor.png` });
    restored = true;
    await page.reload();
    await expect(page.getByText('Recovered reply', { exact: true })).toBeVisible();
    await expect(page.locator('[data-role="assistant"]')).toHaveCount(1);
    await expect(page.locator('[data-slot="attachment-group"]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: '2 files', exact: true })).toBeVisible();
    expect(await page.locator('[data-slot="assistant-message-footer"]').evaluate((node) => node.parentElement.lastElementChild === node)).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
    console.log(`${mobile ? 'Mobile/reduced motion' : 'Desktop'}: send-to-top, stable tool expansion, completed recap, gallery and drawer checks passed`);
  }
} finally { await browser.close(); }
