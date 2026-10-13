import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, logOut, signUp, trackErrors } from './helpers';

/**
 * « Prendre mes notes dans LexNote » (arrivée depuis REV-EM) — interface. Backend d'intégration SIMULÉ (VITE_BACKEND=mock) : la sécurité et
 * l'idempotence réelles (signatures, intentions à usage unique, contraintes UNIQUE) sont testées sur le vrai code et sur PostgreSQL
 * (src/integration/launch.test.ts). Ici : parcours, redirection directe vers l'éditeur, panneau Transcription, consentement micro, états d'erreur.
 */
const nonce = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE';
const uuid = (n: number) => `9f1c0a52-4d1e-4b43-8a7f-${String(n).padStart(12, '0')}`;
const entry = (intent: string, n = nonce) => `/integrations/revem/launch?intent=${intent}#n=${n}`;

async function connect(page: Page) {                         // liaison simulée directement (le parcours d'autorisation a sa propre spec)
  await page.evaluate(() => {
    const uid = JSON.parse(localStorage.getItem('lexnote-mock-auth') ?? '{}').sessionUserId;
    localStorage.setItem('lexnote-mock-integration', JSON.stringify({ [uid]: { linkId: 'lnk_' + 'a'.repeat(24), status: 'CONNECTED', linkedAt: new Date().toISOString() } }));
  });
}
const event = async (page: Page, intent: string, ev: Record<string, unknown>) => page.evaluate(([i, e]) => localStorage.setItem(`lexnote-mock-launch-event:${i}`, JSON.stringify(e)), [intent, ev] as const);
const base = { externalId: 'evt_1', subjectRef: 'subj_dc', subjectName: 'Droit des contrats', type: 'CM', title: 'Formation du contrat', date: '2026-10-09', startTime: '08:00', endTime: '10:00', room: 'A204', teacher: 'Mme Dupont' };
const counts = (page: Page) => page.evaluate(() => new Promise<{ subjects: number; sessions: number }>((res) => {
  const uid = JSON.parse(localStorage.getItem('lexnote-mock-auth') ?? '{}').sessionUserId; const r = indexedDB.open(`lexnote-u-${uid}`);
  r.onsuccess = () => { const db = r.result; const c = (s: string) => new Promise<number>((ok) => { const q = db.transaction(s).objectStore(s).count(); q.onsuccess = () => ok(q.result); }); void Promise.all([c('subjects'), c('sessions')]).then(([subjects, sessions]) => res({ subjects, sessions })); };
}));

const sessionRecord = (page: Page) => page.evaluate(() => new Promise<Record<string, unknown>>((res) => {
  const uid = JSON.parse(localStorage.getItem('lexnote-mock-auth') ?? '{}').sessionUserId; const r = indexedDB.open(`lexnote-u-${uid}`);
  r.onsuccess = () => { const q = r.result.transaction('sessions').objectStore('sessions').getAll(); q.onsuccess = () => res(q.result[0] as Record<string, unknown>); };
}));

