import { expect, test } from './fixture';
import { createCm, waitSaved } from './helpers';

test.describe('LexNote multi-utilisateur', () => {
  test('un compte neuf démarre sans données de démonstration', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Bon cours/ })).toBeVisible();
    await expect(page.getByText(/données de démonstration/i)).toHaveCount(0);
    await page.goto('/sessions');
    await expect(page.getByRole('heading', { name: 'Mes séances', level: 1 })).toBeVisible();
    await expect(page.getByTestId('session-row')).toHaveCount(0);
  });

  test('gère CM, TD et TP avec une numérotation indépendante', async ({ page }) => {
    await page.goto('/');
    await createCm(page, { subject: 'Droit', module: 'Contrats', title: 'Introduction', type: 'CM' });
    await page.goto('/');
    await createCm(page, { subject: 'Économie', module: 'Micro', title: 'Exercices', type: 'TD' });
    await page.goto('/');
    await createCm(page, { subject: 'Finance', module: 'Valorisation', title: 'Application', type: 'TP' });

    await page.goto('/sessions');
    await expect(page.getByTestId('session-row')).toHaveCount(3);

    await page.getByRole('tab', { name: 'CM', exact: true }).click();
    await expect(page.getByTestId('session-row')).toHaveCount(1);
    await expect(page.getByTestId('session-row')).toContainText('CM');

    await page.getByRole('tab', { name: 'TD', exact: true }).click();
    await expect(page.getByTestId('session-row')).toHaveCount(1);
    await expect(page.getByTestId('session-row')).toContainText('TD');

    await page.getByRole('tab', { name: 'TP', exact: true }).click();
    await expect(page.getByTestId('session-row')).toHaveCount(1);
    await expect(page.getByTestId('session-row')).toContainText('TP');
  });

  test('les notes restent utilisables hors ligne et après rechargement', async ({ page, context }) => {
    await page.goto('/');
    await createCm(page, { subject: 'Offline', module: 'M', title: 'Séance hors ligne', type: 'CM' });
    await page.locator('.note-prose').click();
    await page.keyboard.type('Cette note doit survivre sans connexion.');
    await waitSaved(page);

    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('.note-prose')).toContainText('Cette note doit survivre sans connexion.');
    await expect(page.locator('body')).toContainText('LexNote');

    await page.goto('/sessions');
    await expect(page.getByRole('heading', { name: 'Mes séances', level: 1 })).toBeVisible();
    await expect(page.getByTestId('session-row')).toContainText('Séance hors ligne');
    await context.setOffline(false);
  });

  test('la déconnexion retire immédiatement les données personnelles de l’interface', async ({ page }) => {
    await page.goto('/');
    await createCm(page, { subject: 'Privé', module: 'M', title: 'SECRET-ACCOUNT-A', type: 'CM' });
    await page.goto('/settings');
    await page.getByRole('button', { name: /Se déconnecter/i }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('body')).not.toContainText('SECRET-ACCOUNT-A');
    await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
  });
});
