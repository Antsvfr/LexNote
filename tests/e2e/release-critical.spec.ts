import { expect, test } from '@playwright/test';
import { createCm, logIn, logOut, PASSWORD, signUp, trackErrors, waitSaved } from './helpers';

/**
 * PARCOURS CRITIQUES de mise en production — rapide (≈ 1 min), à lancer avant chaque déploiement :
 *   npx playwright test tests/e2e/release-critical.spec.ts --project=chromium
 * (ALL_BROWSERS=1 pour Firefox et WebKit). Un échec ici bloque le déploiement (release/gates.json → e2e-critical).
 */
test.describe('release-critical', () => {
  test('inscription → séance → notes enregistrées → rechargement → notes retrouvées', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/');
    await signUp(page);
    await createCm(page, { subject: 'Droit civil', module: 'Obligations', title: 'Responsabilité' });
    await page.locator('.note-prose').click();
    await page.keyboard.type('Article 1240 : tout fait quelconque de l’homme');
    await waitSaved(page);
    await page.reload();
    await expect(page.locator('.note-prose')).toContainText('Article 1240');
    expect(errors.filter((e) => !/favicon|manifest|service worker/i.test(e))).toEqual([]);
  });

  test('connexion persistante : déconnexion puis reconnexion retrouve les notes', async ({ page }) => {
    await page.goto('/');
    const email = await signUp(page);
    await createCm(page, { subject: 'Histoire', title: 'Révolution' });
    await page.locator('.note-prose').click();
    await page.keyboard.type('Prise de la Bastille');
    await waitSaved(page);
    await page.goto('/');
    await logOut(page);
    await logIn(page, email);
    await page.getByRole('link', { name: 'Mes séances' }).first().click();
    await page.getByTestId('session-row').first().click();
    await expect(page.locator('.note-prose')).toContainText('Prise de la Bastille');
    expect(PASSWORD.length).toBeGreaterThan(8);
  });

  test('hors ligne : on écrit, rien n’est perdu, retour du réseau sans erreur', async ({ page, context }) => {
    await page.goto('/');
    await signUp(page);
    await createCm(page, { subject: 'Droit pénal', title: 'Infractions' });
    await context.setOffline(true);
    await page.locator('.note-prose').click();
    await page.keyboard.type('Écrit pendant la coupure réseau');
    await waitSaved(page);                                    // enregistré SUR L'APPAREIL
    await context.setOffline(false);
    await page.reload();
    await expect(page.locator('.note-prose')).toContainText('Écrit pendant la coupure réseau');
  });

  test('Réglages → Diagnostic : version, build, états, et AUCUN secret', async ({ page }) => {
    await page.goto('/');
    await signUp(page);
    await page.goto('/settings');
    await expect(page.getByTestId('app-version')).toContainText(/LexNote v\d+\.\d+\.\d+ \(/);
    await page.getByTestId('open-diagnostic').click();
    const root = page.getByTestId('system-status');
    await expect(root).toBeVisible();
    await expect(root.getByTestId('diag-version')).toContainText(/v\d+\.\d+\.\d+/);
    await expect(root.getByTestId('diag-idb')).toContainText('IndexedDB');
    await expect(root.getByTestId('diag-sync-state')).toBeVisible();
    const text = (await root.innerText()) + (await page.evaluate(() => document.documentElement.outerHTML));
    for (const forbidden of [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, /refresh_token/i, /service_role/i, /INTEGRATION_KEY/, /sk-ant-/, /Bearer\s+[A-Za-z0-9]/]) expect(text).not.toMatch(forbidden);
  });

  test('petit écran : la transcription est accessible dans une feuille (jamais masquée)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await signUp(page);
    await createCm(page, { subject: 'Droit', title: 'Mobile' });
    await expect(page.getByTestId('open-transcript-sheet')).toBeVisible();
    await page.getByTestId('open-transcript-sheet').click();
    const sheet = page.locator('.sidepanel');
    await expect(sheet).toBeVisible();
    // (l'ouverture est animée : on attend que la feuille ait fini de monter)
    await expect.poll(async () => { const b = (await sheet.boundingBox())!; return Math.round(b.y + b.height); }).toBeLessThanOrEqual(845);
    expect((await sheet.boundingBox())!.width).toBeGreaterThanOrEqual(389);
    await expect(page.getByTestId('tab-transcript')).toBeVisible();
    await page.getByTestId('close-sidepanel').click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByTestId('open-transcript-sheet')).toBeVisible();
  });
});
