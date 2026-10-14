import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { PASSWORD, signUp, trackErrors, uniqueEmail } from './helpers';

/**
 * Authentification durable LexNote ⇄ REV-EM — parcours d'interface (backend SIMULÉ, VITE_BACKEND=mock).
 * La sécurité réelle (signatures, consentement en base, usage unique, fenêtre de 120 s, révocation, mauvais compte) est testée sur le vrai
 * code et sur deux bases PostgreSQL : src/integration/autologin.test.ts, tests/db/auth-devices.test.ts, src/services/integration/*.test.ts.
 */
const nonce = 'ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210_-ZyXwV';
const uuid = (n: number) => `7e2d1b40-5c3f-4a21-9b8e-${String(n).padStart(12, '0')}`;
const launchEntry = (intent: string) => `/integrations/revem/launch?intent=${intent}#n=${nonce}`;
const connectEntry = (intent: string) => `/integrations/revem/connect?intent=${intent}#n=${nonce}`;

/** Fermeture COMPLÈTE du navigateur : les cookies de session disparaissent, le stockage local reste. */
async function restartBrowser(ctx: BrowserContext, page: Page) { await ctx.clearCookies(); await page.goto('/'); }
const uidOf = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('lexnote-mock-auth') ?? '{}').sessionUserId as string | null);
async function loginWith(page: Page, email: string, remember: boolean) {
  await page.goto('/login');
  await page.getByTestId('auth-email').fill(email); await page.getByTestId('auth-password').fill(PASSWORD);
  if (remember) await page.getByTestId('auth-remember').check(); else await page.getByTestId('auth-remember').uncheck();
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('greeting')).toBeVisible();
}
async function logoutHere(page: Page) { await page.getByTestId('avatar').click(); await page.getByTestId('logout').click(); await expect(page).toHaveURL(/\/login/); }
/** Liaison simulée directement, avec ou sans consentement « connexion automatique ». */
const link = (page: Page, autoLogin: boolean) => page.evaluate((a) => {
  const uid = JSON.parse(localStorage.getItem('lexnote-mock-auth') ?? '{}').sessionUserId;
  const all = JSON.parse(localStorage.getItem('lexnote-mock-integration') ?? '{}');
  all[uid] = { linkId: 'lnk_' + 'b'.repeat(24), status: 'CONNECTED', linkedAt: new Date().toISOString(), autoLogin: a };
  localStorage.setItem('lexnote-mock-integration', JSON.stringify(all));
}, autoLogin);
/** REV-EM a créé ce lancement pour le compte (lié) `uid`. */
const ownLaunch = (page: Page, intent: string, uid: string) => page.evaluate(([i, u]) => localStorage.setItem(`lexnote-mock-launch-owner:${i}`, u), [intent, uid] as const);

test.describe('« Rester connecté sur cet appareil »', () => {
  test('décoché : session conservée dans un nouvel onglet, abandonnée à la réouverture du navigateur ; jamais de mot de passe stocké', async ({ page, context }) => {
    const email = await signUp(page); await logoutHere(page);
    await page.goto('/login');
    await expect(page.getByTestId('auth-remember')).not.toBeChecked();
    await expect(page.locator('body')).toContainText('N’utilisez pas cette option sur un appareil partagé');
    await loginWith(page, email, false);
    const tab = await context.newPage(); await tab.goto('/');                               // même session de navigateur
    await expect(tab.getByTestId('greeting')).toBeVisible();
    await tab.close();
    await restartBrowser(context, page);
    await expect(page).toHaveURL(/\/login/);
    // Ce que l'APPLICATION stocke (les clés `lexnote-mock-*` sont le faux SERVEUR du build de test, absent en production).
    const stored = await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries({ ...localStorage, ...sessionStorage }).filter(([k]) => !k.startsWith('lexnote-mock-')))));
    expect(stored).not.toContain(PASSWORD);
    expect((await context.cookies()).map((c) => `${c.name}=${c.value}`).join(';')).not.toContain(PASSWORD);
  });
  test('coché : toujours connecté après fermeture complète et réouverture du navigateur', async ({ page, context }) => {
    const email = await signUp(page); await logoutHere(page);
    await loginWith(page, email, true);
    await restartBrowser(context, page);
    await expect(page.getByTestId('greeting')).toBeVisible();
    await restartBrowser(context, page);
    await expect(page.getByTestId('greeting')).toBeVisible();
  });
});

