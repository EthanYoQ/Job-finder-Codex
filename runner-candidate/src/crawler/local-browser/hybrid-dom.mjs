import { createMokaDomRuntime } from './moka-b-browser-runtime.mjs';
import { createSanofiDomRuntime } from './sanofi-browser-runtime.mjs';
import { createChromiumDom } from './chromium-dom.mjs';

export async function captureHybridDom(sourceId, cua) {
  const sanofi = sourceId === 'source-sanofi-china-social';
  const name = sourceId === 'source-bayer-healthcare-social' ? 'bayer' : sourceId === 'source-servier-china-social' ? 'servier' : sanofi ? 'sanofi' : null;
  if (!name) throw Error('HYBRID_DOM_SOURCE_UNSUPPORTED');
  const runtime = sanofi ? createSanofiDomRuntime(cua) : createMokaDomRuntime(cua);
  const pages = [];
  try {
    if (sanofi) await runtime.start(); else await runtime.start(name);
    for (let index = 0; index < (sanofi ? 25 : 100); index++) {
      const value = await runtime.readPage();
      pages.push(sanofi ? value.page : value);
      if (value.nextDisabled) return { schemaVersion: `${sanofi ? 'sanofi-cn' : name}-cua-dom-list-v1`, observedAt: pages[0].capturedAt, pages };
      await runtime.advance();
    }
    throw Error('HYBRID_DOM_PAGE_LIMIT');
  } finally { await runtime.close(); }
}

export async function captureLocalHybridDom(sourceId, signal) {
  const { chromium } = await import('playwright-core');
  const cua = await createChromiumDom({ chromium, executablePath: process.platform === 'win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/chromium' });
  const abort = () => { void cua.close().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) throw signal.reason;
    return await captureHybridDom(sourceId, cua);
  } finally { signal?.removeEventListener('abort', abort); await cua.close(); }
}
