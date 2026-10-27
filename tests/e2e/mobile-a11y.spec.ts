import { expect, test } from '@playwright/test';
import { createCm, signUp } from './helpers';
import { auditPage, horizontalOverflow } from './a11y-audit';

/** Pages clés sur téléphone (390×844) : pas de défilement horizontal, contenu atteignable ; audit d'accessibilité rapide (règles A/AA mécaniques). */
const PAGES = [
  ['tableau de bord', '/'], ['matières', '/subjects'], ['séances', '/sessions'], ['supports', '/supports'], ['recherche', '/search'],
  ['réglages', '/settings'], ['diagnostic', '/settings/system-status'],
] as const;

test.describe('mobile + accessibilité', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('connexion / inscription : mobile et accessibilité', async ({ page }) => {
    for (const path of ['/login', '/signup']) {
      await page.goto(path);
      await expect(page.getByTestId('auth-submit')).toBeVisible();
      expect(await horizontalOverflow(page), `${path} déborde`).toBe(0);
      expect(await auditPage(page), `${path}`).toEqual([]);
    }
  });

  test('pages connectées : pas de débordement horizontal, audit sans violation', async ({ page }) => {
    await page.goto('/');
    await signUp(page, { subject: 'Droit' });
    const problems: string[] = [];
    for (const [name, path] of PAGES) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const overflow = await horizontalOverflow(page);
      if (overflow > 0) problems.push(`${name} (${path}) : défilement horizontal de ${overflow}px`);
      for (const v of await auditPage(page)) problems.push(`${name} (${path}) : ${v}`);
    }
    expect(problems).toEqual([]);
  });

  test('éditeur sur téléphone : écriture, barre d’outils, feuille de transcription', async ({ page }) => {
    await page.goto('/');
    await signUp(page);
    await createCm(page, { subject: 'Droit', title: 'Mobile' });
    expect(await horizontalOverflow(page)).toBe(0);
    const problems = (await auditPage(page)).map((v) => `éditeur : ${v}`);
    await page.locator('.note-prose').click();
    await page.keyboard.type('Notes prises sur téléphone');
    await expect(page.getByTestId('save-status')).toContainText('Enregistré', { timeout: 8000 });
    await page.getByTestId('open-transcript-sheet').click();
    await expect(page.locator('.sidepanel')).toBeVisible();
    problems.push(...(await auditPage(page)).map((v) => `éditeur + feuille : ${v}`));
    expect(await horizontalOverflow(page)).toBe(0);
    expect(problems).toEqual([]);
  });

  test('cibles tactiles : les actions principales mesurent au moins 24×24 px (WCAG 2.2 AA)', async ({ page }) => {
    await page.goto('/');
    await signUp(page, { subject: 'Droit' });
    await createCm(page, { subject: 'Droit', title: 'Cibles' });
    const small = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('button, a[href], [role=tab]')]
      .filter((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && (r.width < 24 || r.height < 24); })
      .map((e) => `${e.tagName.toLowerCase()}[${e.getAttribute('data-testid') ?? e.getAttribute('aria-label') ?? e.textContent?.trim().slice(0, 20)}] ${Math.round(e.getBoundingClientRect().width)}×${Math.round(e.getBoundingClientRect().height)}`));
    expect(small).toEqual([]);
  });
});
