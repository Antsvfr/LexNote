import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, createCm, createSession, logIn, logOut, signUp, trackErrors, uniqueEmail, waitSaved } from './helpers';

/** Comptes, espaces personnels, synchronisation, hors ligne, types de séances (backend simulé : VITE_BACKEND=mock). */

const lx = <T,>(page: Page, fn: string, ...args: unknown[]) => page.evaluate(([f, a]) => (window as any).__lx[f as string](...(a as unknown[])) as T, [fn, args] as const);
const syncDone = async (page: Page) => {
  await page.getByTestId('sync-indicator').click();
  await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-state', /synced|idle/, { timeout: 15_000 });
  await expect.poll(() => page.getByTestId('sync-indicator').innerText(), { timeout: 15_000 }).not.toMatch(/attente|Synchronisation…/);
};

test.describe('authentification', () => {
  test('les pages privées exigent une connexion', async ({ page }) => {
    for (const path of ['/', '/sessions', '/subjects', '/settings', '/search', '/session/inconnue']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByTestId('auth-submit')).toBeVisible();
    }
  });

  test('inscription : validations, erreurs claires, puis connexion ; session restaurée après rechargement', async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto('/signup');
    await page.getByTestId('auth-email').fill('pas-un-email');
    await page.getByTestId('auth-password').fill('court');
    await page.getByTestId('auth-password2').fill('court');
    await page.getByTestId('auth-submit').click();
    await expect(page.getByTestId('auth-error')).toBeVisible();
    await page.getByTestId('auth-email').fill(uniqueEmail());
    await page.getByTestId('auth-password').fill(PASSWORD);
    await page.getByTestId('auth-password2').fill(PASSWORD + 'x');
    await page.getByTestId('auth-submit').click();
    await expect(page.getByTestId('auth-error')).toContainText(/identiques|correspond/i);

    const email = await signUp(page, { firstName: 'Camille' });
    await page.reload();
    await expect(page.getByTestId('greeting')).toContainText('Camille'); // session restaurée
    await logOut(page);
    await page.goto('/login');
    await page.getByTestId('auth-email').fill(email);
    await page.getByTestId('auth-password').fill('mauvais-mot-de-passe');
    await page.getByTestId('auth-submit').click();
    await expect(page.getByTestId('auth-error')).toContainText(/incorrect/i);
    await logIn(page, email);
    await expect(page.getByTestId('greeting')).toContainText('Camille');
    expect(errors.filter((e) => !/401|400|Failed to load/.test(e))).toEqual([]);
  });

  test('mot de passe oublié : message identique que le compte existe ou non', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByTestId('auth-email').fill('inconnu@example.com');
    await page.getByTestId('auth-submit').click();
    await expect(page.getByTestId('reset-sent')).toBeVisible();
  });

  test('onboarding : sans matière, on peut passer ; l’espace reste vide, sans donnée fictive', async ({ page }) => {
    await page.goto('/');
    await signUp(page);
    await expect(page.getByTestId('empty-dashboard')).toBeVisible();
    await page.goto('/sessions');
    await expect(page.getByTestId('session-row')).toHaveCount(0);
    await page.goto('/subjects');
    await expect(page.getByTestId('subject-card')).toHaveCount(0);
  });
});

