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

/** Réglages de transcription (par compte, scopés) à installer dès qu'un compte est connecté. */
const engineByPage = new WeakMap<Page, Record<string, unknown>>();
export const engineFor = (page: Page, settings: Record<string, unknown>) => { engineByPage.set(page, settings); };
async function applyEngine(page: Page) {
  const s = engineByPage.get(page);
  if (!s) return;
  await page.evaluate((v) => {
    const id = JSON.parse(localStorage.getItem('lexnote-mock-auth') ?? '{}').sessionUserId;
    localStorage.setItem(`lexnote.transcription.${id}`, JSON.stringify(v));
  }, s);
}

let counter = 0;
export const uniqueEmail = (tag = 'etu') => `${tag}${Date.now()}${counter++}@example.com`;
export const PASSWORD = 'motdepasse-solide';

/** Crée un compte via l'interface et passe l'onboarding (sans matière). Termine sur le tableau de bord vide. */
export async function signUp(page: Page, opts: { email?: string; firstName?: string; subject?: string } = {}) {
  const email = opts.email ?? uniqueEmail();
  await page.goto('/signup');
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(PASSWORD);
  await page.getByTestId('auth-password2').fill(PASSWORD);
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('onboarding-step-1')).toBeVisible();
  await page.getByTestId('ob-firstname').fill(opts.firstName ?? 'Anton');
  await page.getByTestId('ob-next').click();
  await page.getByTestId('ob-next').click();
  if (opts.subject) { await page.getByTestId('ob-subject').fill(opts.subject); await page.getByTestId('ob-finish').click(); }
  else await page.getByTestId('ob-skip').click();
  await expect(page.getByTestId('greeting')).toBeVisible();
  await applyEngine(page);
  return email;
}

export async function logIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill(PASSWORD);
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('greeting')).toBeVisible();
}

export async function logOut(page: Page) {
  await page.getByTestId('avatar').click();
  await page.getByTestId('logout').click();
  await expect(page.getByTestId('auth-submit')).toBeVisible();
}

/** Crée un compte si la page n'est pas déjà connectée (les tests historiques partent d'un navigateur neuf). */
export async function ensureAccount(page: Page) {
  if (page.url() === 'about:blank') await page.goto('/');
  const probe = page.locator('[data-testid="auth-submit"], [data-testid="greeting"], [data-testid="sessions-new"], [data-testid="editor"], .page');
  await probe.first().waitFor({ timeout: 10_000 });
  if (await page.getByTestId('auth-submit').isVisible().catch(() => false)) await signUp(page);
}

const hasOption = (sel: import('@playwright/test').Locator, label: string) =>
  sel.locator('option').filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).count();

export type SessionKind = 'CM' | 'TD' | 'TP' | 'COURSE' | 'SEMINAR' | 'WORKSHOP' | 'REVISION' | 'OTHER';

export async function createSession(page: Page, opts: { type?: SessionKind; subject?: string; module?: string; title: string }) {
  await ensureAccount(page);
  if (!(await page.getByTestId('sessions-new').isVisible().catch(() => false))) await page.goto('/sessions');
  await page.getByTestId('sessions-new').click();
  const dlg = page.getByRole('dialog', { name: 'Nouvelle séance' });
  await dlg.getByTestId(`type-${opts.type ?? 'CM'}`).click();
  if (opts.subject) {
    const sel = dlg.getByLabel('Matière');
    const has = await hasOption(sel, opts.subject);
    if (has) await sel.selectOption({ label: opts.subject });
    else {
      await sel.selectOption('__new__').catch(() => undefined);
      await dlg.getByLabel('Nom de la nouvelle matière').fill(opts.subject);
    }
  }
  if (opts.module) {
    const sel = dlg.getByLabel(/^Module/);
    const has = await hasOption(sel, opts.module);
    if (has) await sel.selectOption({ label: opts.module });
    else { await sel.selectOption('__new__'); await dlg.getByLabel('Nom du nouveau module').fill(opts.module); }
  }
  await dlg.getByLabel(/^Titre/).fill(opts.title);
  await dlg.getByTestId('create-session').click();
  await expect(page.getByTestId('editor')).toBeVisible();
}
export const createCm = (page: Page, opts: { subject?: string; module?: string; title: string; type?: SessionKind }) => createSession(page, { type: 'CM', ...opts });

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
    indexedDB.databases().then((dbs) => {
    const name = dbs.map((d) => d.name ?? '').find((n) => n.startsWith('lexnote-capture-u-'));
    if (!name) { rej(new Error('base de capture introuvable')); return; }
    const r = indexedDB.open(name);
    r.onerror = () => rej(r.error);
    r.onsuccess = () => {
      const tx = r.result.transaction(st, 'readonly').objectStore(st).getAll();
      tx.onsuccess = () => res(tx.result as any[]);
      tx.onerror = () => rej(tx.error);
    };
    }).catch(rej);
  }), store);
}
