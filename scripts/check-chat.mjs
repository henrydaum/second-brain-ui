// Run against `npm run preview -- --port 5174`. All backend traffic is mocked.
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch();
await mkdir('test-results/chat', { recursive: true });
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, reducedMotion: mobile ? 'reduce' : 'no-preference' });
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
        : type === 'conv.read' ? { messages: [], conversation: { id: 7, title: 'Chat rendering check' } }
        : type === 'frontend.pending' ? [] : type === 'llm.list' ? { profiles: [] }
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
    await emit('typing', true);
    await emit('stream_delta', { stream_id: 's1', seq: 1, delta: 'First, the gallery.', done: false });
    await emit('attachments', ['/one.png', '/two.png', '/three.png', '/four.png', '/five.png']);
    await emit('stream_delta', { stream_id: 's1', seq: 2, delta: '\n\nNow, a separate image.', done: false });
    await emit('tool_status', { call_id: 'c1', tool_name: 'show_files', status: 'started', args: { paths: ['/last.png'], caption: 'Exact *literal* caption' } });
    await emit('attachments', ['/last.png']);
    await emit('tool_status', { call_id: 'c1', status: 'finished', ok: true });
    await emit('stream_delta', { stream_id: 's1', seq: 3, delta: '\n\nAll done.', done: true, final_text: 'First, the gallery.\n\nNow, a separate image.\n\nAll done.' });
    await emit('typing', false);
    const reply = page.locator('[data-role="assistant"]');
    await expect(reply).toHaveCount(1);
    await expect(reply.locator('img')).toHaveCount(5);
    await expect(page.locator('[data-slot="reply-activity"]')).toHaveCount(0);
    await reply.getByRole('button', { name: 'Show 1 more' }).click();
    await expect(reply.locator('img')).toHaveCount(6);
    const geometry = await reply.evaluate((node) => {
      const footer = node.querySelector('[data-slot="assistant-message-footer"]');
      const groups = [...node.querySelectorAll('[data-slot="attachment-group"]')];
      return { footerLast: footer.parentElement.lastElementChild === footer, above: groups.every((group) => group.getBoundingClientRect().bottom <= footer.getBoundingClientRect().top), overflow: document.documentElement.scrollWidth > innerWidth };
    });
    expect(geometry).toEqual({ footerLast: true, above: true, overflow: false });
    await page.screenshot({ path: `test-results/chat/${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
    await reply.getByRole('button', { name: '6 files', exact: true }).click();
    await expect(page.locator('[data-file-path]')).toHaveCount(6);
    await page.waitForTimeout(300);
    const highlighted = await page.locator('[data-file-highlight]').evaluateAll((nodes) => nodes.some((node) => Number(getComputedStyle(node).opacity) > 0.8));
    expect(highlighted).toBe(true);
    await page.screenshot({ path: `test-results/chat/${mobile ? 'mobile' : 'desktop'}-drawer.png`, fullPage: true });
    expect(errors).toEqual([]);
    await page.close();
    console.log(`${mobile ? 'Mobile/reduced motion' : 'Desktop'}: ordered gallery, footer geometry, drawer highlight passed`);
  }
} finally { await browser.close(); }
