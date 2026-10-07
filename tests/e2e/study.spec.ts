import { expect, test, type Page } from '@playwright/test';
import { courseWithContent, createCm, logOut, seedNotes, signUp, trackErrors } from './helpers';

/** Supports d'étude : fiches, cartes mentales, schémas, tableaux — dérivés du cours réel, sans invention. */

async function create(page: Page, card: string, setup?: () => Promise<void>) {
  await page.getByTestId('recap-create-support').click();
  await page.getByTestId(`support-${card}`).click();
  await setup?.();
  await page.getByTestId('support-create').click();
}
const lx = <T,>(page: Page, fn: string, ...args: unknown[]) => page.evaluate(([f, a]) => (window as any).__lx[f as string](...(a as unknown[])) as T, [fn, args] as const);

test.describe('fiche de cours', () => {
  test('création, structure juridique, aucune section inventée, sources, édition persistante, retour à la version générée', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/');
    await courseWithContent(page);
    await create(page, 'COURSE_SHEET', async () => { await page.getByTestId('mode-complete').click(); });
    await expect(page.getByTestId('sheet')).toBeVisible();
    await expect(page.getByTestId('artifact-generated')).toBeVisible();
    for (const k of ['definitions', 'articles', 'caselaw']) await expect(page.getByTestId(`sheet-sec-${k}`)).toBeVisible();
    // Le cours ne contient ni exception, ni exemple, ni piège : aucune rubrique correspondante.
    await expect(page.getByTestId('sheet')).not.toContainText(/exception|piège|exemples? du professeur/i);
    await expect(page.getByTestId('sheet-sec-articles').getByTestId('sheet-item')).toHaveCount(2);
    // Source d'un élément : extrait exact du cours.
    await page.getByTestId('sheet-sec-articles').getByRole('button', { name: 'Source' }).first().click();
    await expect(page.getByTestId('sources').first()).toContainText('Formation du contrat › Consentement › Erreur');
    await expect(page.getByTestId('sources').first()).toContainText('Art. 1132');

    // Édition → persistée après rechargement
    const first = page.getByTestId('sheet-sec-definitions').getByLabel('Contenu').first();
    await first.fill('Erreur : définition reformulée par moi.');
    await expect(page.getByTestId('artifact-edited')).toHaveCount(0); // sauvegarde différée…
    await page.waitForTimeout(900);
    await page.reload();
    await expect(page.getByTestId('sheet-sec-definitions').getByLabel('Contenu').first()).toHaveValue('Erreur : définition reformulée par moi.');
    await expect(page.getByTestId('artifact-edited')).toBeVisible();
    // Retour à la version générée
    await page.getByTestId('restore-generated').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Revenir' }).click();
    await expect(page.getByTestId('sheet-sec-definitions').getByLabel('Contenu').first()).toHaveValue(/fausse représentation/);
    expect(errors).toEqual([]);
  });

  test('modes express / standard / complète : volume croissant', async ({ page }) => {
    await page.goto('/');
    const sid = await courseWithContent(page);
    const sizes: number[] = [];
    for (const mode of ['express', 'standard', 'complete']) {
      await page.goto(`/session/${sid}/recap`);
      await create(page, 'COURSE_SHEET', async () => { await page.getByTestId(`mode-${mode}`).click(); });
      await expect(page.getByTestId('sheet')).toBeVisible();
      sizes.push((await page.getByTestId('sheet').innerText()).length);
    }
    expect(sizes[0]!).toBeLessThanOrEqual(sizes[1]!);
    expect(sizes[1]!).toBeLessThanOrEqual(sizes[2]!);
  });

  test('matière non juridique : notions issues des titres, aucune rubrique juridique', async ({ page }) => {
    await page.goto('/');
    await createCm(page, { subject: 'Finance', title: 'VAN' });
    const sid = page.url().split('/session/')[1]!.split(/[/?]/)[0]!;
    await seedNotes(page, sid, { type: 'doc', content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Valeur actuelle nette' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'La VAN actualise les flux futurs au taux requis.' }] },
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'TRI' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Le TRI annule la VAN du projet.' }] },
    ] });
    await page.goto(`/session/${sid}/recap`);
    await create(page, 'COURSE_SHEET');
    await expect(page.getByTestId('sheet-sec-concepts')).toContainText('Valeur actuelle nette');
    await expect(page.getByTestId('sheet')).not.toContainText(/Articles|Jurisprudences|Définitions/);
  });

  test('cours vide : refus clair, rien n’est inventé', async ({ page }) => {
    await page.goto('/');
    await createCm(page, { subject: 'Vide', title: 'Rien' });
    const sid = page.url().split('/session/')[1]!.split(/[/?]/)[0]!;
    await page.goto(`/session/${sid}/recap`);
    await create(page, 'COURSE_SHEET');
    await expect(page.getByTestId('support-error')).toContainText(/vide|rien à synthétiser|Aucun contenu/i);
    await expect(page).not.toHaveURL(/\/supports\//);
  });
});

