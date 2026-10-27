#!/usr/bin/env node
// RÉPÉTITION du retour arrière FRONTEND, en local (builds de test avec backend simulé — jamais la production) :
//   la version N+1 est utilisée, puis on « redéploie » la version N (ancien build) SUR LA MÊME ORIGINE, avec le même profil de navigateur.
//   node scripts/prod/frontend-rollback-drill.mjs --old <dist de l'ancienne version> --new <dist de la nouvelle> [--port 4180]
// Vérifie : les notes écrites avec la nouvelle version restent lisibles avec l'ancienne ; ce qui est écrit avec l'ancienne revient dans la
// nouvelle ; un client qui avait la nouvelle version reçoit l'ancienne comme MISE À JOUR proposée (jamais imposée).
// Variables : CHROMIUM_PATH (facultatif). Nécessite @playwright/test (dépendance du dépôt).
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
/** Serveur statique avec repli SPA ; /sw.js jamais mis en cache (comme vercel.json). */
export function serve(dir, port) {
  const srv = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let f = normalize(join(dir, path));
    if (!f.startsWith(dir) || !existsSync(f) || statSync(f).isDirectory()) f = join(dir, 'index.html');
    res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream', 'cache-control': path === '/sw.js' ? 'no-cache' : 'public, max-age=0' });
    res.end(readFileSync(f));
  });
  return new Promise((ok) => srv.listen(port, '127.0.0.1', () => ok({ close: () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(r); }) })));
}