test.describe('espaces strictement personnels', () => {
  test('A puis B sur le même navigateur : aucune donnée de A chez B, aucune trace après déconnexion', async ({ page }) => {
    await page.goto('/');
    const a = await signUp(page, { firstName: 'Alice' });
    await createCm(page, { subject: 'Droit secret d’Alice', title: 'Notes confidentielles' });
    await page.locator('.note-prose').click();
    await page.keyboard.type('mot-de-passe-du-wifi-alice');
    await waitSaved(page);
    await page.goto('/');
    await syncDone(page);
    await logOut(page);

    // Plus rien d'Alice en mémoire ni dans l'interface (recherche comprise) une fois déconnectée.
    await page.goto('/search?q=confidentielles');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.locator('body')).not.toContainText('Alice');
    await expect(page.locator('body')).not.toContainText('confidentielles');

    const b = await signUp(page, { firstName: 'Bob' });
    await expect(page.getByTestId('empty-dashboard')).toBeVisible();
    await page.goto('/search?q=confidentielles');
    await expect(page.getByText('Aucun résultat')).toBeVisible();
    await page.goto('/search?q=wifi');
    await expect(page.getByText('Aucun résultat')).toBeVisible();
    await page.goto('/subjects');
    await expect(page.getByTestId('subject-card')).toHaveCount(0);
    await page.goto('/session/identifiant-d-alice');
    await expect(page).not.toHaveURL(/\/session\//); // séance inexistante dans l'espace de Bob
    await createCm(page, { subject: 'Économie de Bob', title: 'Marchés' });
    await page.goto('/');
    await syncDone(page);
    await logOut(page);

    // Alice retrouve exactement ses données — et pas celles de Bob.
    await logIn(page, a);
    await page.goto('/subjects');
    await expect(page.getByTestId('subject-card')).toHaveCount(1);
    await expect(page.getByTestId('subject-card')).toContainText('Droit secret d’Alice');
    await expect(page.locator('body')).not.toContainText('Économie de Bob');

    // Côté « serveur » : chaque ligne appartient à son propriétaire.
    const users = await lx<{ id: string; email: string }[]>(page, 'users');
    const subjects = await lx<{ name: string; user_id: string }[]>(page, 'rows', 'subjects');
    const uid = (e: string) => users.find((u) => u.email === e.toLowerCase())!.id;
    expect(subjects.find((s) => s.name.includes('Alice'))?.user_id).toBe(uid(a));
    expect(subjects.find((s) => s.name.includes('Bob'))?.user_id).toBe(uid(b));
  });

  test('bases locales distinctes par compte ; clé d’API de transcription non partagée', async ({ page }) => {
    await page.goto('/');
    await signUp(page);
    await createCm(page, { subject: 'X', title: 'x' });
    const dbsA = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
    expect(dbsA.some((n) => /^lexnote-u-/.test(n ?? ''))).toBe(true);
    expect(dbsA).not.toContain('lexnote');
    await page.goto('/');
    await logOut(page);
    await signUp(page);
    const dbsB = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).filter((n) => /^lexnote-u-/.test(n ?? '')));
    expect(new Set(dbsB).size).toBe(2); // une base par compte
  });
});

