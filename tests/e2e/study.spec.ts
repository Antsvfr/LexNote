import { expect, test, type Page } from '@playwright/test';
import { createCm, logOut, seedNotes, seedTranscript, sessionIdOf, signUp, trackErrors } from './helpers';

/** StudyArtifacts : supports de révision dérivés du COURS RECONSTRUIT (espace « Réviser »), avec provenance, sans invention. */

const T = (text: string) => ({ type: 'text', text });
const P = (text: string) => ({ type: 'paragraph', content: [T(text)] });
const H = (level: number, text: string) => ({ type: 'heading', attrs: { level }, content: [T(text)] });
const LB = (kind: string, text: string) => ({ type: 'legalBlock', attrs: { kind }, content: [P(text)] });
const OL = (...items: string[]) => ({ type: 'orderedList', content: items.map((x) => ({ type: 'listItem', content: [P(x)] })) });

const BASE = [
  H(1, 'Formation du contrat'), P('Le contrat se forme par la rencontre des volontés.'),
  H(2, 'Consentement'), P('Le consentement doit être libre et éclairé.'),
  H(3, 'Erreur'), LB('definition', 'Erreur : fausse représentation de la réalité.'), LB('article', 'Art. 1132 : l’erreur de droit ou de fait est une cause de nullité.'),
  H(3, 'Dol'), LB('definition', 'Dol : manœuvres destinées à tromper le cocontractant.'), LB('article', 'Art. 1137 : le dol est le fait pour un contractant d’obtenir le consentement par des manœuvres.'), LB('caselaw', 'Cass. civ. 3e : réticence dolosive.'),
  H(3, 'Violence'), LB('definition', 'Violence : contrainte qui inspire la crainte d’un mal considérable.'), LB('article', 'Art. 1140 : il y a violence lorsqu’une partie s’engage sous la pression d’une contrainte.'),
  H(2, 'Capacité'), P('Toute personne peut contracter sauf incapacité.'), LB('important', 'Les mineurs non émancipés sont incapables.'),
];
const METHOD = [H(1, 'Méthode du cas pratique'), P('Attention, ne confondez pas les faits et la qualification. Quelle est la règle applicable ?'), OL('Identifier les faits pertinents', 'Qualifier juridiquement', 'Énoncer la règle', 'Appliquer aux faits', 'Conclure')];
const HISTORY = [H(1, 'Histoire de la réforme'), P('Le Code civil a été promulgué en 1804.'), P('L’ordonnance du 10 février 2016 réforme le droit des contrats.'), P('La loi de ratification date de 2018.')];
const TRANSCRIPT = [{ id: 'g1', startMs: 3_752_000, text: 'Le dol, ce sont des manœuvres destinées à tromper le cocontractant, article 1137 du code civil.' }];

const lx = <T2,>(page: Page, fn: string, ...args: unknown[]) => page.evaluate(([f, a]) => (window as any).__lx[f as string](...(a as unknown[])) as T2, [fn, args] as const);
const doc = (...parts: unknown[][]) => ({ type: 'doc', content: parts.flat() });

/** Séance + notes (+ transcription) → cours reconstruit (v1) → espace « Réviser ». */
async function reconstructed(page: Page, content = doc(BASE, METHOD, HISTORY), opts: { goReview?: boolean } = {}) {
  await page.goto('/');
  await createCm(page, { subject: 'Droit civil', title: 'Droit des contrats' });
  const sid = sessionIdOf(page);
  await seedNotes(page, sid, content);
  await seedTranscript(page, sid, TRANSCRIPT);
  await page.goto(`/session/${sid}/course`);
  await page.getByTestId('generate-course').click();
  await expect(page.getByTestId('course-doc')).toBeVisible({ timeout: 30_000 });
  if (opts.goReview !== false) await page.getByTestId('space-review').click();
  return sid;
}
async function create(page: Page, type: string, setup?: () => Promise<void>) {
  await page.getByTestId(`review-create-${type}`).click();
  await setup?.();
  await page.getByTestId('support-create').click();
}