test.describe('carte mentale', () => {
  test('structure réelle, interactions (sélection, sources, renommer, replier, recherche, zoom, centrer), persistance', async ({ page }) => {
    await page.goto('/');
    await courseWithContent(page);
    await create(page, 'MIND_MAP', async () => { await page.getByTestId('detail-detailed').click(); });
    await expect(page.getByTestId('mindmap')).toBeVisible();
    const titles = await page.getByTestId('mm-node').evaluateAll((els) => els.map((e) => e.getAttribute('data-title')));
    expect(titles).toEqual(expect.arrayContaining(['Droit des contrats', 'Formation du contrat', 'Consentement', 'Erreur', 'Dol', 'Violence', 'Capacité']));

    // sélection → panneau : explication + sources
    await page.locator('[data-testid="mm-node"][data-title="Dol"]').click();
    await expect(page.getByTestId('mm-panel')).toBeVisible();
    await expect(page.getByTestId('mm-panel')).toContainText('Formation du contrat › Consentement › Dol');
    // renommer
    await page.getByTestId('mm-title').fill('Dol (vice)');
    await expect(page.locator('[data-testid="mm-node"][data-title="Dol (vice)"]')).toBeVisible();
    // ajouter / supprimer une branche
    await page.getByTestId('mm-add-child').click();
    await expect(page.locator('[data-testid="mm-node"][data-title="Nouvelle branche"]')).toBeVisible();
    await page.getByTestId('mm-delete').click();
    await expect(page.locator('[data-testid="mm-node"][data-title="Nouvelle branche"]')).toHaveCount(0);
    // replier une branche
    const before = await page.getByTestId('mm-node').count();
    await page.locator('[data-testid="mm-node"][data-title="Consentement"] [data-testid="mm-toggle"]').click();
    expect(await page.getByTestId('mm-node').count()).toBeLessThan(before);
    await page.locator('[data-testid="mm-node"][data-title="Consentement"] [data-testid="mm-toggle"]').click();
    expect(await page.getByTestId('mm-node').count()).toBe(before);
    // recherche : trouve et sélectionne
    await page.getByTestId('mm-search').fill('violence');
    await expect(page.getByTestId('mm-count')).toContainText('résultat');
    await expect(page.getByTestId('mm-title')).toHaveValue('Violence');
    // zoom / centrer
    const z0 = await page.locator('[data-zoom]').first().getAttribute('data-zoom');
    await page.getByTestId('mm-zoom-in').click();
    expect(await page.locator('[data-zoom]').first().getAttribute('data-zoom')).not.toBe(z0);
    await page.getByTestId('mm-center').click();
    // persistance
    await page.waitForTimeout(900);
    await page.reload();
    await expect(page.locator('[data-testid="mm-node"][data-title="Dol (vice)"]')).toBeVisible();
    await expect(page.getByTestId('artifact-edited')).toBeVisible();
  });

  test('niveaux de détail : simple ≤ 15 nœuds, standard ≤ 30', async ({ page }) => {
    await page.goto('/');
    const sid = await courseWithContent(page);
    const counts: Record<string, number> = {};
    for (const d of ['simple', 'standard', 'detailed']) {
      await page.goto(`/session/${sid}/recap`);
      await create(page, 'MIND_MAP', async () => { await page.getByTestId(`detail-${d}`).click(); });
      await expect(page.getByTestId('mindmap')).toBeVisible();
      counts[d] = await page.getByTestId('mm-node').count();
    }
    expect(counts.simple!).toBeLessThanOrEqual(15);
    expect(counts.standard!).toBeLessThanOrEqual(30);
    expect(counts.simple!).toBeLessThan(counts.detailed!);
  });

  test('depuis une SECTION du cours : seule cette partie', async ({ page }) => {
    await page.goto('/');
    await courseWithContent(page);
    await create(page, 'MIND_MAP', async () => { await page.getByTestId('support-scope').selectOption({ label: '— Consentement' }); });
    await expect(page.getByTestId('mindmap')).toBeVisible();
    const titles = await page.getByTestId('mm-node').evaluateAll((els) => els.map((e) => e.getAttribute('data-title')));
    expect(titles).toContain('Consentement');
    expect(titles).not.toContain('Capacité');
    await expect(page.getByTestId('artifact-page')).toContainText('Consentement');
  });

  test('exports : SVG, PNG haute résolution, Markdown, impression sans interface', async ({ page }) => {
    await page.goto('/');
    await courseWithContent(page);
    await create(page, 'MIND_MAP');
    await expect(page.getByTestId('mindmap')).toBeVisible();
    await page.getByTestId('export-menu').click();
    const [svg] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-svg').click()]);
    expect(svg.suggestedFilename()).toMatch(/\.svg$/);
    const body = await (await import('node:fs/promises')).readFile((await svg.path())!, 'utf8');
    expect(body).toContain('<svg'); expect(body).toContain('Formation du contrat');
    await page.getByTestId('export-menu').click();
    const [png] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-png').click()]);
    const pngBuf = await (await import('node:fs/promises')).readFile((await png.path())!);
    expect(pngBuf.subarray(1, 4).toString()).toBe('PNG');
    expect(pngBuf.readUInt32BE(16)).toBeGreaterThan(1200); // largeur en pixels : résolution d'impression
    await page.getByTestId('export-menu').click();
    const [md] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-md').click()]);
    expect(await (await import('node:fs/promises')).readFile((await md.path())!, 'utf8')).toContain('- Droit des contrats');

    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('.sidebar')).toBeHidden();
    await expect(page.locator('.appheader')).toBeHidden();
    await expect(page.getByTestId('mm-canvas')).toBeHidden();
    await expect(page.locator('.print-svg svg')).toBeVisible();
  });

  test('mobile : consultable (zoom, déplacement), pas de défilement horizontal', async ({ page }) => {
    await page.goto('/');
    await courseWithContent(page);
    await create(page, 'MIND_MAP');
    await expect(page.getByTestId('mindmap')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('mm-canvas')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.getByTestId('mm-zoom-in').click();
    const box = (await page.getByTestId('mm-canvas').boundingBox())!;
    await page.mouse.move(box.x + 100, box.y + 100); await page.mouse.down(); await page.mouse.move(box.x + 160, box.y + 140); await page.mouse.up();
    await expect(page.getByTestId('mm-full')).toBeVisible();
  });
});

