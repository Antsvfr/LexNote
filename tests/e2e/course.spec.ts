import { expect, test, type Page } from '@playwright/test';
import { makeDocx, makePdf, makePptx } from '../../src/test/docs';
import { CONTRACT_DOC, createCm, logOut, seedNotes, seedTranscript, sessionIdOf, signUp, trackErrors, waitSaved } from './helpers';

/** Intelligent Course Engine : sources (notes, transcription, documents) → cours reconstruit, avec provenance. */

const buf = (u: Uint8Array) => Buffer.from(u);
const lx = <T,>(page: Page, fn: string, ...args: unknown[]) => page.evaluate(([f, a]) => (window as any).__lx[f as string](...(a as unknown[])) as T, [fn, args] as const);

const TRANSCRIPT = [
  { id: 'g1', startMs: 0, text: 'Bonjour, aujourd’hui nous parlons de la formation du contrat et du consentement.' },
  { id: 'g2', startMs: 2_052_000, text: 'Le dol, ce sont des manœuvres destinées à tromper le cocontractant, article 1137 du code civil.' },
  { id: 'g3', startMs: 2_058_000, text: 'Attention, ça tombe à l’examen : le dol peut venir d’un tiers.' },
];
const SUPPORT_DOCX = () => buf(makeDocx([{ text: 'Le dol suppose des manœuvres destinées à tromper le cocontractant. Art. 1137 du Code civil.' }, { text: 'La violence : contrainte inspirant la crainte d’un mal considérable.' }]));

async function newCourse(page: Page, opts: { transcript?: boolean } = {}) {
  await page.goto('/');
  await createCm(page, { subject: 'Droit civil', title: 'Droit des contrats' });
  const sid = sessionIdOf(page);
  await seedNotes(page, sid, CONTRACT_DOC);
  if (opts.transcript !== false) await seedTranscript(page, sid, TRANSCRIPT, [{ id: 'm1', atMs: 2_059_000, reasons: ['exam'] }]);
  await page.goto(`/session/${sid}/course?tab=sources`);
  await expect(page.getByTestId('sources-tab')).toBeVisible();
  return sid;
}
const upload = async (page: Page, name: string, data: Buffer, mimeType = 'application/octet-stream') => {
  await page.getByTestId('file-input').setInputFiles({ name, mimeType, buffer: data });
};