test.describe('espace « Réviser »', () => {
  test('sans cours reconstruit : explication, aucune génération possible ; avec cours : 8 actions de création', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/');
    await createCm(page, { subject: 'Droit civil', title: 'Vide' });
    const sid = sessionIdOf(page);
    await seedNotes(page, sid, doc(BASE));
    await page.goto(`/session/${sid}/review`);
    await expect(page.getByTestId('review-nocourse')).toContainText('pas encore été reconstruit');
    await expect(page.getByTestId('review-create-QUIZ')).toHaveCount(0);
    await page.getByTestId('space-course').click();
    await page.getByTestId('generate-course').click();
    await expect(page.getByTestId('course-doc')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('space-review').click();
    await expect(page.getByTestId('review-empty')).toBeVisible();
    for (const t of ['COURSE_SHEET', 'MIND_MAP', 'DIAGRAM', 'COMPARISON_TABLE', 'TIMELINE', 'METHOD', 'FLASHCARDS', 'QUIZ']) await expect(page.getByTestId(`review-create-${t}`)).toBeVisible();
    expect(errors).toEqual([]);
  });
});

test.describe('fiche', () => {
  test('création, provenance « Généré à partir du cours », source cliquable, édition persistante, retour à la version générée', async ({ page }) => {
    const errors = trackErrors(page);
    await reconstructed(page);
    await create(page, 'COURSE_SHEET', async () => { await page.getByTestId('mode-complete').click(); });
    await expect(page.getByTestId('sheet')).toBeVisible();
    await expect(page.getByTestId('artifact-generated')).toBeVisible();
    await expect(page.getByTestId('artifact-provenance')).toContainText('Généré à partir du cours — version 1');
    for (const k of ['definitions', 'articles', 'caselaw']) await expect(page.getByTestId(`sheet-sec-${k}`)).toBeVisible();
    await expect(page.getByTestId('sheet')).not.toContainText(/exception|exemples? du professeur/i);

    // Source : le même badge que dans le cours (Notes + PDF + transcription…), qui ramène à l'extrait exact.
    const item = page.getByTestId('sheet-sec-articles').getByTestId('sheet-item').filter({ hasText: 'Art. 1137' });
    await item.first().getByRole('button', { name: 'Source' }).click();
    await item.first().getByTestId('source-badge').first().click();
    await expect(page.getByTestId('source-popover')).toContainText('Transcription 01:02:32');
    await page.keyboard.press('Escape');

    const first = page.getByTestId('sheet-sec-definitions').getByLabel('Contenu').first();
    await first.fill('Erreur : définition reformulée par moi.');
    await page.waitForTimeout(900);
    await page.reload();
    await expect(page.getByTestId('sheet-sec-definitions').getByLabel('Contenu').first()).toHaveValue('Erreur : définition reformulée par moi.');
    await expect(page.getByTestId('artifact-edited')).toBeVisible();
    await page.getByTestId('restore-generated').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Revenir' }).click();
    await expect(page.getByTestId('sheet-sec-definitions').getByLabel('Contenu').first()).toHaveValue(/fausse représentation/);
    expect(errors).toEqual([]);
  });

  test('modes express / standard / complète : volume croissant', async ({ page }) => {
    const sid = await reconstructed(page);
    const sizes: number[] = [];
    for (const mode of ['express', 'standard', 'complete']) {
      await page.goto(`/session/${sid}/review`);
      await create(page, 'COURSE_SHEET', async () => { await page.getByTestId(`mode-${mode}`).click(); });
      await expect(page.getByTestId('sheet')).toBeVisible();
      sizes.push((await page.getByTestId('sheet').innerText()).length);
    }
    expect(sizes[0]!).toBeLessThanOrEqual(sizes[1]!);
    expect(sizes[1]!).toBeLessThanOrEqual(sizes[2]!);
  });
});