test.describe('arrivée depuis REV-EM', () => {
  test('connecté + lié : matière et séance créées automatiquement, éditeur ouvert avec le panneau Transcription, micro NON démarré', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/'); await signUp(page); await connect(page);
    const intent = uuid(1); await page.goto('/');
    await page.goto(entry(intent));
    await expect(page.getByTestId('editor')).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/session\/[^/?]+\?panel=transcript$/);                  // directement l'éditeur, jamais l'accueil ni « nouvelle séance »
    expect(page.url()).not.toContain(nonce);
    await expect(page.getByTestId('transcript-panel')).toBeVisible();
    await expect(page.getByTestId('transcription-btn')).toBeVisible();                     // bouton Transcription prêt…
    await expect(page.getByTestId('rec-pill')).toHaveCount(0);                             // …mais AUCUN enregistrement démarré
    await expect(page.getByRole('dialog')).toHaveCount(0);                                 // pas de dialogue de consentement non sollicité
    await expect(page.getByTestId('title-input')).toHaveValue('Formation du contrat');
    await expect(page.locator('body')).toContainText('Droit des contrats');
    expect(await sessionRecord(page)).toMatchObject({ type: 'CM', title: 'Formation du contrat', date: '2026-10-09', startTime: '08:00', endTime: '10:00', room: 'A204', teacher: 'Mme Dupont', status: 'in_progress' });
    expect(await counts(page)).toEqual({ subjects: 1, sessions: 1 });
    expect(await page.evaluate(() => sessionStorage.getItem('lexnote-pending-launch'))).toBeNull();     // nonce effacé
    expect(errors).toEqual([]);
  });

  test('l’éditeur reste pleinement fonctionnel : notes écrites, autosave, consentement audio inchangé', async ({ page }) => {
    await page.goto('/'); await signUp(page); await connect(page);
    await page.goto(entry(uuid(2)));
    await expect(page.getByTestId('editor')).toBeVisible({ timeout: 20_000 });
    const ed = page.locator('.ProseMirror').first(); await ed.click(); await page.keyboard.type('Le consentement doit être libre et éclairé.');
    await expect(page.getByTestId('save-status')).toContainText(/Enregistr/i, { timeout: 10_000 });
    await page.reload(); await expect(page.locator('.ProseMirror').first()).toContainText('libre et éclairé');
    await page.getByTestId('transcription-btn').click();                                  // le consentement existant s'applique toujours
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByTestId('rec-pill')).toHaveCount(0);                            // tant qu'on n'a pas consenti : pas d'audio
  });

  test('même cours cliqué plusieurs fois (nouvelles intentions) → UNE séance, UNE matière ; un autre cours → autre séance, même matière', async ({ page }) => {
    await page.goto('/'); await signUp(page); await connect(page);
    for (const n of [3, 4, 5]) { await page.goto(entry(uuid(n))); await expect(page.getByTestId('editor')).toBeVisible({ timeout: 20_000 }); await page.goto('/'); }
    expect(await counts(page)).toEqual({ subjects: 1, sessions: 1 });
    const intent = uuid(6); await page.goto('/'); await event(page, intent, { ...base, externalId: 'evt_2', title: 'Vices du consentement' });
    await page.goto(entry(intent)); await expect(page.getByTestId('title-input')).toHaveValue('Vices du consentement', { timeout: 20_000 });
    expect(await counts(page)).toEqual({ subjects: 1, sessions: 2 });
  });

  test('NON connecté à LexNote : connexion puis reprise AUTOMATIQUE du même cours (jamais l’accueil)', async ({ page }) => {
    await page.goto('/'); const email = await signUp(page); await connect(page); await page.goto('/'); await logOut(page);
    await page.goto(entry(uuid(7)));
    await expect(page).toHaveURL(/\/login$/); expect(page.url()).not.toContain(nonce);
    await page.getByTestId('auth-email').fill(email); await page.getByTestId('auth-password').fill(PASSWORD); await page.getByTestId('auth-submit').click();
    await expect(page.getByTestId('editor')).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/session\/[^/?]+\?panel=transcript$/);
    await expect(page.getByTestId('title-input')).toHaveValue('Formation du contrat');
  });

  test('compte neuf (onboarding non terminé) : le lancement n’est pas détourné vers l’onboarding', async ({ page }) => {
    await page.goto('/signup');
    const email = `lancement${Date.now()}@example.com`;
    await page.getByTestId('auth-email').fill(email); await page.getByTestId('auth-password').fill(PASSWORD); await page.getByTestId('auth-password2').fill(PASSWORD); await page.getByTestId('auth-submit').click();
    await expect(page.getByTestId('onboarding-step-1')).toBeVisible();
    await connect(page);
    await page.goto(entry(uuid(8)));
    await expect(page.getByTestId('editor')).toBeVisible({ timeout: 20_000 });
  });

  test('comptes NON liés : aucune matière ni séance créée ; parcours « Applications connectées » proposé', async ({ page }) => {
    await page.goto('/'); await signUp(page);                                             // pas de connect()
    await page.goto(entry(uuid(9)));
    await expect(page.getByTestId('open-error')).toContainText('n’est pas connecté');
    await expect(page.getByTestId('open-connect')).toBeVisible();
    expect(await counts(page)).toEqual({ subjects: 0, sessions: 0 });
    await page.getByTestId('open-connect').click(); await expect(page).toHaveURL(/\/settings#apps-h$/); await expect(page.getByTestId('connected-apps')).toBeVisible();
  });

  test.describe('intentions invalides', () => {
    for (const [label, intent, code] of [['expirée', '00000000-0000-4000-8000-000000000001', 'expiré'], ['déjà utilisée', '11111111-1111-4111-8111-111111111111', 'déjà été utilisée']] as const) {
      test(`${label} → message clair, rien créé`, async ({ page }) => {
        await page.goto('/'); await signUp(page); await connect(page);
        await page.goto(entry(intent));
        await expect(page.getByTestId('open-error')).toContainText(code);
        expect(await counts(page)).toEqual({ subjects: 0, sessions: 0 });
      });
    }
    test('falsifiée (nonce invalide) → refusée ; lien sans nonce → retour à l’accueil', async ({ page }) => {
      await page.goto('/'); await signUp(page); await connect(page);
      await page.goto(entry(uuid(10), 'x' + nonce.slice(1)));
      await expect(page.getByTestId('open-error')).toContainText('pas valide');
      await page.goto(`/integrations/revem/launch?intent=${uuid(11)}`);
      await expect(page.getByTestId('greeting')).toBeVisible();
      expect(await counts(page)).toEqual({ subjects: 0, sessions: 0 });
    });
  });

  test('mobile : l’éditeur s’ouvre, sans débordement, bouton Transcription accessible', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/'); await signUp(page); await connect(page);
    await page.goto(entry(uuid(12)));
    await expect(page.getByTestId('editor')).toBeVisible({ timeout: 20_000 });
    // Le panneau latéral est masqué sous 860 px par la conception d'origine de LexNote ; la capture reste accessible depuis la barre d'outils.
    await expect(page.getByTestId('transcription-btn').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});

test.describe('carte REV-EM de la barre latérale', () => {
  test('état réel : « Non connecté » puis « Connecté » ; cliquable vers Applications connectées', async ({ page }) => {
    await page.goto('/'); await signUp(page);
    await expect(page.getByTestId('revem-card-status')).toHaveText('○ Non connecté');
    await expect(page.locator('body')).not.toContainText('Connexion bientôt disponible');
    await connect(page); await page.reload();
    await expect(page.getByTestId('revem-card-status')).toHaveText('● Connecté');
    await page.getByTestId('revem-card').click();
    await expect(page).toHaveURL(/\/settings#apps-h$/); await expect(page.getByTestId('connected-apps')).toBeVisible();
  });
});
