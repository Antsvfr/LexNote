import { expect, test } from '@playwright/test';
import { PASSWORD, createCm, logOut, signUp, trackErrors } from './helpers';

/**
 * Applications connectées (REV-EM) — interface. Backend d'intégration SIMULÉ (build VITE_BACKEND=mock) : la sécurité réelle
 * (signatures, rejeu, intentions, RLS, utilisateurs A/B) est testée sur le vrai code et sur PostgreSQL (src/integration, tests/db).
 */
const INTENT = '9f1c0a52-4d1e-4b43-8a7f-0c6a4f8f7a11';
const NONCE = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE';
const entry = (intent = INTENT, nonce = NONCE) => `/integrations/revem/connect?intent=${intent}#n=${nonce}`;

test.describe('Réglages › Applications connectées', () => {
  test('non connecté par défaut ; explique comment connecter ; aucune connexion sans action', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/'); await signUp(page);
    await page.goto('/settings');
    await expect(page.getByTestId('connected-apps')).toBeVisible();
    await expect(page.getByTestId('revem-status')).toHaveText('Non connecté');
    await expect(page.getByTestId('revem-howto')).toContainText('REV-EM › Réglages › Applications connectées');
    await expect(page.getByTestId('revem-disconnect')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('flux complet : lien de REV-EM → connexion LexNote → autorisation → Connecté → Déconnecter ; données conservées', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/'); const email = await signUp(page);
    await createCm(page, { subject: 'Droit civil', title: 'Séance à conserver' });
    await page.goto('/'); await logOut(page);

    // arrivée depuis REV-EM, NON connecté : le fragment (nonce) est mis à l'abri puis effacé de l'URL
    await page.goto(entry());
    await expect(page).toHaveURL(/\/login$/);
    expect(page.url()).not.toContain(NONCE);
    await page.getByTestId('auth-email').fill(email);                                  // connexion LexNote : la destination (?intent=) est conservée
    await page.getByTestId('auth-password').fill(PASSWORD);
    await page.getByTestId('auth-submit').click();
    await expect(page.getByTestId('authorize-revem')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/integrations/revem/authorize\\?intent=${INTENT}$`));
    expect(page.url()).not.toContain(NONCE);                                           // jamais dans l'URL
    await expect(page.locator('h1')).toContainText('REV-EM souhaite être connecté à votre compte LexNote.');
    await expect(page.getByTestId('authorize-hint')).toContainText('Alice');
    await expect(page.getByTestId('authorize-revem')).toContainText('jamais');
    const href = await page.evaluate(() => JSON.stringify([...Object.entries(localStorage)]));
    expect(href).not.toContain(NONCE);                                                 // le nonce n'est JAMAIS dans localStorage

    await page.getByTestId('authorize-accept').click();
    await expect(page.getByTestId('authorize-done')).toBeVisible();
    await expect(page.getByTestId('authorize-return')).toHaveAttribute('href', /lexnote_link=connected/);
    expect(await page.evaluate(() => sessionStorage.getItem('lexnote-pending-link'))).toBeNull();   // nonce à usage unique effacé

    await page.goto('/settings');
    await expect(page.getByTestId('revem-status')).toContainText('Connecté');
    await expect(page.getByTestId('revem-since')).toContainText('Connecté depuis le');
    await expect(page.getByTestId('revem-since')).toContainText('jamais vos notes');

    // déconnexion
    await page.getByTestId('revem-disconnect').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Déconnecter' }).click();
    await expect(page.getByTestId('revem-status')).toHaveText('Déconnecté');
    await expect(page.getByTestId('revem-revoked')).toContainText('Vos données n’ont pas été supprimées');
    // rechargement : l'état est celui du serveur
    await page.reload();
    await expect(page.getByTestId('revem-status')).toHaveText('Déconnecté');
    // aucune donnée métier supprimée
    await page.goto('/sessions');
    await expect(page.getByTestId('session-row')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('annuler : rien n’est connecté, le nonce est effacé', async ({ page }) => {
    await page.goto('/'); await signUp(page);
    await page.goto(entry());
    await expect(page.getByTestId('authorize-revem')).toBeVisible();
    await page.getByTestId('authorize-cancel').click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByTestId('revem-status')).toHaveText('Non connecté');
    expect(await page.evaluate(() => sessionStorage.getItem('lexnote-pending-link'))).toBeNull();
    await page.goto(`/integrations/revem/authorize?intent=${INTENT}`);                    // retour direct sans nonce : rien à autoriser
    await expect(page).toHaveURL(/\/settings$/);
  });

  test('demande expirée / déjà utilisée / code invalide : message clair, aucun état « connecté »', async ({ page }) => {
    await page.goto('/'); await signUp(page);
    await page.goto(entry('00000000-0000-4000-8000-000000000001'));
    await expect(page.getByTestId('authorize-error')).toContainText('expiré');
    await expect(page.getByTestId('authorize-accept')).toBeDisabled();
    await page.goto(entry('11111111-1111-4111-8111-111111111111'));
    await expect(page.getByTestId('authorize-error')).toContainText('déjà été utilisée');
    await page.goto(entry(INTENT, 'x'.repeat(43)));
    await expect(page.getByTestId('authorize-error')).toContainText('n’est pas valide');
    await page.goto('/settings');
    await expect(page.getByTestId('revem-status')).toHaveText('Non connecté');
  });

  test('paramètres malformés : aucune page d’autorisation', async ({ page }) => {
    await page.goto('/'); await signUp(page);
    await page.goto('/integrations/revem/connect?intent=pas-un-uuid#n=court');
    await expect(page).toHaveURL(/\/settings$/);
    await page.goto(`/integrations/revem/connect?intent=${INTENT}`);                       // sans nonce
    await expect(page).toHaveURL(/\/settings$/);
  });

  test('utilisateur B ne voit pas la connexion de A', async ({ page }) => {
    await page.goto('/'); await signUp(page);
    await page.goto(entry()); await page.getByTestId('authorize-accept').click();
    await expect(page.getByTestId('authorize-done')).toBeVisible();
    await page.goto('/settings'); await expect(page.getByTestId('revem-status')).toContainText('Connecté');
    await page.goto('/'); await logOut(page);
    await signUp(page);
    await page.goto('/settings');
    await expect(page.getByTestId('revem-status')).toHaveText('Non connecté');
  });

  test('la page d’autorisation exige une connexion LexNote', async ({ page }) => {
    await page.goto(`/integrations/revem/authorize?intent=${INTENT}`);
    await expect(page).toHaveURL(/\/login$/);
  });
});
