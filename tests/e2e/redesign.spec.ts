import { expect, test } from '@playwright/test';
import { createCm, createSession, signUp, trackErrors, waitSaved } from './helpers';

/** Refonte premium : tableau de bord, navigation, thème, vignettes, pages — avec de VRAIES données créées par l'étudiant. */
test.describe('refonte visuelle — fonctionnalités réelles', () => {
  test('tableau de bord : statistiques calculées sur les vraies données, carte « reprendre », outils honnêtes', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/');
    await signUp(page, { firstName: '' });
    await expect(page.getByRole('heading', { name: 'Bon cours !' })).toBeVisible(); // pas de prénom : pas de prénom inventé
    await createCm(page, { subject: 'Histoire', module: 'Droit romain', title: 'Introduction' });
    await page.locator('.note-prose').click();
    await page.keyboard.type('un deux trois');
    await waitSaved(page);
    await page.goto('/');
    await expect(page.getByTestId('stat-Séances')).toContainText('1');
    await expect(page.getByTestId('stat-Matières')).toContainText('1');
    await expect(page.getByTestId('stat-Mots écrits')).toContainText('3');
    // reprise : la dernière séance en cours, avancement du module honnête (0/1 terminée)
    await expect(page.locator('.resume__title')).toContainText('Introduction');
    await expect(page.locator('.progress__label')).toContainText('0/1 séance terminée');
    await page.getByTestId('continue-last').click();
    await expect(page.getByTestId('editor')).toBeVisible();
    await page.goBack();
    // « CM suivant » : même module, numéro suivant
    await page.getByTestId('next-session').click();
    await page.getByRole('dialog').getByLabel(/^Titre/).fill('Suite');
    await page.getByTestId('create-session').click();
    await expect(page.locator('.titlefield__num')).toContainText('CM 02');
    await page.goto('/');
    // outils : Transcription active ; Documents et Assistant clairement « Bientôt » et inactifs
    await expect(page.getByTestId('tool-transcription')).toBeEnabled();
    await expect(page.getByTestId('tool-documents')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('tool-documents')).toContainText('Bientôt');
    await expect(page.getByTestId('tool-assistant')).toContainText('Bientôt');
    await page.getByTestId('tool-transcription').click();
    await expect(page.getByTestId('transcript-panel')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('profil : le prénom vient du profil, pas du code', async ({ page }) => {
    await page.goto('/');
    await signUp(page, { firstName: 'Anton' });
    await page.goto('/settings');
    await page.getByTestId('profile-name').fill('Camille');
    await page.getByTestId('profile-save').click();
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Bon cours, Camille !' })).toBeVisible();
    await expect(page.locator('.avatar')).toHaveText('C');
  });

  test('thème : sombre par défaut, bascule réelle depuis l’en-tête, persistant', async ({ page }) => {
    await page.goto('/');
    await signUp(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByRole('heading', { name: /Bon cours/ })).toBeVisible();
  });

  test('en-tête : la recherche ouvre la page Recherche ; menu notifications et profil', async ({ page }) => {
    await page.goto('/');
    await createCm(page, { subject: 'Droit', title: 'Vices du consentement' });
    await page.goto('/');
    await page.getByTestId('header-search').fill('consentement');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/search\?q=consentement/);
    await expect(page.getByTestId('search-input')).toHaveValue('consentement');
    await expect(page.getByTestId('search-results-cm')).toContainText('Vices du consentement');
    await page.getByRole('button', { name: 'Notifications' }).click();
    await expect(page.getByRole('menu')).toContainText('Aucune notification');
    await page.keyboard.press('Escape');
    await page.getByTestId('avatar').click();
    await expect(page.getByRole('menu')).toContainText('REV-EM · connexion bientôt disponible');
    await expect(page.getByTestId('account-email')).toContainText('@example.com');
    await page.keyboard.press('Escape');
  });

  test('barre latérale : « + » crée vraiment une matière ; Commandes ouvre la palette', async ({ page }) => {
    await page.goto('/');
    await signUp(page);
    await page.getByTestId('sidebar-new-subject').click();
    await page.getByTestId('subject-name').fill('Histoire du droit');
    await page.getByTestId('subject-save').click();
    await expect(page.locator('.sidebar').getByText('Histoire du droit')).toBeVisible();
    await page.getByTestId('nav-commands').click();
    await expect(page.getByTestId('palette-input')).toBeFocused();
  });

  test('liste des séances : menu ⋯ (changer l’image), onglets de type, filtre par titre', async ({ page }) => {
    await page.goto('/');
    await createCm(page, { subject: 'Finance', title: 'Valeur actuelle nette' });
    await createSession(page, { type: 'TD', title: 'Offre publique' });
    await createSession(page, { type: 'TP', title: 'Atelier tableur' });
    await page.goto('/sessions');
    await expect(page.getByTestId('session-row')).toHaveCount(3);
    await page.getByTestId('tab-TD').click();
    await expect(page.getByTestId('session-row')).toHaveCount(1);
    await page.getByTestId('tab-others').click();
    await expect(page.getByTestId('session-row')).toHaveCount(0);
    await page.getByTestId('tab-all').click();
    // vignette : changer l'image persiste
    const row = page.getByTestId('session-row').filter({ hasText: 'Valeur actuelle nette' });
    await expect(row.locator('img').first()).toHaveAttribute('data-thumb', 'chart');
    await row.getByTestId('row-menu').click();
    await page.getByRole('menuitem', { name: 'Ville' }).click();
    await page.reload();
    await expect(page.getByTestId('session-row').filter({ hasText: 'Valeur actuelle nette' }).locator('img').first()).toHaveAttribute('data-thumb', 'skyline');
    await page.getByLabel('Filtrer par titre').fill('offre');
    await expect(page.getByTestId('session-row')).toHaveCount(1);
  });

  test('page matières : cartes premium avec chiffres réels', async ({ page }) => {
    await page.goto('/');
    await createCm(page, { subject: 'Droit', module: 'Contrats', title: 'Vices du consentement' });
    await page.goto('/subjects');
    const droit = page.getByTestId('subject-card').filter({ hasText: 'Droit' }).first();
    await expect(droit).toContainText('1');
    await expect(droit).toContainText('module');
    await expect(droit).toContainText('Vices du consentement');
    await expect(page.getByTestId('subject-card')).toHaveCount(1);
  });

  test('responsive : tablette (tiroir), mobile (barre d’onglets), sans défilement horizontal', async ({ page }) => {
    await page.goto('/');
    await createCm(page, { subject: 'Droit', title: 'Responsive' });
    for (const [w, h] of [[1280, 800], [1024, 768], [820, 1180], [390, 844]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto('/');
      await expect(page.getByTestId('stat-Séances')).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${w}px`).toBeLessThanOrEqual(0);
    }
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/');
    await expect(page.locator('.sidebar')).toBeHidden();
    await page.getByRole('button', { name: 'Ouvrir la navigation' }).click();
    await expect(page.locator('.sidebar')).toBeVisible();
    await page.locator('.sidebar').getByRole('link', { name: 'Mes séances' }).click();
    await expect(page.getByRole('heading', { name: 'Mes séances', level: 1 })).toBeVisible();
    await expect(page.locator('.sidebar')).toBeHidden(); // se referme à la navigation
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('.tabbar')).toBeVisible();
  });

  test('éditeur et blocs : feuille d’écriture sombre, aucun composant clair égaré', async ({ page }) => {
    await page.goto('/');
    await createCm(page, { subject: 'Droit', title: 'Sombre' });
    await expect(page.locator('.note-editor')).toBeVisible();
    const bg = await page.locator('.note-editor').evaluate((e) => getComputedStyle(e).backgroundColor);
    const [r, g, b] = bg.match(/\d+/g)!.map(Number);
    expect((r! + g! + b!) / 3).toBeLessThan(60); // sombre
    await page.keyboard.press('Control+k');
    const pal = await page.locator('dialog.palette').evaluate((e) => getComputedStyle(e).backgroundColor);
    const [pr, pg, pb] = pal.match(/\d+/g)!.map(Number);
    expect((pr! + pg! + pb!) / 3).toBeLessThan(60);
  });
});