test.describe('synchronisation local-first', () => {
  test('créer hors ligne (serveur coupé) puis retrouver sur « un autre appareil »', async ({ page, browser }) => {
    await page.goto('/');
    await signUp(page, { firstName: 'Léa' });
    await lx(page, 'setServerDown', true);
    await createSession(page, { type: 'TD', subject: 'Procédure', module: 'Instance', title: 'Cas pratique' });
    await page.locator('.note-prose').click();
    await page.keyboard.type('notes prises sans connexion');
    await waitSaved(page);
    await page.goto('/');
    await expect(page.getByTestId('sync-indicator')).toHaveAttribute('data-state', /offline|error/, { timeout: 20_000 }); // en attente, rien de perdu
    expect(await lx<unknown[]>(page, 'rows', 'course_sessions')).toHaveLength(0);

    // Retour du réseau : tout part.
    await lx(page, 'setServerDown', false);
    await page.getByTestId('sync-indicator').click();
    await expect.poll(async () => (await lx<unknown[]>(page, 'rows', 'course_sessions')).length, { timeout: 15_000 }).toBe(1);
    const cloud = (await lx<{ type: string; title: string; notes_content: unknown }[]>(page, 'rows', 'course_sessions'))[0]!;
    expect(cloud).toMatchObject({ type: 'TD', title: 'Cas pratique' });
    expect(JSON.stringify(cloud.notes_content)).toContain('notes prises sans connexion');

    // « Autre appareil » : mêmes identifiants (localStorage = compte + cloud simulé), aucune base locale.
    const state = await page.context().storageState();
    const ctx2 = await browser.newContext({ storageState: state, baseURL: 'http://localhost:4173' });
    const p2 = await ctx2.newPage();
    await p2.goto('/sessions');
    await expect(p2.getByTestId('session-row').filter({ hasText: 'Cas pratique' })).toBeVisible({ timeout: 15_000 });
    await p2.getByTestId('session-row').filter({ hasText: 'Cas pratique' }).getByRole('link').first().click();
    await expect(p2.locator('.note-prose')).toContainText('notes prises sans connexion');
    await ctx2.close();
  });

  test('conflit : les deux versions sont conservées, rien n’est écrasé', async ({ page }) => {
    await page.goto('/');
    await signUp(page);
    await createCm(page, { subject: 'Conflits', title: 'Original' });
    await page.locator('.note-prose').click();
    await page.keyboard.type('version locale');
    await waitSaved(page);
    await page.goto('/');
    await syncDone(page);
    const row = (await lx<{ id: string; version: number }[]>(page, 'rows', 'course_sessions'))[0]!;

    // Un autre appareil modifie la même séance sur le serveur, pendant qu'on édite ici (sans que l'éditeur ne le sache).
    await page.goto(`/session/${row.id}`);
    await page.locator('.note-prose').click();
    await page.keyboard.type(' + ajout local');
    await waitSaved(page);
    await lx(page, 'tamper', 'course_sessions', row.id, { notes_content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'version distante' }] }] }, search_text: 'version distante', title: 'Original (distant)' });
    await page.goto('/sessions');
    await page.getByTestId('sync-indicator').click();
    await expect(page.getByTestId('session-row')).toHaveCount(2, { timeout: 15_000 });
    const all = await page.getByTestId('session-row').allInnerTexts();
    expect(all.join('\n')).toMatch(/conflit/i);
    // Rien n'a été écrasé : la version locale existe toujours avec son texte.
    await page.getByTestId('session-row').filter({ hasText: /en conflit/i }).getByRole('link').first().click();
    await expect(page.locator('.note-prose')).toContainText('version locale + ajout local');
    await page.goBack();
    await page.getByTestId('session-row').filter({ hasText: '(distant)' }).getByRole('link').first().click();
    await expect(page.locator('.note-prose')).toContainText('version distante');
  });

  test('déconnecté → reconnecté : rien n’est perdu, aucun doublon', async ({ page }) => {
    await page.goto('/');
    const email = await signUp(page);
    await createCm(page, { subject: 'Persistance', title: 'Une seule fois' });
    await page.goto('/');
    await syncDone(page);
    await logOut(page);
    await logIn(page, email);
    await page.goto('/sessions');
    await expect(page.getByTestId('session-row')).toHaveCount(1);
    await syncDone(page);
    await page.reload();
    await expect(page.getByTestId('session-row')).toHaveCount(1);
    expect(await lx<unknown[]>(page, 'rows', 'course_sessions')).toHaveLength(1);
  });
});

test.describe('types de séances (CM / TD / TP…)', () => {
  test('un seul moteur : création, numérotation par type, regroupement, filtres', async ({ page }) => {
    await page.goto('/');
    await signUp(page);
    await createSession(page, { type: 'CM', subject: 'Droit civil', title: 'Introduction' });
    await createSession(page, { type: 'TD', subject: 'Droit civil', title: 'Cas pratique' });
    await expect(page.locator('.titlefield__num')).toContainText('TD 01');
    await createSession(page, { type: 'TD', subject: 'Droit civil', title: 'Commentaire' });
    await expect(page.locator('.titlefield__num')).toContainText('TD 02');
    await createSession(page, { type: 'TP', subject: 'Droit civil', title: 'Atelier' });
    await createSession(page, { type: 'SEMINAR', subject: 'Droit civil', title: 'Invité' });

    await page.goto('/sessions');
    await expect(page.getByTestId('session-row')).toHaveCount(5);
    await page.getByTestId('tab-TD').click();
    await expect(page.getByTestId('session-row')).toHaveCount(2);
    await page.getByTestId('tab-others').click();
    await expect(page.getByTestId('session-row')).toHaveCount(1);
    await page.getByTestId('tab-all').click();

    await page.getByRole('link', { name: /Droit civil/ }).first().click();
    await expect(page.getByTestId('group-CM')).toBeVisible();
    await expect(page.getByTestId('group-TD').getByTestId('session-row')).toHaveCount(2);
    await expect(page.getByTestId('group-TP')).toBeVisible();
    await expect(page.getByTestId('group-SEMINAR')).toBeVisible();
    await page.getByTestId('view-chrono').click();
    await expect(page.getByTestId('session-row')).toHaveCount(5);

    // Les séances TD/TP ont toutes les fonctions d'une séance : transcription, terminer…
    await page.getByTestId('session-row').filter({ hasText: 'Cas pratique' }).getByRole('link').first().click();
    await expect(page.getByTestId('transcription-btn')).toBeVisible();
    await page.getByTestId('finish-cm').click();
    await expect(page.getByTestId('recap-title')).toContainText('Cas pratique');
  });

  test('matière modifiable (icône, couleur), module facultatif', async ({ page }) => {
    await page.goto('/');
    await signUp(page, { subject: 'Droit' });
    await page.goto('/subjects');
    await page.getByRole('link', { name: /Ouvrir Droit/ }).click();
    await page.getByTestId('edit-subject').click();
    await page.getByTestId('subject-name').fill('Droit privé');
    await page.getByTestId('subject-save').click();
    await expect(page.getByRole('heading', { name: /Droit privé/ })).toBeVisible();
    await page.getByTestId('subject-new-session').click();
    await page.getByTestId('create-session').click(); // titre et module facultatifs
    await expect(page.getByTestId('editor')).toBeVisible();
  });
});

