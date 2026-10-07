import { expect, type Page } from '@playwright/test';

/** Collecte les erreurs console / pageerror pour vérifier qu'aucune erreur importante n'apparaît. */
export function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

export const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

export async function createCm(page: Page, opts: { subject?: string; module?: string; title: string; type?: 'CM' | 'TD' | 'TP' }) {
  // Le bouton principal ouvre le créateur de séance ; CM reste le type par défaut.
  if (!(await page.getByTestId('dash-new-cm').isVisible().catch(() => false))) await page.goto('/');
  await page.getByTestId('dash-new-cm').click();
  const dlg = page.getByRole('dialog', { name: 'Nouvelle séance' });
  if (opts.type) await dlg.getByRole('button', { name: opts.type, exact: true }).click();
  if (opts.subject) {
    await dlg.locator('#cm-subject').selectOption('__new__');
    await dlg.locator('input[aria-label="Nom de la nouvelle matière"]').fill(opts.subject);
  }
  if (opts.module) await dlg.locator('input[aria-label="Nom du nouveau module"]').fill(opts.module);
  await dlg.getByLabel(/^Titre/).fill(opts.title);
  await dlg.getByTestId('create-cm').click();
  await expect(page.getByTestId('editor')).toBeVisible();
}

export async function waitSaved(page: Page) {
  await expect(page.getByTestId('save-status')).toContainText('Enregistré', { timeout: 8000 });
}

/** Réservé à Chromium : micro simulé (--use-fake-device-for-media-stream). */
export const MIC_ONLY = (name: string) => name !== 'chromium';

/**
 * Installe une fausse SpeechRecognition (déterministe) et trace les appels getUserMedia / pistes audio.
 * `window.__say(text)` fait « parler le professeur ».
 */
export const FAKE_SPEECH_INIT = `
  (() => {
    window.__gum = 0; window.__tracks = [];
    const realGum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => {
      window.__gum++;
      if (window.__denyMic) throw new DOMException('refus', 'NotAllowedError');
      const s = await realGum(c); s.getTracks().forEach((t) => window.__tracks.push(t)); return s;
    };
    class FakeSR {
      constructor() { window.__sr = this; this.started = false; }
      start() { this.started = true; window.__srStarts = (window.__srStarts||0)+1; }
      stop() { this.started = false; setTimeout(() => this.onend && this.onend(), 0); }
      abort() { this.stop(); }
    }
    if (!window.__noSR) { window.SpeechRecognition = FakeSR; window.webkitSpeechRecognition = FakeSR; }
    let idx = 0;
    window.__say = (text, final = true) => {
      const sr = window.__sr; if (!sr || !sr.onresult) return false;
      const res = [{ transcript: text, confidence: 0.9 }]; res.isFinal = final;
      sr.onresult({ resultIndex: 0, results: Object.assign([res], { length: 1 }) });
      return true;
    };
  })();
`;

export async function startRecording(page: import('@playwright/test').Page) {
  await page.getByTestId('transcription-btn').click();
  const accept = page.getByTestId('consent-accept');
  if (await accept.isVisible().catch(() => false)) await accept.click();
  await expect(page.getByTestId('rec-pill')).toContainText('REC', { timeout: 10_000 });
}

export async function capIDB(page: import('@playwright/test').Page, store: string): Promise<any[]> {
  return page.evaluate((st) => new Promise<any[]>((res, rej) => {
    const r = indexedDB.open('lexnote-capture-33333333-3333-4333-8333-333333333333');
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const tx = r.result.transaction(st, 'readonly').objectStore(st).getAll();
      tx.onsuccess = () => res(tx.result as any[]);
      tx.onerror = () => rej(tx.error);
    };
  }), store);
}
