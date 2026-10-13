import { expect, test, type Page } from '@playwright/test';
import { createSession, seedTranscript, sessionIdOf, trackErrors } from './helpers';

/**
 * « Exploiter la transcription » : parcours complet dans le vrai navigateur (build `VITE_BACKEND=mock`).
 * Le moteur IA est soit ABSENT (comportement par défaut, comme une installation sans IA), soit le DOUBLE DE TEST
 * déterministe du backend simulé (`__lx.installAI`) — jamais une réponse prétendument intelligente.
 */
const LECTURE = [
  'Alors aujourd’hui on va parler de l’offre et la demande.', 'Premièrement la demande.',
  'La demande se définit comme la quantité qu’un acheteur souhaite acquérir à un prix donné.', 'Ensuite l’offre.',
  'L’offre désigne la quantité que les producteurs mettent sur le marché.', 'Contrairement à la demande, l’offre augmente avec le prix.',
  'Le prix d’équilibre est le prix pour lequel l’offre est égale à la demande.', 'C’est-à-dire le point où les deux courbes se croisent.',
  'euh donc donc retenez bien cette définition pour l’examen.', 'Enfin les élasticités seront vues la semaine prochaine.',
];
const segs = (n = 2) => Array.from({ length: n }, (_, r) => LECTURE.map((text, k) => ({ id: `s${r}-${k}`, startMs: (r * LECTURE.length + k) * 5000, text }))).flat();

async function recapWithTranscript(page: Page, opts: { type?: 'COURSE' | 'TD' | 'SEMINAR'; title?: string; repeat?: number } = {}) {
  await createSession(page, { type: opts.type ?? 'COURSE', subject: 'Microéconomie', title: opts.title ?? 'Offre et demande' });
  const sid = sessionIdOf(page);
  await seedTranscript(page, sid, segs(opts.repeat ?? 2), [{ id: 'm1', atMs: 30_000, reasons: ['exam'] }]);
  await page.goto(`/session/${sid}/recap`);
  await expect(page.getByTestId('transcript-actions')).toBeVisible();
  return sid;
}
const installAI = (page: Page, mode = 'ok') => page.evaluate((m) => (window as any).__lx.installAI(m), mode);

test.describe('généralisation', () => {
  test('identité généraliste : aucune mention « Droit » dans la marque ; carte REV-EM réelle', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('.brand__text small')).toHaveText('Notes · Cours · Révisions');
    await expect(page.locator('body')).not.toContainText('Conçu pour les cours de droit');
    await expect(page.locator('body')).toContainText('Pour toutes les filières');
    const desc = await page.locator('meta[name="description"]').getAttribute('content');
    expect(desc).not.toMatch(/droit/i);
    await recapWithTranscript(page);
    await expect(page.locator('.sidebar .brand__text small')).toHaveText('Notes · Cours · Révisions');
    const card = page.getByTestId('revem-card');
    await expect(card).toContainText('REV-EM');
    await expect(card).not.toContainText('bientôt');
    await expect(page.getByTestId('revem-card-status')).toHaveText(/Non connecté|Vérification/);
    await card.click();
    await expect(page).toHaveURL(/\/settings#apps-h/);
    await expect(page.getByTestId('connected-apps')).toBeVisible();
  });

  test('onboarding : profil d’études facultatif (domaine, usage) ; aucune fonctionnalité bloquée', async ({ page }) => {
    await page.goto('/signup');
    await page.getByTestId('auth-email').fill(`gen${Date.now()}@example.com`);
    await page.getByTestId('auth-password').fill('motdepasse-solide');
    await page.getByTestId('auth-password2').fill('motdepasse-solide');
    await page.getByTestId('auth-submit').click();
    await page.getByTestId('ob-firstname').fill('Lina');
    await page.getByTestId('ob-next').click();
    await expect(page.getByTestId('onboarding-step-2')).toContainText('Domaine d’études');
    await page.getByTestId('ob-field-École de commerce').click();
    await page.getByTestId('ob-use-transcribe').click();
    await page.getByTestId('ob-next').click();
    await expect(page.getByTestId('ob-subject')).toHaveAttribute('placeholder', /Microéconomie/);
    await page.getByTestId('ob-subject').fill('Finance d’entreprise');
    await page.getByTestId('ob-finish').click();
    await expect(page.getByTestId('greeting')).toBeVisible();
    await expect(page.locator('.hero__sub')).toContainText('transformez vos séances en supports de révision');
    await page.goto('/settings');
    await expect(page.getByTestId('profile-field')).toHaveValue('École de commerce');
  });

  test('vocabulaire : une séance de TD se termine par « Terminer la séance », pas « le CM »', async ({ page }) => {
    await createSession(page, { type: 'TD', subject: 'Statistiques', title: 'Exercices de régression' });
    await page.locator('.note-prose').click();
    await page.keyboard.type('Une régression linéaire');
    await expect(page.getByTestId('finish-cm')).toHaveAttribute('aria-label', 'Terminer la séance');
    await expect(page.locator('body')).not.toContainText(/du CM|le CM\b/);
    await page.getByTestId('finish-cm').click();
    await expect(page.getByTestId('recap-title')).toContainText('TD 01 — Exercices de régression');
    await expect(page.locator('main')).not.toContainText(/Notes · CM|du CM\b/);
  });
});

