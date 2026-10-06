import { expect, test } from '@playwright/test';
import { createCm, mod, trackErrors, waitSaved } from './helpers';

test.describe('LexNote — parcours principal', () => {
  test('accueil, navigation et données de démo, sans erreur console', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Bon cours/ })).toBeVisible();
    await expect(page.getByText('données de démonstration')).toBeVisible();
    await expect(page.getByTestId('continue-last')).toBeVisible();

    await page.getByRole('link', { name: 'Mes matières' }).first().click();
    await expect(page.getByRole('heading', { name: 'Mes matières', level: 1 })).toBeVisible();
    await page.getByRole('link', { name: /^Droit\b/ }).first().click();
    await expect(page.getByRole('heading', { name: 'Droit des contrats' })).toBeVisible();
    await page.getByRole('link', { name: 'Mes CM' }).first().click();
    await expect(page.getByTestId('session-row').first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('créer matière + module + CM, écrire, blocs juridiques, persistance après rechargement', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/');
    await createCm(page, { subject: 'Procédure civile', module: 'Introduction', title: 'Principes directeurs' });

    const editor = page.locator('.note-prose');
    await editor.click();
    await page.keyboard.type('Le juge doit respecter le contradictoire');
    await waitSaved(page);

    // Bloc via la barre d'actions
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Définition', exact: true }).click();
    await page.keyboard.type('Contradictoire : principe de discussion des preuves');
    await expect(page.locator('[data-legal-block][data-kind="definition"]')).toHaveCount(1);
    // Deux Entrée : on sort du bloc (la ligne vide est retirée du bloc)
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Texte hors bloc');
    await expect(page.locator('[data-legal-block][data-kind="definition"]')).not.toContainText('Texte hors bloc');
    await page.keyboard.press('Enter');

    // Bloc via la palette Cmd/Ctrl+K
    await page.keyboard.press(`${mod}+k`);
    await expect(page.getByTestId('palette-input')).toBeFocused();
    await page.getByTestId('palette-input').fill('jurisprudence');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('palette-input')).toBeHidden();
    await expect(page.locator('[data-legal-block][data-kind="caselaw"]')).toHaveCount(1);
    await page.keyboard.type('Cass. civ. 2e, exemple');
    await expect(page.locator('[data-legal-block][data-kind="caselaw"]')).toHaveCount(1);

    await waitSaved(page);

    // Rechargement complet : les notes doivent être intactes
    await page.reload();
    await expect(page.locator('.note-prose')).toContainText('Le juge doit respecter le contradictoire');
    await expect(page.locator('[data-legal-block][data-kind="definition"]')).toContainText('Contradictoire');
    await expect(page.locator('[data-legal-block][data-kind="caselaw"]')).toContainText('Cass. civ. 2e');
    await expect(page.getByTestId('title-input')).toHaveValue('Principes directeurs');
    expect(errors).toEqual([]);
  });

  test('autosave : état "Enregistrement…" puis "✓ Enregistré", et sauvegarde même si on quitte vite', async ({ page }) => {
    await page.goto('/');
    await createCm(page, { subject: 'Test autosave', module: 'Mod', title: 'Autosave' });
    await page.locator('.note-prose').click();
    await page.keyboard.type('abc');
    await expect(page.getByTestId('save-status')).toContainText('Enregistrement');
    await waitSaved(page);
    // Quitter immédiatement après la frappe : le flush de sortie doit tout enregistrer
    await page.keyboard.type(' dernier mot');
    await page.getByRole('link', { name: /retour au module/i }).click();
    await page.getByRole('link', { name: /Autosave/ }).first().click();
    await expect(page.locator('.note-prose')).toContainText('abc dernier mot');
  });

  test('modifier le titre, mode Focus, Terminer le CM → récapitulatif', async ({ page }) => {
    await page.goto('/');
    await createCm(page, { subject: 'Focus', module: 'M', title: 'Avant' });
    await page.getByTestId('title-input').fill('Après modification');
    await page.locator('.note-prose').click();
    await page.keyboard.type('un deux trois quatre cinq');
    await waitSaved(page);

    // Focus
    await expect(page.locator('.topbar__crumbs')).toBeVisible();
    await page.getByTestId('focus-toggle').click();
    await expect(page.locator('.workspace.is-focus')).toBeVisible();
    await expect(page.locator('.topbar__crumbs')).toBeHidden();
    await expect(page.locator('.assistant')).toHaveCount(0);
    await expect(page.getByTestId('title-input')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.workspace.is-focus')).toHaveCount(0);

    // Terminer
    await page.getByTestId('finish-cm').click();
    await expect(page.getByTestId('recap-title')).toContainText('Après modification');
    await expect(page.getByTestId('recap-words')).toContainText('5');
    await expect(page.getByText('Cours restructuré')).toBeVisible();
    await expect(page.getByText('Fiche de révision')).toBeVisible();
    await expect(page.locator('.note-editor--readonly')).toContainText('un deux trois quatre cinq');
  });

  test('ouvrir un CM sans écrire ne le modifie pas (la démo reste supprimable)', async ({ page }) => {
    await page.goto('/session/demo-cm-c3');
    await expect(page.locator('.note-prose')).toContainText('Art. 1128');
    await page.waitForTimeout(1200);
    await page.goto('/');
    await page.getByRole('button', { name: 'Supprimer la démo' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer la démo' }).click();
    await page.goto('/sessions');
    await expect(page.getByTestId('session-row')).toHaveCount(0);
  });

  test('raccourcis clavier : blocs, gras, retrait, listes', async ({ page }) => {
    await page.goto('/');
    await createCm(page, { subject: 'Raccourcis', module: 'M', title: 'Clavier' });
    await page.locator('.note-prose').click();
    await page.keyboard.press(`${mod}+Alt+a`);
    await expect(page.locator('[data-legal-block][data-kind="article"]')).toHaveCount(1);
    await page.keyboard.type('Art. 1103');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter'); // sortie du bloc
    await page.keyboard.press(`${mod}+b`);
    await page.keyboard.type('gras');
    await page.keyboard.press(`${mod}+b`);
    await expect(page.locator('.note-prose strong')).toHaveText('gras');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.keyboard.type('indenté');
    await expect(page.locator('.note-prose p[data-indent="1"]')).toContainText('indenté');
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('.note-prose p[data-indent]')).toHaveCount(0);
    await page.keyboard.press('Enter');
    await page.keyboard.type('- liste');
    await expect(page.locator('.note-prose ul li')).toContainText('liste');
    await page.keyboard.press('Enter');
    await page.keyboard.type('sous');
    await page.keyboard.press('Tab');
    await expect(page.locator('.note-prose ul ul')).toHaveCount(1);
    await page.keyboard.press(`${mod}+z`);
  });

  test('recherche globale : matière, module, titre et contenu', async ({ page }) => {
    await page.goto('/search');
    const input = page.getByTestId('search-input');
    await input.fill('poussin');
    await expect(page.getByTestId('search-results')).toContainText('Conditions de validité');
    await input.fill('contrats');
    await expect(page.getByTestId('search-results-subjects')).toContainText('Droit des contrats');
    await input.fill('zzzzintrouvable');
    await expect(page.getByText('Aucun résultat')).toBeVisible();
  });

  test('supprimer un CM puis une matière, et supprimer la démo', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/');
    await createCm(page, { subject: 'À supprimer', module: 'M', title: 'Éphémère' });
    await page.goto('/sessions');
    const row = page.getByTestId('session-row').filter({ hasText: 'Éphémère' });
    await row.getByTestId('row-menu').click();
    await page.getByRole('menuitem', { name: 'Supprimer' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer' }).click();
    await expect(page.getByTestId('session-row').filter({ hasText: 'Éphémère' })).toHaveCount(0);

    await page.goto('/subjects');
    await page.getByRole('link', { name: /À supprimer/ }).first().click();
    await page.getByRole('button', { name: 'Supprimer', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer' }).click();
    await expect(page).toHaveURL(/\/subjects$/);
    await expect(page.getByRole('link', { name: /À supprimer/ })).toHaveCount(0);

    await page.goto('/');
    await page.getByRole('button', { name: 'Supprimer la démo' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer la démo' }).click();
    await expect(page.getByText('données de démonstration')).toHaveCount(0);
    await page.goto('/sessions');
    await expect(page.getByTestId('session-row')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('thème sombre persistant', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('radio', { name: 'Sombre' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('commandes IA affichées mais désactivées (aucune fausse fonctionnalité)', async ({ page }) => {
    await page.goto('/');
    await createCm(page, { subject: 'IA', module: 'M', title: 'x' });
    await page.keyboard.press(`${mod}+k`);
    await page.getByTestId('palette-input').fill('reformuler');
    const opt = page.getByRole('option', { name: /Reformuler/ });
    await expect(opt).toHaveAttribute('aria-disabled', 'true');
    await expect(opt).toContainText('Bientôt');
    await page.keyboard.press('Enter'); // ne fait rien
    await expect(page.getByTestId('palette-input')).toBeVisible();
  });
});

test.describe('responsive', () => {
  test('mobile : barre d’onglets, pas de scroll horizontal, consultation', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('.tabbar')).toBeVisible();
    await expect(page.locator('.sidebar')).toBeHidden();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.getByTestId('continue-last').click();
    await expect(page.getByTestId('editor')).toBeVisible();
    const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow2).toBeLessThanOrEqual(0);
  });

  test('tablette : mise en page fluide', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.goto('/');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.getByTestId('continue-last').click();
    await expect(page.getByTestId('editor')).toBeVisible();
  });
});

test.describe('PWA', () => {
  test('manifest valide, icônes servies, service worker actif, fonctionne hors ligne', async ({ page, context }) => {
    const errors = trackErrors(page);
    await page.goto('/');
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBeTruthy();
    const manifest = await (await page.request.get(href!)).json();
    expect(manifest).toMatchObject({ name: 'LexNote', display: 'standalone', start_url: '/' });
    expect(manifest.icons.some((i: { sizes: string; purpose?: string }) => i.sizes === '512x512' && i.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) {
      const r = await page.request.get(`/${icon.src}`);
      expect(r.ok(), icon.src).toBe(true);
    }

    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    const active = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state);
    expect(active).toBe('activated');
    await page.reload(); // le SW contrôle désormais la page

    await context.setOffline(true);
    await page.goto('/sessions');
    await expect(page.getByRole('heading', { name: 'Mes CM', level: 1 })).toBeVisible();
    await page.getByTestId('session-row').first().getByRole('link').click();
    await expect(page.locator('body')).toContainText('LexNote');
    await context.setOffline(false);
    expect(errors.filter((e) => !/net::ERR|Failed to load resource/.test(e))).toEqual([]);
  });
});
