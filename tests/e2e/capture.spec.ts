import { expect, test } from '@playwright/test';
import { FAKE_SPEECH_INIT, capIDB, createCm, mod, startRecording, trackErrors, waitSaved } from './helpers';

test.beforeEach(async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Micro simulé disponible uniquement sous Chromium');
  await page.addInitScript(FAKE_SPEECH_INIT);
  await page.addInitScript(() => localStorage.setItem('lexnote.transcription', JSON.stringify({ chunkMs: 2000 })));
});

test.describe('transcription — permission et avertissement', () => {
  test('rien ne démarre seul ; « Annuler » n’active jamais le micro', async ({ page }) => {
    await page.goto('/');
    await createCm(page, { subject: 'Cap', module: 'M', title: 'Permission' });
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as any).__gum)).toBe(0);
    await page.getByTestId('transcription-btn').click();
    await expect(page.getByRole('dialog', { name: /Enregistrer ce cours/ })).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('autorisation du professeur');
    await page.getByRole('dialog').getByRole('button', { name: 'Annuler' }).click();
    expect(await page.evaluate(() => (window as any).__gum)).toBe(0);
    await expect(page.getByTestId('rec-pill')).toHaveCount(0);
  });

  test('« J’ai l’autorisation » démarre ; l’avertissement n’est plus redemandé', async ({ page }) => {
    await page.goto('/');
    await createCm(page, { subject: 'Cap', module: 'M', title: 'Start' });
    await startRecording(page);
    expect(await page.evaluate(() => (window as any).__gum)).toBe(1);
    await expect(page.getByTestId('capture-status')).toHaveText('Enregistrement');
    await page.getByTestId('stop-btn').click();
    await expect(page.getByTestId('transcription-btn')).toBeVisible();
    await page.getByTestId('transcription-btn').click();
    await expect(page.getByTestId('rec-pill')).toContainText('REC');
    expect(await page.evaluate(() => (window as any).__gum)).toBe(2);
  });

  test('permission refusée : message explicite, notes intactes, pas d’enregistrement', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/');
    await createCm(page, { subject: 'Cap', module: 'M', title: 'Refus' });
    await page.evaluate(() => { (window as any).__denyMic = true; });
    await page.locator('.note-prose').click();
    await page.keyboard.type('mes notes restent');
    await page.getByTestId('transcription-btn').click();
    await page.getByTestId('consent-accept').click();
    await expect(page.getByTestId('capture-error')).toContainText('refusé');
    await expect(page.getByTestId('rec-pill')).toHaveCount(0);
    await page.locator('.note-prose').click();
    await page.keyboard.type(' et continuent');
    await waitSaved(page);
    await page.reload();
    await expect(page.locator('.note-prose')).toContainText('mes notes restent et continuent');
    expect(errors.filter((e) => !/NotAllowed|refus/i.test(e))).toEqual([]);
  });
});