test.describe('scénario complet', () => {
  test('matière → séance → notes → transcription + document → cours reconstruit → source consultée → rechargement', async ({ page }) => {
    const errors = trackErrors(page);
    const sid = await newCourse(page);
    await expect(page.getByTestId('doc-list')).toHaveCount(0);

    // Import d'un document Word : analysé, prêt
    await upload(page, 'support.docx', SUPPORT_DOCX());
    await expect(page.getByTestId('doc-row')).toHaveCount(1);
    await expect(page.getByTestId('doc-status')).toContainText('Prêt', { timeout: 15_000 });
    await expect(page.getByTestId('doc-row')).toContainText('DOCX');

    // Génération
    await page.getByTestId('ctab-course').click();
    await page.getByTestId('generate-course').click();
    await expect(page.getByTestId('course-doc')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('course-meta')).toContainText('Version 1');
    const titles = await page.getByTestId('course-section').locator('h2, h3, h4').allInnerTexts();
    expect(titles.join(' | ')).toMatch(/Formation du contrat.*Consentement.*Dol.*Violence.*Capacité/s);

    // Provenance : l'article 1137 est corroboré par les trois sources
    const art = page.locator('[data-testid="course-block"][data-kind="reference"]').filter({ hasText: 'Art. 1137' }).first();
    await expect(art).toHaveAttribute('data-confidence', 'VERIFIED');
    await art.getByTestId('source-badge').click();
    const pop = page.getByTestId('source-popover');
    await expect(pop).toContainText('Notes'); await expect(pop).toContainText('Transcription 00:34:12'); await expect(pop).toContainText('Word');
    await expect(pop.getByTestId('source-open')).toHaveCount(3);

    // Revenir à la source : transcription
    await pop.getByTestId('source-open').nth(1).click();
    await expect(page).toHaveURL(/tab=transcript&t=2052000/);
    await expect(page.getByTestId('course-transcript')).toBeVisible();
    await expect(page.getByTestId('course-transcript')).toContainText('manœuvres destinées à tromper');
    // … document
    await page.goBack();
    await page.locator('[data-testid="course-block"][data-kind="reference"]').filter({ hasText: 'Art. 1137' }).first().getByTestId('source-badge').click();
    await page.getByTestId('source-popover').getByTestId('source-open').nth(2).click();
    await expect(page).toHaveURL(/tab=sources&doc=/);
    await expect(page.getByTestId('doc-units')).toContainText('Art. 1137 du Code civil');
    // … notes
    await page.goBack();
    await page.locator('[data-testid="course-block"][data-kind="reference"]').filter({ hasText: 'Art. 1137' }).first().getByTestId('source-badge').click();
    await page.getByTestId('source-popover').getByTestId('source-open').nth(0).click();
    await expect(page).toHaveURL(/tab=notes&q=/);
    await expect(page.getByTestId('course-notes')).toContainText('le dol est le fait pour un contractant');
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''), { timeout: 5000 }).toContain('Art. 1137'); // le passage cité est sélectionné à l'écran

    // Persistance après rechargement
    await page.goto(`/session/${sid}/course`);
    await expect(page.getByTestId('course-meta')).toContainText('Version 1');
    await expect(page.getByTestId('course-doc')).toContainText('Formation du contrat');
    await page.getByTestId('ctab-sources').click();
    await expect(page.getByTestId('doc-row')).toHaveCount(1);
    expect(errors.filter((e) => !/Failed to load|net::/.test(e))).toEqual([]);
  });

  test('régénération = nouvelle version ; l’ancienne est conservée ; « les sources ont changé »', async ({ page }) => {
    const sid = await newCourse(page, { transcript: false });
    await page.getByTestId('ctab-course').click();
    await page.getByTestId('generate-course').click();
    await expect(page.getByTestId('course-meta')).toContainText('Version 1', { timeout: 30_000 });
    await expect(page.getByTestId('course-stale')).toHaveCount(0);
    // une source change
    await seedNotes(page, sid, { ...CONTRACT_DOC, content: [...CONTRACT_DOC.content, { type: 'legalBlock', attrs: { kind: 'article' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Art. 1130 : nouvel article ajouté aux notes.' }] }] }] });
    await page.reload();
    await expect(page.getByTestId('course-stale')).toBeVisible();
    await page.getByTestId('generate-course').click();
    await expect(page.getByTestId('course-meta')).toContainText('Version 2', { timeout: 30_000 });
    await expect(page.getByTestId('course-doc')).toContainText('Art. 1130');
    await page.getByTestId('course-version').selectOption({ index: 1 });
    await expect(page.getByTestId('course-meta')).toContainText('Version 1');
    await expect(page.getByTestId('course-doc')).not.toContainText('Art. 1130'); // l'ancienne version est intacte
    // les notes, elles, n'ont pas été touchées par la génération
    await page.goto(`/session/${sid}`);
    await expect(page.locator('.note-prose')).toContainText('Art. 1130 : nouvel article');
  });
});

test.describe('documents', () => {
  test('PDF (page exacte), PowerPoint (slide exacte), doublon, format non pris en charge, image sans OCR, réanalyse, suppression', async ({ page }) => {
    await newCourse(page, { transcript: false });
    await upload(page, 'cours.pdf', buf(makePdf(['Introduction generale du cours.', 'Le dol suppose des manoeuvres destinees a tromper. Art. 1137.']), ), 'application/pdf');
    await expect(page.getByTestId('doc-row').nth(0).getByTestId('doc-status')).toContainText('Prêt', { timeout: 20_000 });
    await expect(page.getByTestId('doc-row').nth(0)).toContainText('2 pages');
    await upload(page, 'slides.pptx', buf(makePptx([{ title: 'Plan' , body: ['Le contrat'] }, { title: 'Le dol', body: ['Manœuvres destinées à tromper', 'Art. 1137'] }])));
    await expect(page.getByTestId('doc-row').nth(1)).toContainText('2 slides');
    await upload(page, 'copie.pdf', buf(makePdf(['Introduction generale du cours.', 'Le dol suppose des manoeuvres destinees a tromper. Art. 1137.'])), 'application/pdf');
    await expect(page.getByTestId('doc-row')).toHaveCount(2); // doublon refusé
    await upload(page, 'ancien.doc', Buffer.from([1, 2, 3]), 'application/msword');
    await upload(page, 'tableau.png', Buffer.from([137, 80, 78, 71]), 'image/png');
    await expect(page.getByTestId('doc-row')).toHaveCount(4);
    await expect(page.getByTestId('doc-row').nth(2)).toContainText('.docx');
    await expect(page.getByTestId('doc-row').nth(3)).toContainText('OCR');
    await expect(page.getByTestId('doc-row').nth(3).getByTestId('doc-status')).toContainText('non exploitable');

    // Les emplacements exacts apparaissent dans le cours
    await page.getByTestId('ctab-course').click();
    await page.getByTestId('generate-course').click();
    await expect(page.getByTestId('course-doc')).toBeVisible({ timeout: 30_000 });
    const badges = (await page.getByTestId('source-badge').allInnerTexts()).join(' | ');
    expect(badges).toMatch(/PDF p\. \d/); expect(badges).toMatch(/Slide \d/);
    // Emplacements exacts dans le détail de la source
    await page.locator('[data-testid="course-block"][data-kind="reference"]').filter({ hasText: 'Art. 1137' }).first().getByTestId('source-badge').click();
    await expect(page.getByTestId('source-popover')).toContainText('PDF p. 2');
    await expect(page.getByTestId('source-popover')).toContainText('Slide 2');

    // Réanalyse + suppression
    await page.getByTestId('ctab-sources').click();
    await page.getByTestId('doc-row').nth(0).getByTestId('doc-reanalyze').click();
    await expect(page.getByTestId('doc-row').nth(0).getByTestId('doc-status')).toContainText('Prêt');
    await page.getByTestId('doc-row').nth(3).getByTestId('doc-remove').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer' }).click();
    await expect(page.getByTestId('doc-row')).toHaveCount(3);
    // le cours reconstruit (historique) n'est pas détruit par la suppression d'un document
    await page.getByTestId('ctab-course').click();
    await expect(page.getByTestId('course-doc')).toBeVisible();
  });

  test('glisser-déposer', async ({ page }) => {
    await newCourse(page, { transcript: false });
    const dt = await page.evaluateHandle(() => { const d = new DataTransfer(); d.items.add(new File(['# Titre\nLe dol : manœuvres destinées à tromper le cocontractant.'], 'notes.md', { type: 'text/markdown' })); return d; });
    await page.getByTestId('dropzone').dispatchEvent('drop', { dataTransfer: dt });
    await expect(page.getByTestId('doc-row')).toContainText('notes.md');
    await expect(page.getByTestId('doc-status')).toContainText('Prêt');
  });
});

test.describe('fiabilité et conflits', () => {
  test('deux sources se contredisent : le conflit est affiché avec les deux valeurs et leurs sources', async ({ page }) => {
    await page.goto('/');
    await createCm(page, { subject: 'Droit', title: 'Réforme' });
    const sid = sessionIdOf(page);
    await seedNotes(page, sid, { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Réforme' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'L’ordonnance portant réforme du droit des contrats date du 10 février 2016.' }] }] });
    await page.goto(`/session/${sid}/course?tab=sources`);
    await upload(page, 'plan.docx', buf(makeDocx([{ text: 'L’ordonnance portant réforme du droit des contrats date du 12 mars 2017.' }])));
    await expect(page.getByTestId('doc-status')).toContainText('Prêt', { timeout: 15_000 });
    await page.getByTestId('ctab-course').click();
    await page.getByTestId('generate-course').click();
    const v = page.getByTestId('to-verify');
    await expect(v).toBeVisible({ timeout: 30_000 });
    await expect(v.getByTestId('conflict')).toContainText('10 février 2016');
    await expect(v.getByTestId('conflict')).toContainText('12 mars 2017');
    await expect(v.getByTestId('confidence-badge').first()).toHaveAttribute('data-level', 'CONFLICTING');
    await expect(v).toContainText('Aucune des deux valeurs');
  });

  test('aucune invention : cours sans article → aucun article dans le cours reconstruit', async ({ page }) => {
    await page.goto('/');
    await createCm(page, { subject: 'Droit', title: 'Sans article' });
    const sid = sessionIdOf(page);
    await seedNotes(page, sid, { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Le dol' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'Le dol vicie le consentement lorsque les manœuvres sont déterminantes.' }] }] });
    await page.goto(`/session/${sid}/course`);
    await page.getByTestId('generate-course').click();
    await expect(page.getByTestId('course-doc')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('course-doc')).not.toContainText(/Art\.|Cass\.|n° \d/);
    expect(await page.getByTestId('course-block').count()).toBeGreaterThan(0);
    for (const b of await page.getByTestId('course-block').all()) await expect(b.getByTestId('source-badge')).toBeVisible(); // aucun bloc sans source
  });
});

test.describe('hors ligne, moteur indisponible, isolation', () => {
  test('moteur distant injoignable : erreur claire, notes toujours enregistrables, repli local', async ({ page }) => {
    const sid = await newCourse(page, { transcript: false });
    await page.getByTestId('ctab-course').click();
    await lx(page, 'breakEngine', false);
    await page.getByTestId('ctab-notes').click(); await page.getByTestId('ctab-course').click(); // rafraîchit la liste des moteurs
    await page.getByTestId('generate-course').click();
    await expect(page.getByTestId('course-error')).toContainText('injoignable');
    await expect(page.getByTestId('course-error')).toContainText('ne sont pas affectés');
    // Les notes fonctionnent normalement
    await page.goto(`/session/${sid}`);
    await page.locator('.note-prose').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' Écrit pendant que le moteur est injoignable.');
    await waitSaved(page);
    await page.goto(`/session/${sid}/course?tab=notes`);
    await expect(page.getByTestId('course-notes')).toContainText('Écrit pendant que le moteur est injoignable');
    // Repli sur le moteur local
    await page.getByTestId('ctab-course').click();
    await lx(page, 'breakEngine', true);
    await page.getByTestId('ctab-notes').click(); await page.getByTestId('ctab-course').click();
    await page.getByTestId('generate-course').click();
    await expect(page.getByTestId('course-doc')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('course-meta')).toContainText('injoignable');
  });

  test('utilisateur B ne voit ni les documents ni les cours de A ; autre appareil : texte et cours présents, fichier original absent', async ({ page, browser }) => {
    const sid = await newCourse(page, { transcript: false });
    await upload(page, 'secret.docx', buf(makeDocx([{ text: 'Contenu secret du support de A : le dol suppose des manœuvres.' }])));
    await expect(page.getByTestId('doc-status')).toContainText('Prêt', { timeout: 15_000 });
    await page.getByTestId('ctab-course').click();
    await page.getByTestId('generate-course').click();
    await expect(page.getByTestId('course-doc')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('sync-indicator').click();
    await expect.poll(async () => (await lx<unknown[]>(page, 'rows', 'generated_courses')).length, { timeout: 20_000 }).toBe(1);
    await expect.poll(async () => (await lx<unknown[]>(page, 'rows', 'source_documents')).length, { timeout: 20_000 }).toBe(1);
    const row = (await lx<Record<string, unknown>[]>(page, 'rows', 'source_documents'))[0]!;
    expect(JSON.stringify(row)).toContain('Contenu secret'); // texte analysé : synchronisé
    expect(Object.keys(row)).not.toContain('file');           // fichier original : jamais

    // Autre appareil du même compte
    const ctx2 = await browser.newContext({ storageState: await page.context().storageState(), baseURL: 'http://localhost:4173' });
    const p2 = await ctx2.newPage();
    await p2.goto('/sessions');
    await expect(p2.getByTestId('session-row')).toHaveCount(1, { timeout: 20_000 }); // la synchro a rapatrié la séance
    await p2.goto(`/session/${sid}/course?tab=sources`);
    await expect(p2.getByTestId('doc-row')).toHaveCount(1, { timeout: 20_000 });
    await p2.getByTestId('doc-row').getByTestId('doc-reanalyze').click();
    await expect(p2.getByTestId('doc-row')).toContainText('fichier original n’est pas sur cet appareil');
    await p2.getByTestId('ctab-course').click();
    await expect(p2.getByTestId('course-doc')).toBeVisible();
    await ctx2.close();

    // Autre utilisateur
    await page.goto('/');
    await logOut(page);
    await signUp(page);
    await page.goto(`/session/${sid}/course`);
    await expect(page).not.toHaveURL(/\/course/); // séance inconnue de B
    expect(await page.evaluate(async () => (await indexedDB.databases()).filter((d) => d.name?.startsWith('lexnote-u-')).length)).toBe(2);
  });

  test('mobile : espace Cours lisible, sans défilement horizontal', async ({ page }) => {
    await newCourse(page, { transcript: false });
    await page.getByTestId('ctab-course').click();
    await page.getByTestId('generate-course').click();
    await expect(page.getByTestId('course-doc')).toBeVisible({ timeout: 30_000 });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.getByTestId('ctab-sources').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });

  test('accès depuis la séance : lien « Cours » dans l’éditeur et le récapitulatif', async ({ page }) => {
    await page.goto('/');
    await createCm(page, { subject: 'Droit', title: 'Accès' });
    await page.getByTestId('editor-open-course').click();
    await expect(page.getByTestId('course-page')).toBeVisible();
    await page.goBack();
    await page.keyboard.press('Control+k');
    await page.getByTestId('palette-input').fill('cours reconstruit');
    await page.getByRole('option', { name: /Ouvrir le Cours/ }).click();
    await expect(page.getByTestId('course-page')).toBeVisible();
  });
});
