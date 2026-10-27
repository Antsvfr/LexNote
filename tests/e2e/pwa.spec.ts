import { expect, test } from '@playwright/test';
import { createCm, signUp, waitSaved } from './helpers';

/**
 * PWA — parties AUTOMATISABLES (Chromium) : manifeste, service worker, coque hors ligne, session conservée, retour en ligne.
 * NON automatisables ici (à vérifier à la main, voir docs/PRODUCTION_RUNBOOK.md §PWA) : invite d'installation du navigateur, installation réelle
 * sur iOS/Android, bouton « Mettre à jour » avec un VRAI second déploiement, comportement du Dock/écran d'accueil.
 */
test.describe('PWA', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'service worker + hors ligne : vérifiés sur Chromium (Firefox/WebKit : limitations du pilote, voir runbook)');

  test('manifeste installable : nom, mode autonome, icônes 192/512 + maskable, couleurs', async ({ page, request }) => {
    await page.goto('/login');
    const href = await page.locator('link[rel=manifest]').getAttribute('href');
    expect(href).toBeTruthy();
    const m = await (await request.get(new URL(href!, page.url()).toString())).json();
    expect(m).toMatchObject({ name: 'LexNote', display: 'standalone', start_url: '/', scope: '/', lang: 'fr' });
    const sizes = m.icons.map((i: { sizes: string; purpose?: string }) => `${i.sizes}${i.purpose ? `:${i.purpose}` : ''}`);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512', '512x512:maskable']));
    for (const i of m.icons) expect((await request.get(new URL(i.src, page.url()).toString())).status()).toBe(200);
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  test('service worker actif, coque disponible hors ligne, session conservée, retour en ligne', async ({ page, context }) => {
    await page.goto('/');
    const email = await signUp(page);
    await createCm(page, { subject: 'Droit', title: 'PWA' });
    await page.locator('.note-prose').click();
    await page.keyboard.type('Note avant la coupure');
    await waitSaved(page);

    // Le service worker prend le contrôle de la page après un rechargement.
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 }).toBe(true);

    // Hors ligne : rechargement d'une route PROFONDE → la coque est servie par le cache, l'utilisateur reste connecté.
    await context.setOffline(true);
    await page.goto('/sessions');
    await expect(page.getByTestId('sessions-new')).toBeVisible();
    await expect(page.getByTestId('session-row').first()).toContainText('PWA');
    await page.getByTestId('session-row').first().click();
    await expect(page.locator('.note-prose')).toContainText('Note avant la coupure');
    await page.locator('.note-prose').click();
    await page.keyboard.type(' — suite hors ligne');
    await waitSaved(page);

    // Retour en ligne : toujours connecté, rien de perdu.
    await context.setOffline(false);
    await page.reload();
    await expect(page.locator('.note-prose')).toContainText('suite hors ligne');
    await expect(page.getByTestId('auth-submit')).toHaveCount(0);
    expect(email).toContain('@');
  });

  test('aucune mise à jour automatique : pas de rechargement imposé pendant la saisie', async ({ page }) => {
    await page.goto('/');
    await signUp(page);
    await createCm(page, { subject: 'Droit', title: 'Pas de rechargement' });
    await page.evaluate(() => { (window as unknown as { __marker: string }).__marker = 'avant'; });
    await page.locator('.note-prose').click();
    await page.keyboard.type('texte');
    // un événement « controllerchange » simulé ne doit pas recharger la page (registerType: prompt)
    await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event('controllerchange')));
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { __marker?: string }).__marker)).toBe('avant');
  });
});