test.describe('transcription — capture en direct', () => {
  test('segments live, marqueurs, pause/reprise/arrêt, chronologie, ancrages de notes', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/');
    await createCm(page, { subject: 'Live', module: 'M', title: 'Cours live' });
    await page.locator('.note-prose').click();
    await startRecording(page);
    await expect(page.getByTestId('transcript-panel')).toBeVisible();

    // Le professeur parle ; l'étudiant écrit sans ralentissement.
    await page.evaluate(() => (window as any).__say('Pour qu’un contrat soit valablement formé', false));
    await expect(page.locator('.tseg--interim')).toContainText('valablement formé');
    await page.evaluate(() => (window as any).__say('Pour qu’un contrat soit valablement formé, il faut un consentement'));
    await page.keyboard.type('Formation du contrat : consentement');
    await page.evaluate(() => (window as any).__say('L’article 1128 du Code civil prévoit trois conditions'));
    await expect(page.getByTestId('tseg')).toHaveCount(2);
    await expect(page.getByTestId('tseg').first()).toContainText('consentement');
    await expect(page.locator('.tseg time').first()).toHaveText(/\d{2}:\d{2}:\d{2}/);

    // Marqueur : un clic → immédiat ; « Pourquoi ? » facultatif.
    await page.getByTestId('mark-btn').click();
    await expect(page.getByTestId('tmark')).toHaveCount(1);
    await expect(page.getByTestId('marker-chips')).toBeVisible();
    await page.getByTestId('marker-chips').getByRole('button', { name: 'Examen' }).click();
    await expect(page.getByTestId('tmark')).toContainText('Examen');
    // raccourci clavier
    await page.locator('.note-prose').click();
    await page.keyboard.press(`${mod}+Alt+s`);
    await expect(page.getByTestId('tmark')).toHaveCount(2);

    // Pause / reprise / arrêt
    await page.getByTestId('pause-btn').click();
    await expect(page.getByTestId('rec-pill')).toContainText('PAUSE');
    expect(await page.evaluate(() => (window as any).__tracks.every((t: MediaStreamTrack) => t.readyState === 'ended'))).toBe(true); // micro réellement coupé
    await page.getByTestId('resume-btn').click();
    await expect(page.getByTestId('rec-pill')).toContainText('REC');
    await page.waitForTimeout(2500); // un segment audio de 2 s est écrit
    await page.getByTestId('stop-btn').click();
    await expect(page.getByTestId('capture-status')).toHaveText('Terminée', { timeout: 10_000 });

    // Données persistées : segments, chunks, marqueurs, ancrage
    await waitSaved(page);
    const segs = await capIDB(page, 'segments');
    expect(segs.length).toBe(2);
    expect(segs[0]).toMatchObject({ source: 'TRANSCRIPTION', verification: 'UNVERIFIED', status: 'final' });
    expect((await capIDB(page, 'chunks')).length).toBeGreaterThanOrEqual(1);
    expect((await capIDB(page, 'markers')).length).toBe(2);
    const anchors = await capIDB(page, 'anchors');
    expect(anchors.length).toBeGreaterThanOrEqual(1);
    expect(anchors[0].textSnippet).toContain('Formation du contrat');
    // Aucun horodatage injecté dans les notes
    await expect(page.locator('.note-prose')).not.toContainText(/\d{2}:\d{2}:\d{2}/);
    const runs = (await capIDB(page, 'audioSessions'))[0].runs;
    expect(runs.map((r: any) => r.endReason)).toEqual(['pause', 'user']);
    expect(errors).toEqual([]);
  });

  test('scroll intelligent : on ne ramène jamais de force ; « Revenir au direct »', async ({ page }) => {
    await page.goto('/');
    await createCm(page, { subject: 'Scroll', module: 'M', title: 'Scroll' });
    await startRecording(page);
    await page.evaluate(() => { for (let i = 0; i < 60; i++) (window as any).__say(`Phrase numéro ${i} du professeur, assez longue pour occuper de la place dans le panneau.`); });
    const scroll = page.getByTestId('transcript-scroll');
    await expect(page.getByTestId('tseg')).toHaveCount(60);
    // en bas : suit le direct
    expect(await scroll.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(60);
    await scroll.evaluate((el) => { el.scrollTop = 0; });
    await expect(page.getByTestId('back-to-live')).toBeVisible();
    await page.evaluate(() => (window as any).__say('Nouvelle phrase pendant que je relis'));
    await page.waitForTimeout(300);
    expect(await scroll.evaluate((el) => el.scrollTop)).toBeLessThan(5); // pas ramené en bas
    await page.getByTestId('back-to-live').click();
    await expect(page.getByTestId('back-to-live')).toHaveCount(0);
    expect(await scroll.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(60);
  });

  test('mode Focus : la capture continue, REC discret, contrôles rouvrables', async ({ page }) => {
    await page.goto('/');
    await createCm(page, { subject: 'Focus', module: 'M', title: 'Focus rec' });
    await startRecording(page);
    await page.getByTestId('focus-toggle').click();
    await expect(page.locator('.workspace.is-focus')).toBeVisible();
    await expect(page.locator('.sidepanel')).toHaveCount(0);
    await expect(page.getByTestId('rec-pill')).toContainText('REC');
    await page.evaluate(() => (window as any).__say('dit pendant le focus'));
    await page.getByTestId('rec-pill').click();
    await expect(page.getByTestId('rec-popover')).toContainText('dit pendant le focus');
    await page.getByTestId('rec-popover').getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByTestId('rec-pill')).toContainText('PAUSE');
    await page.keyboard.press('Escape');
    await expect(page.locator('.workspace.is-focus')).toHaveCount(0);
  });

  test('interruption (micro débranché) : tout est conservé, reprise possible, notes intactes', async ({ page }) => {
    await page.goto('/');
    await createCm(page, { subject: 'Int', module: 'M', title: 'Interruption' });
    await page.locator('.note-prose').click();
    await page.keyboard.type('notes avant coupure');
    await startRecording(page);
    await page.evaluate(() => (window as any).__say('phrase avant coupure'));
    await page.waitForTimeout(2300);
    await page.evaluate(() => { const t = (window as any).__tracks.at(-1); t.stop(); t.dispatchEvent(new Event('ended')); });
    await expect(page.getByTestId('capture-error')).toContainText(/micro/);
    await expect(page.getByTestId('tseg')).toHaveCount(1);
    await page.locator('.note-prose').click();
    await page.keyboard.type(' et après');
    await waitSaved(page);
    await page.getByRole('button', { name: 'Reprendre la transcription' }).first().click();
    await expect(page.getByTestId('rec-pill')).toContainText('REC');
    await page.evaluate(() => (window as any).__say('phrase après reprise'));
    await expect(page.getByTestId('tseg')).toHaveCount(2);
    await expect(page.locator('.note-prose')).toContainText('notes avant coupure et après');
    await expect(page.locator('.timeline__int')).toHaveCount(1); // l'interruption est visible sur la timeline
    const ints = await capIDB(page, 'interruptions');
    expect(ints).toHaveLength(1);
    expect(['device', 'recorder']).toContain(ints[0].kind);
  });

  test('fermeture accidentelle pendant l’enregistrement : reprise sans tout perdre', async ({ page }) => {
    page.on('dialog', (d) => void d.accept()); // beforeunload « enregistrement en cours »
    await page.goto('/');
    await createCm(page, { subject: 'Crash', module: 'M', title: 'Crash' });
    await page.locator('.note-prose').click();
    await page.keyboard.type('notes avant crash');
    await startRecording(page);
    await page.evaluate(() => (window as any).__say('dit avant le crash'));
    await page.waitForTimeout(2600); // segments flushés + au moins un chunk audio
    await page.reload();
    await expect(page.locator('.note-prose')).toContainText('notes avant crash');
    await expect(page.getByTestId('tseg')).toHaveCount(1);
    await expect(page.getByTestId('rec-pill')).toContainText('PAUSE'); // prête à reprendre
    const ints = await capIDB(page, 'interruptions');
    expect(ints.some((i) => i.kind === 'app-closed')).toBe(true);
    expect((await capIDB(page, 'chunks')).length).toBeGreaterThanOrEqual(1);
    await page.getByRole('button', { name: 'Reprendre la transcription' }).click();
    await expect(page.getByTestId('rec-pill')).toContainText('REC');
  });

  test('audio seul : sans moteur de reconnaissance, rien n’est simulé', async ({ page }) => {
    await page.addInitScript(() => { delete (window as any).SpeechRecognition; delete (window as any).webkitSpeechRecognition; });
    await page.goto('/');
    await createCm(page, { subject: 'Audio', module: 'M', title: 'Audio seul' });
    await startRecording(page);
    await expect(page.getByTestId('transcript-panel')).toContainText('audio seul');
    await page.waitForTimeout(2500);
    await page.getByTestId('stop-btn').click();
    await expect(page.getByTestId('capture-status')).toHaveText('Terminée', { timeout: 10_000 });
    expect((await capIDB(page, 'segments')).length).toBe(0);
    expect((await capIDB(page, 'chunks')).length).toBeGreaterThanOrEqual(1);
  });

  test('moteur Whisper (API compatible) : chunks envoyés au serveur (simulé), segments horodatés', async ({ page }) => {
    let calls = 0;
    await page.route('http://localhost:9999/v1/audio/transcriptions', async (route) => {
      calls++;
      expect(route.request().method()).toBe('POST');
      expect(route.request().headers()['content-type']).toContain('multipart/form-data');
      await route.fulfill({
        status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ text: 'Le dol est une tromperie', segments: [{ start: 0.2, end: 1.5, text: ' Le dol est une tromperie', avg_logprob: -0.1 }] }),
      });
    });
    await page.addInitScript(() => localStorage.setItem('lexnote.transcription', JSON.stringify({ chunkMs: 2000, providerId: 'openai-compatible', baseUrl: 'http://localhost:9999/v1', model: 'whisper-1' })));
    await page.goto('/');
    await createCm(page, { subject: 'Whisper', module: 'M', title: 'Whisper' });
    await startRecording(page);
    await expect(page.getByTestId('transcript-panel')).toContainText('compatible OpenAI');
    await expect(page.getByTestId('tseg').first()).toContainText('Le dol est une tromperie', { timeout: 12_000 });
    await page.getByTestId('stop-btn').click();
    await expect(page.getByTestId('capture-status')).toHaveText('Terminée', { timeout: 15_000 });
    expect(calls).toBeGreaterThanOrEqual(1);
    const chunks = await capIDB(page, 'chunks');
    expect(chunks.every((c) => c.transcription === 'done')).toBe(true);
  });
});