test.describe('autorisation REV-EM : consentements explicites', () => {
  test('« Relier » obligatoire ; « Rester connecté » et « connexion automatique » jamais cochés d’office ; choix enregistrés et révocables', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/'); await signUp(page);
    await page.goto(connectEntry(uuid(1)));
    await expect(page.getByTestId('authorize-link')).toBeChecked();
    await expect(page.getByTestId('authorize-auto')).not.toBeChecked();
    await expect(page.locator('body')).toContainText('Vous pourrez désactiver cette autorisation à tout moment');
    await page.getByTestId('authorize-link').uncheck();
    await expect(page.getByTestId('authorize-accept')).toBeDisabled();
    await page.getByTestId('authorize-link').check();
    await page.getByTestId('authorize-auto').check();
    await page.getByTestId('authorize-accept').click();
    await expect(page.getByTestId('authorize-done-auto')).toContainText('Connexion automatique activée');
    await page.goto('/settings#apps-h');
    await expect(page.getByTestId('revem-auto-toggle')).toBeChecked();
    await page.getByTestId('revem-auto-toggle').uncheck();                                   // retrait seul : la liaison reste
    await expect(page.getByTestId('revem-auto-toggle')).not.toBeChecked();
    await expect(page.getByTestId('revem-status')).toContainText('Connecté');
    expect(errors).toEqual([]);
  });
  test('refus entre SERVEURS : message explicite + code, jamais « Votre session a expiré »', async ({ page }) => {
    await page.goto('/'); await signUp(page);
    await page.evaluate(() => localStorage.setItem('lexnote-mock-peer-auth-failed', '1'));
    await page.goto(connectEntry(uuid(2)));
    await expect(page.getByTestId('authorize-error')).toContainText('n’ont pas pu s’authentifier mutuellement');
    await expect(page.getByTestId('authorize-error-code')).toContainText('PEER_AUTH_FAILED · gateway-verify-jwt');
    await expect(page.getByTestId('authorize-error')).not.toContainText('session a expiré');
    await expect(page).toHaveURL(/\/integrations\/revem\/authorize/);                        // l'étudiant n'est PAS déconnecté
  });
  test('session réellement perdue : retour à la connexion avec explication, puis reprise de la MÊME demande', async ({ page }) => {
    const email = await signUp(page);
    await page.evaluate(() => localStorage.setItem('lexnote-mock-session-revoked', '1'));
    await page.goto(connectEntry(uuid(3)));
    await expect(page.getByTestId('session-expired')).toBeVisible();
    await page.evaluate(() => localStorage.removeItem('lexnote-mock-session-revoked'));
    await page.getByTestId('auth-email').fill(email); await page.getByTestId('auth-password').fill(PASSWORD); await page.getByTestId('auth-submit').click();
    await expect(page).toHaveURL(/\/integrations\/revem\/authorize\?intent=/);
    await expect(page.getByTestId('authorize-accept')).toBeEnabled();
  });
});