test.describe('schémas, tableaux et autres supports', () => {
  test('schéma : aucune étape / condition dans ce cours → refus honnête ; hiérarchie générée et éditable', async ({ page }) => {
    await page.goto('/');
    await courseWithContent(page);
    await create(page, 'DIAGRAM', async () => { await page.getByTestId('support-dtype').selectOption('PROCESS'); });
    await expect(page.getByTestId('support-error')).toContainText(/étapes/i);
    await page.getByTestId('support-dtype').selectOption('FLOWCHART');
    await page.getByTestId('support-create').click();
    await expect(page.getByTestId('support-error')).toContainText(/condition/i);
    await page.getByTestId('support-dtype').selectOption('HIERARCHY');
    await page.getByTestId('support-create').click();
    await expect(page.getByTestId('diagram')).toBeVisible();
    expect(await page.locator('[data-testid="dg-edge"]').evaluateAll((e) => e.map((x) => x.getAttribute('data-basis')))).not.toContain('inferred');
    // édition : relabel + ajout d'étape
    const n = await page.getByTestId('dg-node').count();
    await page.getByTestId('dg-node').nth(1).click();
    await page.getByTestId('dg-label').fill('Consentement (modifié)');
    await page.getByTestId('dg-add').click();
    expect(await page.getByTestId('dg-node').count()).toBe(n + 1);
    await page.waitForTimeout(900);
    await page.reload();
    await expect(page.getByTestId('dg-node').filter({ hasText: 'Consentement (modifié)' })).toHaveCount(1);
  });

  test('schéma de méthode : liste numérotée → processus ordonné', async ({ page }) => {
    await page.goto('/');
    await createCm(page, { subject: 'TD', type: 'TD', title: 'Méthode' });
    const sid = page.url().split('/session/')[1]!.split(/[/?]/)[0]!;
    const li = (t: string) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
    await seedNotes(page, sid, { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Cas pratique' }] }, { type: 'orderedList', content: ['Identifier les faits', 'Qualifier juridiquement', 'Formuler le problème', 'Donner la règle', 'Appliquer aux faits', 'Conclure'].map(li) }] });
    await page.goto(`/session/${sid}/recap`);
    await create(page, 'METHOD');
    await expect(page.getByTestId('diagram')).toBeVisible();
    await expect(page.getByTestId('dg-node')).toHaveCount(6);
    await expect(page.getByTestId('dg-edge')).toHaveCount(5);
  });

  test('tableau comparatif erreur / dol / violence : cellule muette = « — », sources, édition', async ({ page }) => {
    await page.goto('/');
    await courseWithContent(page);
    await create(page, 'COMPARISON_TABLE');
    await expect(page.getByTestId('comparison')).toBeVisible();
    await expect(page.locator('.cmp thead th input')).toHaveCount(3);
    const art = page.getByTestId('cmp-row').filter({ has: page.locator('input[value="Articles"]') });
    await expect(art.getByLabel(/Articles — Violence/)).toHaveValue('—');
    await art.getByLabel(/Articles — Dol/).focus();
    await expect(page.getByTestId('comparison')).toContainText('Art. 1137');
    await art.getByLabel(/Articles — Violence/).fill('Art. 1140 (ajouté par moi)');
    await page.waitForTimeout(900); await page.reload();
    await expect(page.getByTestId('cmp-row').filter({ has: page.locator('input[value="Articles"]') }).getByLabel(/Articles — Violence/)).toHaveValue('Art. 1140 (ajouté par moi)');
  });

  test('flashcards, quiz, chronologie', async ({ page }) => {
    await page.goto('/');
    const sid = await courseWithContent(page);
    await create(page, 'FLASHCARDS');
    await expect(page.getByTestId('flipcard')).toContainText(/Définir|Définition|Article/);
    await page.getByTestId('flipcard').click();
    await expect(page.getByTestId('flipcard')).toContainText(/fausse représentation|Art\.|manœuvres|contrainte/);
    await page.goto(`/session/${sid}/recap`);
    await create(page, 'QUIZ');
    await expect(page.getByTestId('quiz-q').first()).toBeVisible();
    await page.goto(`/session/${sid}/recap`);
    await create(page, 'TIMELINE'); // aucune date dans ce cours
    await expect(page.getByTestId('support-error')).toContainText(/dates/i);
  });
});

test.describe('mes supports, versions, assistant, sync', () => {
  test('liste filtrable, lien depuis la matière, suppression', async ({ page }) => {
    await page.goto('/');
    const sid = await courseWithContent(page);
    await create(page, 'COURSE_SHEET');
    await page.goto(`/session/${sid}/recap`);
    await create(page, 'MIND_MAP');
    await page.getByTestId('nav-supports').click();
    await expect(page.getByTestId('support-row')).toHaveCount(2);
    await page.getByTestId('stab-MIND_MAP').click();
    await expect(page.getByTestId('support-row')).toHaveCount(1);
    await expect(page.getByTestId('support-row')).toContainText('Droit civil');
    await page.getByTestId('stab-all').click();
    await page.getByTestId('support-row').first().click();
    await page.getByTestId('artifact-delete').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer' }).click();
    await expect(page.getByTestId('support-row')).toHaveCount(1);
  });

  test('« le cours a été mis à jour » : proposition de mise à jour, sans écraser mes modifications', async ({ page }) => {
    await page.goto('/');
    const sid = await courseWithContent(page);
    await create(page, 'COURSE_SHEET');
    await expect(page.getByTestId('stale-banner')).toHaveCount(0);
    const mine = page.getByTestId('sheet-sec-definitions').getByLabel('Contenu').first();
    await mine.fill('Ma version personnelle');
    await page.waitForTimeout(900);
    // Le cours change
    const { CONTRACT_DOC } = await import('./helpers');
    await seedNotes(page, sid, { ...CONTRACT_DOC, content: [...CONTRACT_DOC.content, { type: 'legalBlock', attrs: { kind: 'article' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Art. 1130 : nouvel article ajouté au cours.' }] }] }] });
    await page.reload();
    await expect(page.getByTestId('stale-banner')).toBeVisible();
    await expect(page.getByTestId('stale-banner')).toContainText('Vous avez modifié ce support');
    await page.getByTestId('stale-update').click();
    await expect(page).toHaveURL(/\/supports\//);
    await expect(page.getByTestId('artifact-title')).toHaveValue(/mis à jour/);
    await expect(page.getByTestId('sheet')).toContainText('Art. 1130');
    // l'original (modifié) est intact
    await page.getByTestId('nav-supports').click();
    await expect(page.getByTestId('support-row')).toHaveCount(2);
    await page.getByTestId('support-row').filter({ hasNotText: 'mis à jour' }).click();
    await expect(page.getByTestId('sheet-sec-definitions').getByLabel('Contenu').first()).toHaveValue('Ma version personnelle');
  });

  test('assistant : « Compare erreur, dol et violence » et « fiche uniquement sur … » passent par le même moteur', async ({ page }) => {
    await page.goto('/');
    const sid = await courseWithContent(page);
    await page.keyboard.press('Control+k');
    await page.getByTestId('palette-input').fill('Compare erreur, dol et violence');
    await page.getByRole('option', { name: /Créer : Tableau comparatif/ }).click();
    await expect(page.getByTestId('comparison')).toBeVisible();
    await page.goto(`/session/${sid}/recap`);
    await expect(page.getByTestId('recap-create-support')).toBeVisible();
    await page.keyboard.press('Control+k');
    await page.getByTestId('palette-input').fill('Fais-moi une fiche très courte uniquement sur le dol');
    await page.getByRole('option', { name: /Créer : Fiche de cours/ }).click();
    await expect(page.getByTestId('sheet')).toBeVisible();
    await expect(page.getByTestId('artifact-page')).toContainText('Dol');
    await expect(page.getByTestId('sheet')).not.toContainText('Violence');
    await page.goto(`/session/${sid}/recap`);
    await expect(page.getByTestId('recap-create-support')).toBeVisible();
    await page.keyboard.press('Control+k');
    await page.getByTestId('palette-input').fill('Fais-moi une fiche sur la prescription');
    await page.getByRole('option', { name: /Créer : Fiche de cours/ }).click();
    await expect(page.getByText(/ne trouve pas de partie/i)).toBeVisible();
  });

  test('synchronisation : supports séparés par compte, visibles sur un autre appareil, jamais chez un autre utilisateur', async ({ page, browser }) => {
    await page.goto('/');
    await courseWithContent(page);
    await create(page, 'MIND_MAP');
    await expect(page.getByTestId('mindmap')).toBeVisible();
    await page.getByTestId('sync-indicator').click();
    await expect.poll(async () => (await lx<unknown[]>(page, 'rows', 'study_artifacts')).length, { timeout: 15_000 }).toBe(1);
    const row = (await lx<{ type: string; user_id: string; content: { root: { title: string } } }[]>(page, 'rows', 'study_artifacts'))[0]!;
    expect(row.type).toBe('MIND_MAP');
    expect(row.content.root.title).toBe('Droit des contrats');
    // autre appareil
    const ctx2 = await browser.newContext({ storageState: await page.context().storageState(), baseURL: 'http://localhost:4173' });
    const p2 = await ctx2.newPage();
    await p2.goto('/supports');
    await expect(p2.getByTestId('support-row')).toHaveCount(1, { timeout: 15_000 });
    await ctx2.close();
    // autre utilisateur
    await page.goto('/');
    await logOut(page);
    await signUp(page);
    await page.goto('/supports');
    await expect(page.getByTestId('supports-empty')).toBeVisible();
  });

  test('performance : grosse carte (300 nœuds) fluide, branches profondes repliées', async ({ page }) => {
    await page.goto('/');
    await createCm(page, { subject: 'Gros', title: 'Gros cours' });
    const sid = page.url().split('/session/')[1]!.split(/[/?]/)[0]!;
    const content: unknown[] = [];
    for (let i = 0; i < 60; i++) content.push(
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: `Partie ${i}` }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: `Sous-partie ${i}` }] },
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: `Notion ${i}` }] },
      { type: 'legalBlock', attrs: { kind: 'article' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: `Art. ${i} : texte numéro ${i}` }] }] },
    );
    await seedNotes(page, sid, { type: 'doc', content });
    await page.goto(`/session/${sid}/recap`);
    await create(page, 'MIND_MAP', async () => { await page.getByTestId('detail-detailed').click(); });
    const t0 = Date.now();
    await expect(page.getByTestId('mindmap')).toBeVisible();
    const shown = await page.getByTestId('mm-node').count();
    expect(shown).toBeLessThan(250); // 241 nœuds au total : les branches profondes sont repliées
    expect(Date.now() - t0).toBeLessThan(5000);
    await page.getByRole('button', { name: 'Tout déplier' }).click();
    expect(await page.getByTestId('mm-node').count()).toBeGreaterThan(shown);
  });
});
