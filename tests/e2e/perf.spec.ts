import { expect, test, type Page } from '@playwright/test';
import { FAKE_SPEECH_INIT } from './helpers';

/**
 * Charge : CM de 1 h / 2 h / 3 h avec notes volumineuses, transcription (un segment toutes les ~4 s),
 * marqueurs et ancrages. Mesure l'ouverture et la latence de frappe, avec et sans enregistrement actif.
 * Les mesures sont affichées (voir README) ; les seuils ci-dessous sont volontairement larges (machine d'intégration).
 */
const RESULTS: Record<string, unknown>[] = [];

async function seed(page: Page, hours: number) {
  // La base de capture doit déjà exister (créée par l'app) : sinon on en créerait une vide.
  await page.waitForFunction(async () => (await indexedDB.databases()).some((d) => d.name === 'lexnote-capture'));
  await page.waitForTimeout(300);
  await page.evaluate(async (h) => {
    const open = (name: string) => new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const sid = 'demo-cm-c4';
    const durMs = h * 3600_000;
    const origin = Date.now() - durMs - 60_000;
    const words = ['consentement', 'contrat', 'article', 'obligation', 'dol', 'violence', 'erreur', 'validité', 'capacité', 'nullité', 'jurisprudence', 'professeur'];
    const sentence = (i: number) => Array.from({ length: 14 }, (_, k) => words[(i * 7 + k * 3) % words.length]).join(' ');

    // Notes : ≈ 8 000 mots par heure
    const paras = Array.from({ length: h * 570 }, (_, i) => ({ type: 'paragraph', content: [{ type: 'text', text: `${sentence(i)}.` }] }));
    const content = { type: 'doc', content: paras };
    const nb = await open('lexnote');
    await new Promise<void>((res, rej) => {
      const tx = nb.transaction(['notes', 'sessions'], 'readwrite');
      tx.objectStore('notes').put({ sessionId: sid, content, updatedAt: new Date().toISOString() });
      const g = tx.objectStore('sessions').get(sid);
      g.onsuccess = () => tx.objectStore('sessions').put({ ...g.result, wordCount: paras.length * 14, status: 'completed' });
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
    });

    // Capture : un segment toutes les 4 s (≈ 15 mots), 1 marqueur / 4 min, 1 ancrage / 5 s d'écriture
    const cb = await open('lexnote-capture');
    const nSeg = Math.floor(durMs / 4000);
    await new Promise<void>((res, rej) => {
      const tx = cb.transaction(['audioSessions', 'segments', 'markers', 'anchors'], 'readwrite');
      tx.objectStore('audioSessions').put({
        id: sid, sessionId: sid, originAt: origin, mimeType: 'audio/webm', bitsPerSecond: 32000, chunkMs: 30000, keepAudio: true, providerId: 'webspeech',
        runs: [{ id: 'r1', startMs: 0, endMs: durMs, endReason: 'user' }], status: 'COMPLETED', createdAt: 'x', updatedAt: 'x',
      });
      for (let i = 0; i < nSeg; i++) tx.objectStore('segments').put({ id: `seg${i}`, sessionId: sid, startMs: i * 4000, endMs: i * 4000 + 3500, text: sentence(i + 5), provider: 'webspeech', status: 'final', source: 'TRANSCRIPTION', verification: 'UNVERIFIED', createdAt: 'x' });
      for (let i = 0; i < Math.floor(durMs / 240_000); i++) tx.objectStore('markers').put({ id: `mk${i}`, sessionId: sid, atMs: i * 240_000, reasons: ['important'], createdAt: 'x' });
      for (let i = 0; i < Math.floor(durMs / 5000); i++) tx.objectStore('anchors').put({ id: `an${i}`, sessionId: sid, timestamp: i * 5000, notePosition: i, textSnippet: 'x', nearbyTranscriptSegmentIds: [`seg${i}`], createdAt: 'x' });
      tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
    });
    return nSeg;
  }, hours);
}

async function typingLatency(page: Page, n = 80) {
  await page.locator('.note-prose').click();
  await page.keyboard.press('Control+End');
  const lat = await page.evaluate((count) => new Promise<number[]>((resolve) => {
    const el = document.querySelector('.note-prose') as HTMLElement; const out: number[] = []; let i = 0;
    const type = () => {
      const t = performance.now();
      document.execCommand('insertText', false, 'a');
      requestAnimationFrame(() => { out.push(performance.now() - t); if (++i < count) setTimeout(type, 30); else resolve(out); });
    };
    el.focus(); type();
  }), n);
  lat.sort((a, b) => a - b);
  return { median: lat[Math.floor(lat.length / 2)]!, p95: lat[Math.floor(lat.length * 0.95)]!, max: lat[lat.length - 1]! };
}

test.describe.configure({ mode: 'serial' });
test.beforeEach(({ browserName }) => test.skip(browserName !== 'chromium', 'micro simulé : Chromium uniquement'));

for (const hours of [1, 2, 3]) {
  test(`charge — CM de ${hours} h`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.addInitScript(FAKE_SPEECH_INIT);
    await page.addInitScript(() => { localStorage.setItem('lexnote.recordingConsent', '1'); localStorage.setItem('lexnote.transcription', JSON.stringify({ keepAudio: true })); });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Bon cours/ })).toBeVisible();
    const nSeg = await seed(page, hours);

    const t0 = Date.now();
    await page.goto('/session/demo-cm-c4');
    await expect(page.locator('.note-prose p').first()).toBeVisible();
    await expect(page.getByTestId('tseg').first()).toBeAttached(); // (hors écran : le panneau suit le direct)
    const openMs = Date.now() - t0;
    const dom = await page.evaluate(() => document.querySelectorAll('*').length);

    const idle = await typingLatency(page);

    // Enregistrement actif + flux de segments très soutenu (≈ 4 par seconde, bien au-delà du réel)
    await page.getByTestId('transcription-btn').click();
    await expect(page.getByTestId('rec-pill')).toContainText(/REC/, { timeout: 10_000 });
    await page.evaluate(() => { (window as any).__flood = setInterval(() => (window as any).__say('le professeur explique que le consentement doit être libre et éclairé'), 250); });
    await page.waitForTimeout(1500);
    const live = await typingLatency(page);
    await page.waitForTimeout(500);
    const savedWhileLive = await page.getByTestId('save-status').innerText();
    await page.evaluate(() => clearInterval((window as any).__flood));
    const segCount = await page.getByTestId('tseg').count();

    const row = { hours, segments: nSeg, openMs, dom, idleMedian: +idle.median.toFixed(1), idleP95: +idle.p95.toFixed(1), liveMedian: +live.median.toFixed(1), liveP95: +live.p95.toFixed(1), liveMax: +live.max.toFixed(1), rowsAfterFlood: segCount };
    RESULTS.push(row);
    console.log('PERF', JSON.stringify(row));

    expect(openMs).toBeLessThan(8000);
    expect(idle.p95).toBeLessThan(60);
    expect(live.p95).toBeLessThan(80);
    expect(savedWhileLive).toMatch(/Enregistr/);
  });
}