test.describe('carte mentale, tableau, chronologie, méthode', () => {
  test('carte mentale : profondeur réglable, repli/dépli, clic sur un nœud → sources', async ({ page }) => {
    await reconstructed(page);
    await create(page, 'MIND_MAP', async () => { await page.getByTestId('depth-1').click(); });
    await expect(page.getByTestId('mindmap')).toBeVisible();
    const shallow = await page.getByTestId('mm-node').count();
    await page.goto(page.url().replace(/\/supports\/.*/, '/supports'));
    await page.getByTestId('support-row').first().click();
    await page.getByRole('link', { name: 'Réviser' }).click();
    await create(page, 'MIND_MAP', async () => { await page.getByTestId('depth-4').click(); });
    await expect(page.getByTestId('mindmap')).toBeVisible();
    await page.getByRole('button', { name: 'Tout déplier' }).click();
    expect(await page.getByTestId('mm-node').count()).toBeGreaterThan(shallow);
    await page.getByTestId('mm-node').filter({ hasText: 'Dol' }).first().click();
    await expect(page.getByTestId('mm-panel')).toBeVisible();
    await expect(page.getByTestId('mm-panel').getByTestId('source-badge').first()).toBeVisible();
    const branch = page.locator('[data-testid="mm-node"][data-title="Consentement"]');
    const before = await page.getByTestId('mm-node').count();
    await branch.getByTestId('mm-toggle').click();
    expect(await page.getByTestId('mm-node').count()).toBeLessThan(before);
  });

  test('tableau comparatif : erreur / dol / violence ; une seule notion → refus expliqué', async ({ page }) => {
    await reconstructed(page);
    await create(page, 'COMPARISON_TABLE');
    await expect(page.getByTestId('comparison')).toBeVisible();
    for (const n of ['Erreur', 'Dol', 'Violence']) await expect(page.getByLabel('Notion', { exact: true }).and(page.locator(`[value="${n}"]`))).toHaveCount(1);
    await expect(page.getByTestId('comparison')).not.toContainText('Capacité');
    await page.getByTestId('cmp-row').first().locator('textarea').first().focus();
    await expect(page.getByTestId('comparison').getByTestId('source-badge').first()).toBeVisible();

    await page.getByRole('link', { name: 'Réviser' }).click();
    await page.getByTestId('review-create-COMPARISON_TABLE').click();
    const concepts = page.getByTestId('support-concepts');
    await expect(concepts.locator('input:checked')).toHaveCount(3);
    await concepts.getByLabel('Erreur', { exact: true }).uncheck();
    await concepts.getByLabel('Dol', { exact: true }).uncheck();
    await expect(concepts.locator('input:checked')).toHaveCount(1);
    await page.getByTestId('support-create').click();
    await expect(page.getByTestId('support-error')).toContainText(/au moins deux notions/i);
  });

  test('chronologie : dates du cours uniquement ; sans dates → refus (aucune date inventée)', async ({ page }) => {
    await reconstructed(page);
    await create(page, 'TIMELINE');
    const dates = await page.getByTestId('timeline-event').getByLabel('Date').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    expect(dates).toEqual(expect.arrayContaining(['1804', '10 février 2016', '2018']));
    expect(dates.join(' ')).not.toMatch(/\b1(132|137|140)\b/); // un numéro d'article n'est pas une date

    await page.goto('/');
    await reconstructed(page, doc(BASE), { goReview: true });
    await page.getByTestId('review-create-TIMELINE').click();
    await page.getByTestId('support-create').click();
    await expect(page.getByTestId('support-error')).toContainText(/moins de deux dates/i);
  });

  test('méthode : étapes, questions du cours, erreurs signalées, checklist cochable et persistante', async ({ page }) => {
    await reconstructed(page);
    await create(page, 'METHOD');
    await expect(page.getByTestId('method')).toBeVisible();
    await expect(page.getByTestId('method-steps').getByRole('listitem')).toHaveCount(5);
    await expect(page.getByTestId('method-questions')).toContainText('Quelle est la règle applicable ?');
    await expect(page.getByTestId('method-pitfalls')).toContainText(/ne confondez pas/i);
    await page.getByTestId('method-checklist').getByRole('checkbox').first().check();
    await page.waitForTimeout(900);
    await page.reload();
    await expect(page.getByTestId('method-checklist').getByRole('checkbox').first()).toBeChecked();

    await page.goto('/');
    await reconstructed(page, doc(BASE));
    await page.getByTestId('review-create-METHOD').click();
    await page.getByTestId('support-create').click();
    await expect(page.getByTestId('support-error')).toContainText(/aucun passage méthodologique/i);
  });
});