test.describe('transcription — après le CM', () => {
  test('Terminer le CM pendant l’enregistrement, récapitulatif, recherche dans la transcription, réécoute, suppression', async ({ page }) => {
    await page.goto('/');
    await createCm(page, { subject: 'Fin', module: 'M', title: 'Vices du consentement' });
    await page.locator('.note-prose').click();
    await page.keyboard.type('le dol et la violence');
    await startRecording(page);
    await page.evaluate(() => (window as any).__say('Le dol suppose des manœuvres frauduleuses'));
    await page.getByTestId('mark-btn').click();
    await page.waitForTimeout(2500);

    // Terminer pendant l'enregistrement → confirmation
    await page.getByTestId('finish-cm').click();
    await expect(page.getByRole('dialog')).toContainText('Un enregistrement est en cours');
    await page.getByRole('button', { name: 'Arrêter et terminer le CM' }).click();
    await expect(page.getByTestId('recap-title')).toContainText('Vices du consentement');
    await expect(page.getByTestId('recap-words')).toContainText('5');
    await expect(page.getByTestId('recap-twords')).toContainText('6');
    await expect(page.getByTestId('recap-markers')).toHaveText('1');
    await expect(page.getByTestId('recap-interruptions')).toHaveText('0');
    await expect(page.getByTestId('recap-audio')).not.toHaveText('—');
    await expect(page.getByText('Cours restructuré')).toBeVisible(); // toujours désactivé
    await expect(page.locator('.future li[aria-disabled="true"]')).toHaveCount(7);

    // Onglets
    await page.getByTestId('recap-tab-transcript').click();
    await expect(page.getByTestId('tseg')).toContainText('manœuvres frauduleuses');
    await page.getByTestId('recap-tab-timeline').click();
    await expect(page.locator('.timeline--full')).toBeVisible();
    await expect(page.locator('.timeline__mark')).toHaveCount(1);

    // Réécoute : clic sur un segment → lecteur → la position avance
    await page.getByTestId('recap-tab-transcript').click();
    await page.getByTestId('tseg').first().click();
    await expect(page.getByTestId('miniplayer')).toBeVisible();
    await page.getByTestId('play-btn').click();
    await page.waitForTimeout(1200);
    const pos = await page.getByTestId('player-pos').innerText();
    expect(pos).toMatch(/\d{2}:\d{2}:\d{2}/);
    await page.getByRole('button', { name: /Avancer de 10/ }).click();

    // Recherche dans la transcription
    await page.goto('/search?q=dol');
    await expect(page.getByTestId('search-results')).toContainText('Vices du consentement'); // dans mes notes
    await expect(page.getByTestId('transcript-results')).toContainText('manœuvres frauduleuses'); // et dans la transcription
    await page.getByTestId('transcript-hit').first().click();
    await expect(page).toHaveURL(/\/recap\?t=\d+/);
    await expect(page.getByTestId('recap-tab-transcript')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.tseg.is-selected')).toContainText('manœuvres frauduleuses');

    // Suppression du CM : toutes ses données de capture disparaissent
    expect((await capIDB(page, 'segments')).length).toBe(1);
    await page.goto('/sessions');
    const row = page.getByTestId('session-row').filter({ hasText: /CM 01 — Vices du consentement/ });
    await row.getByTestId('row-menu').click();
    await page.getByRole('menuitem', { name: 'Supprimer' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer' }).click();
    await expect(page.getByTestId('session-row').filter({ hasText: /CM 01 — Vices du consentement/ })).toHaveCount(0);
    await expect.poll(async () => (await capIDB(page, 'segments')).length).toBe(0);
    expect((await capIDB(page, 'chunks')).length).toBe(0);
    expect((await capIDB(page, 'markers')).length).toBe(0);
    expect((await capIDB(page, 'audioSessions')).length).toBe(0);
  });

  test('palette de commandes : actions de transcription avec raccourcis affichés', async ({ page }) => {
    await page.goto('/');
    await createCm(page, { subject: 'Pal', module: 'M', title: 'Palette' });
    await page.keyboard.press(`${mod}+k`);
    await page.getByTestId('palette-input').fill('transcription');
    await expect(page.getByRole('option', { name: /Démarrer la transcription/ })).toContainText(/Alt/);
    await page.getByTestId('palette-input').fill('marquer');
    await expect(page.getByRole('option', { name: /Marquer ce moment/ })).toHaveAttribute('aria-disabled', 'true');
  });
});