export async function drill({ oldDist, newDist, port = 4180, log = console.log, requireFrom = process.cwd() }) {
  const { chromium } = createRequire(join(requireFrom, 'package.json'))('@playwright/test');
  const results = []; const check = (name, ok, detail = '') => { results.push(ok); log(`${ok ? 'PASS' : 'FAIL'} — ${name}${ok || !detail ? '' : `  [${detail}]`}`); };
  const profile = mkdtempSync(join(tmpdir(), 'lexnote-profile-')); const base = `http://127.0.0.1:${port}`;
  const open = () => chromium.launchPersistentContext(profile, { executablePath: process.env.CHROMIUM_PATH || undefined, serviceWorkers: 'allow' });
  const email = `rollback${Date.now()}@example.com`; const PASSWORD = 'motdepasse-solide';
  const saved = async (page) => { await page.getByTestId('save-status').filter({ hasText: 'Enregistré' }).waitFor({ timeout: 8000 }); };

  // 1) NOUVELLE version : inscription, séance, notes
  let s = await serve(newDist, port); let ctx = await open(); let page = await ctx.newPage();
  try {
    await page.goto(`${base}/signup`);
    await page.getByTestId('auth-email').fill(email); await page.getByTestId('auth-password').fill(PASSWORD); await page.getByTestId('auth-password2').fill(PASSWORD); await page.getByTestId('auth-submit').click();
    await page.getByTestId('ob-firstname').fill('Anton'); await page.getByTestId('ob-next').click(); await page.getByTestId('ob-next').click(); await page.getByTestId('ob-skip').click();
    await page.getByTestId('greeting').waitFor();
    await page.goto(`${base}/sessions`); await page.getByTestId('sessions-new').click();
    const dlg = page.getByRole('dialog', { name: 'Nouvelle séance' });
    await dlg.getByLabel('Matière').selectOption('__new__').catch(() => undefined); await dlg.getByLabel('Nom de la nouvelle matière').fill('Droit civil');
    await dlg.getByLabel(/^Titre/).fill('Responsabilité'); await dlg.getByTestId('create-session').click();
    await page.getByTestId('editor').waitFor(); await page.locator('.note-prose').click(); await page.keyboard.type('Écrit avec la NOUVELLE version');
    await saved(page);
    // « Rester connecté » (appareil de confiance) : sans lui, la session est volontairement abandonnée à la fermeture du navigateur.
    await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('lexnote-device') ?? '{}'); localStorage.setItem('lexnote-device', JSON.stringify({ ...d, remember: true })); });
    await page.goto(`${base}/settings`);
    check('version N+1 en service (page Diagnostic présente)', await page.getByTestId('open-diagnostic').waitFor({ timeout: 8000 }).then(() => true, () => false));
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
    check('le service worker de la version N+1 contrôle la page', true);
    await ctx.close(); await s.close();

    // 2) RETOUR ARRIÈRE : l'ancien build est servi sur la même origine ; même profil
    s = await serve(oldDist, port); ctx = await open(); page = await ctx.newPage();
    await page.goto(`${base}/sessions`);
    const sawUpdate = await page.getByText('Une nouvelle version de LexNote est disponible.').waitFor({ timeout: 20000 }).then(() => true, () => false);
    check('un client qui avait N+1 reçoit l\'ancienne version comme MISE À JOUR proposée (jamais imposée)', sawUpdate);
    check('l\'étudiant reste connecté et ses séances sont visibles pendant ce temps', await page.getByTestId('session-row').first().waitFor({ timeout: 8000 }).then(() => true, () => false));
    if (sawUpdate) { await Promise.all([page.waitForEvent('load', { timeout: 15000 }).catch(() => undefined), page.getByRole('button', { name: 'Mettre à jour' }).click()]); await page.waitForTimeout(1500); }
    await page.goto(`${base}/settings`);
    await page.getByRole('heading', { name: 'Réglages' }).waitFor();
    await page.getByTestId('app-version').or(page.getByText(/^LexNote v/)).first().waitFor({ timeout: 8000 }).catch(() => undefined);
    check('après la mise à jour, c\'est bien l\'ANCIENNE version qui tourne (pas de page Diagnostic)', await page.getByTestId('open-diagnostic').count() === 0);
    await page.goto(`${base}/sessions`); await page.getByTestId('session-row').first().click(); await page.getByTestId('editor').waitFor();
    check('les notes écrites avec la nouvelle version sont intactes avec l\'ancienne', (await page.locator('.note-prose').innerText()).includes('Écrit avec la NOUVELLE version'));
    await page.locator('.note-prose').click(); await page.keyboard.press('Control+End'); await page.keyboard.type(' + suite avec l\'ANCIENNE');
    await saved(page);
    await ctx.close(); await s.close();

    // 3) RE-DÉPLOIEMENT de la nouvelle version : rien n'est perdu
    s = await serve(newDist, port); ctx = await open(); page = await ctx.newPage();
    await page.goto(`${base}/sessions`);
    const upd = page.getByRole('button', { name: 'Mettre à jour' });
    if (await upd.waitFor({ timeout: 15000 }).then(() => true, () => false)) { await Promise.all([page.waitForEvent('load', { timeout: 15000 }).catch(() => undefined), upd.click()]); await page.waitForTimeout(1500); }
    await page.goto(`${base}/sessions`); await page.getByTestId('session-row').first().click(); await page.getByTestId('editor').waitFor();
    const txt = await page.locator('.note-prose').innerText();
    check('retour à la nouvelle version : notes écrites des deux côtés présentes', txt.includes('NOUVELLE version') && txt.includes('ANCIENNE'), txt.slice(0, 120));
    await ctx.close(); await s.close();
  } catch (e) {
    check('répétition interrompue', false, String(e.message).split('\n')[0].slice(0, 300));
    await ctx.close().catch(() => undefined); await s.close().catch(() => undefined);
  }
  log(`\n${results.filter(Boolean).length}/${results.length} contrôles réussis`);
  return results.every(Boolean) ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2); const f = (n) => a[a.indexOf(n) + 1];
  if (!f('--old') || !f('--new')) { console.error('usage : --old <dist> --new <dist> [--port 4180]'); process.exit(2); }
  drill({ oldDist: f('--old'), newDist: f('--new'), port: a.includes('--port') ? Number(f('--port')) : 4180 }).then((c) => process.exit(c));
}