test.describe('flashcards et quiz', () => {
  test('flashcards : question / réponse / difficulté / concept, « Pourquoi cette flashcard ? » → source', async ({ page }) => {
    await reconstructed(page);
    await create(page, 'FLASHCARDS', async () => { await page.getByTestId('count-10').click(); });
    await expect(page.getByTestId('flashcards')).toBeVisible();
    expect(await page.getByTestId('card-row').count()).toBeLessThanOrEqual(10);
    await expect(page.getByTestId('flipcard')).toContainText(/Question/);
    await page.getByTestId('flipcard').click();
    await expect(page.getByTestId('flipcard')).toContainText(/Réponse/);
    await expect(page.getByTestId('difficulty').first()).toBeVisible();
    await expect(page.getByText('Pourquoi cette flashcard ?')).toBeVisible();
    await page.locator('.study').getByTestId('source-badge').click();
    await expect(page.getByTestId('source-popover')).toBeVisible();
    await expect(page.getByTestId('source-popover').getByTestId('source-open').first()).toBeVisible();
    await page.keyboard.press('Escape');
    const n = await page.getByTestId('card-row').count();
    await page.getByRole('button', { name: 'Supprimer la carte' }).first().click();
    await expect(page.getByTestId('card-row')).toHaveCount(n - 1);
  });

  test('quiz : QCM / vrai-faux / court, correction + explication + source, score', async ({ page }) => {
    await reconstructed(page);
    await create(page, 'QUIZ', async () => { await page.getByTestId('count-10').click(); });
    await expect(page.getByTestId('quiz')).toBeVisible();
    const q = page.getByTestId('quiz-q');
    expect(await q.count()).toBeGreaterThan(2);
    const mcq = q.filter({ has: page.getByTestId('quiz-option') }).first();
    await mcq.getByTestId('quiz-option').first().click();
    await expect(mcq.getByTestId('quiz-explain')).toBeVisible();
    await expect(mcq.getByTestId('quiz-explain')).toContainText(/Bonne réponse|Mauvaise réponse/);
    await expect(mcq.getByTestId('source-badge')).toBeVisible();
    await expect(page.getByTestId('quiz-score')).toContainText('/ 1');
    await page.getByRole('button', { name: 'Recommencer' }).click();
    await expect(page.getByTestId('quiz-score')).toContainText('/ 0');
  });

  test('matière insuffisante : explication au lieu d’un support médiocre', async ({ page }) => {
    await reconstructed(page, doc([H(1, 'Titre seul')]));
    await page.getByTestId('review-create-FLASHCARDS').click();
    await page.getByTestId('support-create').click();
    await expect(page.getByTestId('support-error')).toBeVisible();
    await expect(page).not.toHaveURL(/\/supports\//);
  });
});

test.describe('versions, régénération, suppression', () => {
  test('cours mis à jour : bannière ; un support modifié n’est jamais écrasé (copie), la copie vient du cours v2', async ({ page }) => {
    const sid = await reconstructed(page);
    await create(page, 'COURSE_SHEET');
    await expect(page.getByTestId('sheet')).toBeVisible();
    const url = page.url();
    await page.getByTestId('sheet-sec-definitions').getByLabel('Contenu').first().fill('Ma définition personnelle.');
    await page.waitForTimeout(900);

    // Le cours évolue → version 2
    await seedNotes(page, sid, doc(BASE, [H(2, 'Objet'), LB('definition', 'Objet : prestation que doit chaque partie au contrat.')]));
    await page.goto(`/session/${sid}/course`);
    await page.getByTestId('generate-course').click();
    await expect(page.getByTestId('course-meta')).toContainText('Version 2', { timeout: 30_000 });
    await page.goto(url);
    await expect(page.getByTestId('stale-banner')).toContainText('mis à jour');
    await expect(page.getByTestId('stale-banner')).toContainText('ne sera pas écrasé');
    await page.getByTestId('stale-update').click();

    // Copie issue du cours v2 ; l'original modifié est intact.
    await expect(page.getByTestId('artifact-provenance')).toContainText('version 2');
    await expect(page.getByTestId('sheet')).toContainText('Objet');
    await page.goto(url);
    await expect(page.getByTestId('sheet-sec-definitions').getByLabel('Contenu').first()).toHaveValue('Ma définition personnelle.');
    await expect(page.getByTestId('artifact-provenance')).toContainText('version 1');
    await page.goto(`/session/${sid}/review`);
    await expect(page.getByTestId('support-row')).toHaveCount(2);
    await expect(page.getByTestId('stale-tag')).toHaveCount(1);
  });

  test('support non modifié : « Régénérer » met à jour sur place ; duplication ; suppression', async ({ page }) => {
    const sid = await reconstructed(page);
    await create(page, 'COURSE_SHEET');
    await page.getByTestId('artifact-regenerate').click();
    await expect(page.getByTestId('artifact-generated')).toBeVisible();
    await page.getByRole('button', { name: 'Dupliquer' }).click();
    await expect(page.getByTestId('artifact-title')).toHaveValue(/\(copie\)/);
    await page.getByTestId('artifact-delete').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer' }).click();
    await expect(page).toHaveURL(/\/supports$/);
    await expect(page.getByTestId('support-row')).toHaveCount(1);
    await page.goto(`/session/${sid}/review`);
    await expect(page.getByTestId('support-row')).toHaveCount(1);
  });
});

test.describe('synchronisation et isolation', () => {
  test('supports synchronisés avec provenance, rouverts sur un autre appareil, jamais visibles par un autre utilisateur', async ({ page, browser }) => {
    const sid = await reconstructed(page);
    await create(page, 'FLASHCARDS', async () => { await page.getByTestId('count-10').click(); });
    await expect(page.getByTestId('flashcards')).toBeVisible();
    await page.getByTestId('sync-indicator').click();
    await expect.poll(async () => (await lx<unknown[]>(page, 'rows', 'study_artifacts')).length, { timeout: 20_000 }).toBe(1);
    await expect.poll(async () => (await lx<unknown[]>(page, 'rows', 'generated_courses')).length, { timeout: 20_000 }).toBe(1);
    const row = (await lx<{ type: string; course_version: number; user_id: string; provenance: { from: string } }[]>(page, 'rows', 'study_artifacts'))[0]!;
    expect(row.type).toBe('FLASHCARDS');
    expect(row.course_version).toBe(1);
    expect(row.provenance.from).toBe('reconstructed-course');

    const ctx2 = await browser.newContext({ storageState: await page.context().storageState(), baseURL: 'http://localhost:4173' });
    const p2 = await ctx2.newPage();
    await p2.goto('/sessions');
    await expect(p2.getByTestId('session-row')).toHaveCount(1, { timeout: 20_000 }); // la synchro a rapatrié la séance
    await p2.goto(`/session/${sid}/review`);
    await expect(p2.getByTestId('support-row')).toHaveCount(1, { timeout: 20_000 });
    await p2.getByTestId('support-row').click();
    await expect(p2.getByTestId('flashcards')).toBeVisible();
    await expect(p2.getByText('Pourquoi cette flashcard ?')).toBeVisible();
    await ctx2.close();

    await page.goto('/');
    await logOut(page);
    await signUp(page);
    await page.goto('/supports');
    await expect(page.getByTestId('supports-empty')).toBeVisible();
    await page.goto(`/session/${sid}/review`);
    await expect(page).not.toHaveURL(/\/review/);
  });
});

test.describe('palette', () => {
  test('commande naturelle → même chemin que « Réviser » (cours reconstruit)', async ({ page }) => {
    await reconstructed(page);
    await page.keyboard.press('Control+k');
    await page.getByTestId('palette-input').fill('Fais-moi une fiche sur le dol');
    await page.getByRole('option', { name: /Créer : Fiche/ }).click();
    await expect(page.getByTestId('sheet')).toBeVisible();
    await expect(page.getByTestId('artifact-provenance')).toContainText('Généré à partir du cours');
  });
});