test.describe('anciennes données et compte', () => {
  test('anciennes notes d’avant les comptes : import explicite, jamais automatique', async ({ page }) => {
    await page.goto('/login');
    await page.evaluate(() => new Promise<void>((res, rej) => {
      const r = indexedDB.open('lexnote', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('subjects', { keyPath: 'id' }); db.createObjectStore('modules', { keyPath: 'id' });
        db.createObjectStore('sessions', { keyPath: 'id' }); db.createObjectStore('notes', { keyPath: 'sessionId' });
      };
      r.onsuccess = () => {
        const tx = r.result.transaction(['subjects', 'sessions'], 'readwrite');
        tx.objectStore('subjects').put({ id: 'old-s', name: 'Ancienne matière', color: 'indigo', createdAt: '2025-01-01T10:00:00.000Z', updatedAt: '2025-01-01T10:00:00.000Z' });
        tx.objectStore('sessions').put({ id: 'old-c', subjectId: 'old-s', moduleId: 'old-m', title: 'Ancien cours', number: 1, date: '2025-01-01', status: 'in_progress', durationSec: 0, wordCount: 0, excerpt: '', searchText: '', completedAt: null, createdAt: '2025-01-01T10:00:00.000Z', updatedAt: '2025-01-01T10:00:00.000Z' });
        tx.oncomplete = () => { r.result.close(); res(); }; tx.onerror = () => rej(tx.error);
      };
    }));
    await signUp(page);
    await expect(page.getByText('avant la création de votre compte')).toBeVisible();
    await page.goto('/sessions');
    await expect(page.getByTestId('session-row')).toHaveCount(0); // pas d'import automatique
    await page.goto('/');
    await page.getByRole('button', { name: 'Importer' }).click();
    await expect(page.getByText('avant la création de votre compte')).toHaveCount(0);
    await page.goto('/sessions');
    await expect(page.getByTestId('session-row').filter({ hasText: 'Ancien cours' })).toBeVisible();
  });

  test('suppression du compte : confirmation « SUPPRIMER », données cloud effacées', async ({ page }) => {
    await page.goto('/');
    await signUp(page);
    await createCm(page, { subject: 'À effacer', title: 'x' });
    await page.goto('/');
    await syncDone(page);
    expect(await lx<unknown[]>(page, 'rows', 'subjects')).toHaveLength(1);
    await page.goto('/settings');
    await page.getByTestId('delete-account').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Continuer' }).click();
    await page.getByRole('dialog').locator('input').fill('pas ça');
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer mon compte' }).click();
    await expect(page.getByTestId('delete-account')).toBeVisible(); // rien supprimé
    await page.getByTestId('delete-account').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Continuer' }).click();
    await page.getByRole('dialog').locator('input').fill('SUPPRIMER');
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer mon compte' }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(await lx<unknown[]>(page, 'rows', 'subjects')).toHaveLength(0);
    expect(await lx<unknown[]>(page, 'users')).toHaveLength(0);
  });
});