test.describe('exploiter la transcription', () => {
  test('sans moteur IA : « Fonction IA non configurée », rien n’est simulé ; le nettoyage léger fonctionne', async ({ page }) => {
    const errors = trackErrors(page);
    await recapWithTranscript(page);
    await expect(page.getByTestId('ai-status')).toHaveText('Fonction IA non configurée');
    for (const id of ['summarize', 'translate', 'structure', 'key-points']) await expect(page.getByTestId(`xaction-${id}`)).toBeVisible();
    await expect(page.getByTestId('xaction-summarize')).toContainText('IA non configurée');
    await page.getByTestId('xaction-summarize').click();
    await expect(page.getByTestId('ai-unavailable')).toContainText('Fonction IA non configurée');
    await expect(page.getByTestId('action-run')).toBeDisabled();
    await page.getByTestId('action-cancel').click();

    // nettoyage léger : sur l'appareil, sans IA ; l'original reste accessible
    await page.getByTestId('xmore').click();
    await page.getByTestId('xaction-clean').click();
    await expect(page.getByTestId('clean-light')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('action-run').click();
    await expect(page.getByTestId('artifact-page')).toHaveAttribute('data-type', 'CLEAN_TRANSCRIPT');
    await expect(page.getByTestId('doc-view')).toContainText('Donc retenez bien cette définition pour l’examen.');
    await expect(page.getByTestId('doc-view')).not.toContainText('euh');
    await expect(page.getByTestId('artifact-generator')).toHaveText('Sur l’appareil');
    await page.getByTestId('doc-original').click();
    await expect(page.getByTestId('doc-original-panel')).toContainText('euh donc donc retenez bien');
    expect(errors).toEqual([]);
  });

  test('résumé : choix Express / Standard / Détaillé, document éditable, sauvegardé, lié à la séance', async ({ page }) => {
    const sid = await recapWithTranscript(page);
    await installAI(page);
    await expect(page.getByTestId('ai-status')).toHaveText('IA disponible');
    await page.getByTestId('xaction-summarize').click();
    for (const m of ['express', 'standard', 'detailed']) await expect(page.getByTestId(`summary-${m}`)).toBeVisible();
    await page.getByTestId('summary-express').click();
    await page.getByTestId('action-run').click();
    await expect(page.getByTestId('artifact-page')).toHaveAttribute('data-type', 'SUMMARY');
    await expect(page.getByTestId('artifact-title')).toHaveValue('Résumé express — Offre et demande');
    await expect(page.getByTestId('doc-view')).toContainText('summarize · express (moteur de test)');
    await expect(page.getByTestId('artifact-provenance')).toContainText('transcription originale');
    const calls = await page.evaluate(() => (window as any).__lx.aiCalls());
    expect(calls.at(-1)).toMatchObject({ command: 'summarize', options: { mode: 'express', outputLanguage: 'fr' } });

    // édition : la version modifiée est enregistrée
    await page.getByTestId('doc-edit-toggle').click();
    const first = page.getByTestId('doc-block').first().locator('textarea');
    await first.fill('Mon titre corrigé');
    await page.getByTestId('doc-edit-toggle').click();
    await expect(page.getByTestId('doc-view')).toContainText('Mon titre corrigé');
    await expect(page.getByTestId('artifact-edited')).toBeVisible();

    // régénération : la version modifiée n'est jamais perdue (historique)
    page.once('dialog', () => undefined);
    await page.getByTestId('artifact-regenerate').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Régénérer' }).click();
    await expect(page.getByTestId('artifact-generated')).toBeVisible();
    await expect(page.getByTestId('doc-view')).not.toContainText('Mon titre corrigé');
    await page.getByTestId('doc-history-toggle').click();
    await expect(page.getByTestId('doc-history')).toContainText('Version 1 · modifiée par vous');
    await page.getByTestId('doc-history-restore').first().click();
    await expect(page.getByTestId('doc-view')).toContainText('Mon titre corrigé');

    // le support apparaît dans le récapitulatif de la séance, après rechargement
    await page.goto(`/session/${sid}/recap`);
    await expect(page.getByTestId('session-supports')).toContainText('Résumé express — Offre et demande');
  });

  test('traduction : langue cible, nouvelle version, original intact et consultable ; traduction du résumé seul', async ({ page }) => {
    await recapWithTranscript(page);
    await installAI(page);
    await page.getByTestId('xaction-translate').click();
    await page.getByTestId('translate-target').selectOption('es');
    await expect(page.getByTestId('translate-summary')).toBeDisabled(); // aucun résumé encore
    await page.getByTestId('action-run').click();
    await expect(page.getByTestId('artifact-page')).toHaveAttribute('data-type', 'TRANSLATION');
    await expect(page.getByTestId('artifact-language')).toHaveText('Espagnol');
    await expect(page.getByTestId('doc-view')).toContainText('[es] Alors aujourd’hui');
    await page.getByTestId('doc-original').click();
    await expect(page.getByTestId('doc-original-panel')).toContainText('Alors aujourd’hui on va parler de l’offre et la demande.');
    await expect(page.getByTestId('doc-original-panel')).not.toContainText('[es]');
    const calls = await page.evaluate(() => (window as any).__lx.aiCalls());
    expect(calls.every((c: any) => c.command === 'translate' && c.options.targetLanguage === 'es')).toBe(true);
  });

  test('longue transcription : découpage en parties, synthèses intermédiaires réutilisées par l’action suivante', async ({ page }) => {
    await recapWithTranscript(page, { repeat: 24 });
    await installAI(page);
    await page.getByTestId('xaction-structure').click();
    await page.getByTestId('action-run').click();
    await expect(page.getByTestId('artifact-page')).toHaveAttribute('data-type', 'STRUCTURED_NOTES');
    await expect(page.getByTestId('artifact-provenance')).toContainText('parties traitées');
    const first = await page.evaluate(() => (window as any).__lx.aiCalls());
    expect(first.filter((c: any) => c.command === 'digest').length).toBeGreaterThan(1);
    expect(first.every((c: any) => c.inputLength <= 4000 || c.command === 'structure')).toBe(true);
    await page.goBack();
    await page.getByTestId('xaction-key-points').click();
    await page.getByTestId('action-run').click();
    await expect(page.getByTestId('artifact-page')).toHaveAttribute('data-type', 'KEY_POINTS');
    const after = await page.evaluate(() => (window as any).__lx.aiCalls());
    expect(after.slice(first.length).map((c: any) => c.command)).toEqual(['key-points']);
  });

  test('erreurs : serveur indisponible, réponse illisible, hors ligne — messages propres, rien d’enregistré', async ({ page, context }) => {
    await recapWithTranscript(page);
    await installAI(page, 'error');
    await page.getByTestId('xaction-key-points').click();
    await page.getByTestId('action-run').click();
    await expect(page.getByTestId('action-error')).toContainText('momentanément indisponible');
    await page.evaluate(() => (window as any).__lx.setAIMode('garbage'));
    await page.getByTestId('action-run').click();
    await expect(page.getByTestId('action-error')).toContainText('n’a pas la forme attendue');
    await page.getByTestId('action-cancel').click();
    await context.setOffline(true);
    await expect(page.getByTestId('ai-status')).toHaveText('Hors ligne');
    await page.getByTestId('xaction-key-points').click();
    await expect(page.getByTestId('ai-unavailable')).toContainText('Hors ligne');
    await page.getByTestId('action-cancel').click();
    await context.setOffline(false);
    await expect(page.getByTestId('session-supports-empty')).toBeVisible();
  });

  test('transcription vide ou très courte', async ({ page }) => {
    await createSession(page, { type: 'SEMINAR', subject: 'Histoire', title: 'Sans enregistrement' });
    const sid = sessionIdOf(page);
    await page.goto(`/session/${sid}/recap`);
    await expect(page.getByTestId('transcript-actions')).toContainText('Aucune transcription pour cette séance');
    await expect(page.getByTestId('xaction-summarize')).toBeDisabled();
    // séance courte
    await createSession(page, { type: 'SEMINAR', subject: 'Histoire', title: 'Courte' });
    const sid2 = sessionIdOf(page);
    await seedTranscript(page, sid2, [{ id: 'c1', startMs: 0, text: 'Bonjour à tous, nous commençons.' }]);
    await page.goto(`/session/${sid2}/recap`);
    await expect(page.getByTestId('xaction-summarize')).toContainText('Trop court');
    await installAI(page);
    await page.getByTestId('xaction-summarize').click();
    await page.getByTestId('action-run').click();
    await expect(page.getByTestId('action-error')).toContainText('trop court');
  });

  test('onglet Transcription : recherche, aller à un instant, export, sélection → résumer / flashcard', async ({ page }) => {
    await recapWithTranscript(page);
    await installAI(page);
    await page.getByTestId('recap-tab-transcript').click();
    await page.getByTestId('transcript-search').fill('équilibre');
    await expect(page.getByTestId('transcript-search-count')).toHaveText('1/2');
    await page.getByTestId('transcript-search-next').click();
    await expect(page.locator('.tseg.is-selected mark')).toHaveText('équilibre');
    await page.getByTestId('transcript-goto').fill('00:41');
    await page.getByTestId('transcript-goto').press('Enter');
    await expect(page.locator('.tseg.is-selected')).toContainText('retenez bien');
    const dl = page.waitForEvent('download');
    await page.getByTestId('transcript-export').click();
    await page.getByTestId('transcript-export-md').click();
    expect((await dl).suggestedFilename()).toMatch(/Transcription.*\.md$/);

    // sélection d'un passage → barre d'actions
    await page.getByTestId('transcript-search').fill('');
    const segsLoc = page.getByTestId('tseg');
    await segsLoc.nth(2).locator('p').evaluate((el) => {
      const r = document.createRange(); r.selectNodeContents(el); const s = window.getSelection()!; s.removeAllRanges(); s.addRange(r);
    });
    await expect(page.getByTestId('selection-bar')).toContainText('mots');
    await page.getByTestId('sel-flashcard').click();
    await expect(page.getByTestId('flashcard-dialog')).toContainText('Passage');
    await page.getByTestId('flashcard-question').fill('Qu’est-ce que la demande ?');
    await page.getByTestId('flashcard-save').click();
    await expect(page.getByTestId('artifact-page')).toBeVisible();
    await expect(page.locator('body')).toContainText('Qu’est-ce que la demande ?');

    await page.goBack();
    await page.getByTestId('recap-tab-transcript').click();
    await page.getByTestId('tseg').nth(4).locator('p').evaluate((el) => {
      const r = document.createRange(); r.setStartBefore(el); const end = el.closest('ol')!.children[7]!; r.setEndAfter(end); const s = window.getSelection()!; s.removeAllRanges(); s.addRange(r);
    });
    await page.getByTestId('sel-translate').click();
    await expect(page.getByTestId('action-scope')).toContainText('Passage sélectionné');
    await page.getByTestId('translate-target').selectOption('en');
    await page.getByTestId('action-run').click();
    await expect(page.getByTestId('artifact-page')).toHaveAttribute('data-type', 'TRANSLATION');
    await expect(page.getByTestId('artifact-provenance')).toContainText('passage sélectionné');
    await expect(page.getByTestId('doc-view')).not.toContainText('Alors aujourd’hui');
  });

  test('suggestions contextuelles légères et actions « moteur de cours » (fiche, quiz…) par la voie existante', async ({ page }) => {
    await recapWithTranscript(page);
    await expect(page.getByTestId('xsuggestions')).toBeVisible();
    await page.getByTestId('xmore').click();
    await expect(page.getByTestId('xmore-panel')).toContainText('Réviser');
    await page.getByTestId('xaction-quiz').click();
    await expect(page.getByRole('dialog', { name: 'Créer un support' })).toBeVisible();
    // le quiz passe par le moteur de cours existant : sans cours reconstruit, le dialogue l'explique et mène à l'espace « Cours »
    await expect(page.getByTestId('support-nocourse')).toContainText('pas encore été reconstruit');
  });
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('récapitulatif et actions utilisables sur téléphone', async ({ page }) => {
    await recapWithTranscript(page);
    await installAI(page);
    const box = await page.getByTestId('xaction-summarize').boundingBox();
    expect(box!.width).toBeGreaterThan(300); // une colonne
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await page.getByTestId('xaction-summarize').click();
    await page.getByTestId('action-run').click();
    await expect(page.getByTestId('doc-view')).toBeVisible();
  });
});
