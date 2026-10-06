import { expect, test } from '@playwright/test';
import { createCm, trackErrors } from './helpers';

/** Refonte premium : tableau de bord, navigation, thème, vignettes, pages — avec de VRAIES données. */
test.describe('refonte visuelle — fonctionnalités réelles', () => {
  test('tableau de bord : statistiques calculées sur les vraies données, carte « reprendre », outils honnêtes', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Bon cours !' })).toBeVisible(); // pas de prénom : pas de prénom inventé
    await expect(page.getByTestId('stat-CM')).toContainText('8');
    await expect(page.getByTestId('stat-Matières')).toContainText('4');
    await expect(page.getByTestId('stat-Mots écrits')).toContainText('430');
    await expect(page.getByTestId('stat-Temps de notes')).toContainText('10 h 40');
    // créer un CM change la statistique (rien n'est codé en dur)
    await createCm(page, { subject: 'Histoire', module: 'Droit romain', title: 'Introduction' });
    await page.goto('/');
    await expect(page.getByTestId('stat-CM')).toContainText('9');
    await expect(page.getByTestId('stat-Matières')).toContainText('5');
    // reprise : le dernier CM en cours, avancement du module honnête (0/1 terminé)
    await expect(page.locator('.resume__title')).toContainText('Introduction');
    await expect(page.locator('.progress__label')).toContainText('0/1 CM terminés');
    await page.getByTestId('continue-last').click();
    await expect(page.getByTestId('editor')).toBeVisible();
    await page.goBack();
    // « CM suivant » : même module, numéro suivant
    await page.getByTestId('next-cm').click();
    await page.getByRole('dialog').getByLabel(/^Titre/).fill('Suite');
    await page.getByTestId('create-cm').click();
    await expect(page.locator('.titlefield__num')).toContainText('CM 02');
    await page.goto('/');
    // outils : Transcription active ; Documents et Assistant clairement « Bientôt » et inactifs
    await expect(page.getByTestId('tool-transcription')).toBeEnabled();
    await expect(page.getByTestId('tool-documents')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('tool-documents')).toContainText('Bientôt');
    await expect(page.getByTestId('tool-assistant')).toContainText('Bientôt');
    await page.getByTestId('tool-transcription').click();
    await expect(page.getByTestId('transcript-panel')).toBeVisible(); // ouvre le CM sur l'onglet Transcription
    // honnêteté : aucune fausse connexion REV-EM
    await page.goto('/');
    await expect(page.locator('.revem')).toContainText('Connexion bientôt disponible');
    await expect(page.locator('body')).not.toContainText('Connecté à REV-EM');
    expect(errors).toEqual([]);
  });

  test('profil : le prénom vient du profil, pas du code', async ({ page }) => {
    await page.goto('/settings');
    await page.getByTestId('profile-name').fill('Camille');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Bon cours, Camille !' })).toBeVisible();
    await expect(page.locator('.avatar')).toHaveText('C');
  });

  test('thème : sombre par défaut, bascule réelle depuis l’en-tête, persistant', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByRole('heading', { name: /Bon cours/ })).toBeVisible();
  });

  test('en-tête : la recherche ouvre la page Recherche ; menu notifications et profil', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('header-search').fill('consentement');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/search\?q=consentement/);
    await expect(page.getByTestId('search-input')).toHaveValue('consentement');
    await expect(page.getByTestId('search-results-cm')).toContainText('Vices du consentement');
    await expect(page.getByTestId('search-results')).toBeVisible(); // groupe « Notes »
    await page.getByRole('button', { name: 'Notifications' }).click();
    await expect(page.getByRole('menu')).toContainText('Aucune notification');
    await page.keyboard.press('Escape');
    await page.getByTestId('avatar').click();
    await expect(page.getByRole('menu')).toContainText('REV-EM · connexion bientôt disponible');
    await page.keyboard.press('Escape');
  });

  test('barre latérale : « + » crée vraiment une matière ; Commandes ouvre la palette', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('sidebar-new-subject').click();
    await page.getByLabel('Nom de la matière').fill('Histoire du droit');
    await page.getByRole('button', { name: 'Créer' }).click();
    await expect(page.locator('.sidebar').getByText('Histoire du droit')).toBeVisible();
    await page.getByTestId('nav-commands').click();
    await expect(page.getByTestId('palette-input')).toBeFocused();
  });

  test('liste des CM : menu ⋯ (changer l’image), filtres Tous / En cours / Terminés', async ({ page }) => {
    await page.goto('/sessions');
    await expect(page.getByTestId('session-row')).toHaveCount(8);
    await page.getByTestId('tab-completed').click();
    await expect(page.getByTestId('session-row')).toHaveCount(7);
    await page.getByTestId('tab-in_progress').click();
    await expect(page.getByTestId('session-row')).toHaveCount(1);
    await page.getByTestId('tab-all').click();
    // vignette : changer l'image persiste
    const row = page.getByTestId('session-row').filter({ hasText: 'Valeur actuelle nette' });
    await expect(row.locator('img').first()).toHaveAttribute('data-thumb', 'chart');
    await row.getByTestId('row-menu').click();
    await page.getByRole('menuitem', { name: 'Ville' }).click();
    await page.reload();
    await expect(page.getByTestId('session-row').filter({ hasText: 'Valeur actuelle nette' }).locator('img').first()).toHaveAttribute('data-thumb', 'skyline');
    // filtre par titre
    await page.getByLabel('Filtrer par titre').fill('offre');
    await expect(page.getByTestId('session-row')).toHaveCount(1);
  });

  test('page matières : cartes premium avec chiffres réels', async ({ page }) => {
    await page.goto('/subjects');
    const droit = page.getByTestId('subject-card').filter({ hasText: 'Droit' }).first();
    await expect(droit).toContainText('3');
    await expect(droit).toContainText('modules');
    await expect(droit).toContainText('Vices du consentement');
    await expect(page.getByTestId('subject-card')).toHaveCount(4);
  });

  test('responsive : tablette (tiroir), mobile (barre d’onglets), sans défilement horizontal', async ({ page }) => {
    for (const [w, h] of [[1280, 800], [1024, 768], [820, 1180], [390, 844]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto('/');
      await expect(page.getByTestId('stat-CM')).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${w}px`).toBeLessThanOrEqual(0);
    }
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/');
    await expect(page.locator('.sidebar')).toBeHidden();
    await page.getByRole('button', { name: 'Ouvrir la navigation' }).click();
    await expect(page.locator('.sidebar')).toBeVisible();
    await page.locator('.sidebar').getByRole('link', { name: 'Mes CM' }).click();
    await expect(page.getByRole('heading', { name: 'Mes CM', level: 1 })).toBeVisible();
    await expect(page.locator('.sidebar')).toBeHidden(); // se referme à la navigation
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('.tabbar')).toBeVisible();
  });

  test('éditeur et blocs : feuille d’écriture sombre, aucun composant clair égaré', async ({ page }) => {
    await page.goto('/session/demo-cm-c3');
    await expect(page.locator('.note-editor')).toBeVisible();
    const bg = await page.locator('.note-editor').evaluate((e) => getComputedStyle(e).backgroundColor);
    const [r, g, b] = bg.match(/\d+/g)!.map(Number);
    expect((r! + g! + b!) / 3).toBeLessThan(60); // sombre
    // modale et menu : mêmes surfaces sombres
    await page.keyboard.press('Control+k');
    const pal = await page.locator('dialog.palette').evaluate((e) => getComputedStyle(e).backgroundColor);
    const [pr, pg, pb] = pal.match(/\d+/g)!.map(Number);
    expect((pr! + pg! + pb!) / 3).toBeLessThan(60);
  });
});