test.describe('ouverture depuis REV-EM : connexion invisible quand elle est autorisée', () => {
  test('CAS C — aucune session, connexion automatique autorisée : éditeur ouvert SANS écran de connexion, aucun jeton dans l’URL', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/'); await signUp(page); await link(page, true);
    const uid = (await uidOf(page))!; await logoutHere(page);
    const intent = uuid(10); await ownLaunch(page, intent, uid);
    const seen: string[] = []; page.on('framenavigated', (f) => { if (f === page.mainFrame()) seen.push(f.url()); });
    await page.goto(launchEntry(intent));
    await expect(page.getByTestId('editor')).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/session\/[^/?]+\?panel=transcript$/);
    expect(seen.some((u) => u.includes('/login'))).toBe(false);
    expect(seen.join(' ')).not.toMatch(/access_token|refresh_token|mock-sso/);
    expect(page.url()).not.toContain(nonce);
    expect(await uidOf(page)).toBe(uid);
    expect(errors).toEqual([]);
  });
  test('CAS D — connexion automatique non autorisée : connexion LexNote normale, puis le MÊME cours s’ouvre', async ({ page }) => {
    const email = await signUp(page); await link(page, false);
    const uid = (await uidOf(page))!; await logoutHere(page);
    const intent = uuid(11); await ownLaunch(page, intent, uid);
    await page.goto(launchEntry(intent));
    await expect(page).toHaveURL(/\/login/);
    await page.getByTestId('auth-email').fill(email); await page.getByTestId('auth-password').fill(PASSWORD); await page.getByTestId('auth-submit').click();
    await expect(page.getByTestId('editor')).toBeVisible({ timeout: 20_000 });
  });
  test('lancement déjà utilisé (rejeu du lien) : aucune session créée, message clair', async ({ page }) => {
    await page.goto('/'); await signUp(page); await link(page, true);
    const uid = (await uidOf(page))!;
    const intent = uuid(12); await ownLaunch(page, intent, uid);
    await page.goto(launchEntry(intent));
    await expect(page.getByTestId('editor')).toBeVisible({ timeout: 20_000 });
    await page.goto('/'); await logoutHere(page);
    await page.evaluate(() => sessionStorage.clear());
    await page.goto(launchEntry(intent));                                                     // même lien, rejoué
    await expect(page).toHaveURL(/\/login/);
    expect(await uidOf(page)).toBeNull();
  });
  test('mauvais compte connecté : explication et « Changer de compte » → le bon compte (connexion automatique)', async ({ page }) => {
    await page.goto('/'); await signUp(page); await link(page, true);
    const owner = (await uidOf(page))!; await logoutHere(page);
    await signUp(page, { email: uniqueEmail('autre') }); await link(page, false);
    const intent = uuid(13); await ownLaunch(page, intent, owner);
    await page.goto(launchEntry(intent));
    await expect(page.getByTestId('open-error')).toContainText('AUTRE compte LexNote');
    await page.getByTestId('open-switch-account').click();
    await expect(page.getByTestId('editor')).toBeVisible({ timeout: 20_000 });
    expect(await uidOf(page)).toBe(owner);
  });
});

test.describe('appareils et révocation', () => {
  test('cet appareil listé ; « Déconnecter tous les appareils » ferme la session ici aussi', async ({ page }) => {
    await page.goto('/'); await signUp(page);
    await page.goto('/settings#apps-h');
    await expect(page.getByTestId('device-row').first()).toContainText('(cet appareil)');
    await page.getByTestId('devices-logout-all').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Tout déconnecter' }).click();
    await expect(page).toHaveURL(/\/login/);
    expect(await uidOf(page)).toBeNull();
  });
  test('carte REV-EM de la barre latérale : « Session expirée » quand la session n’est plus valide, sinon état réel', async ({ page }) => {
    await page.goto('/'); await signUp(page); await link(page, false);
    await page.goto('/');
    await expect(page.getByTestId('revem-card-status')).toHaveText('● Connecté');
    await page.evaluate(() => localStorage.setItem('lexnote-mock-session-revoked', '1'));
    await page.reload();
    await expect(page.getByTestId('revem-card-status')).toHaveText('Session expirée');
    await expect(page.getByTestId('revem-card')).not.toContainText('bientôt');
  });
  test('hors ligne : message « hors ligne », jamais « session expirée »', async ({ page, context }) => {
    await page.goto('/'); await signUp(page);
    await page.goto('/settings#apps-h');
    await context.setOffline(true);
    await page.getByTestId('revem-refresh').click();
    await expect(page.getByTestId('connected-apps')).not.toContainText('session a expiré');
    await context.setOffline(false);
  });
});
