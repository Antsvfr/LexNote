import { expect, type Page } from '@playwright/test';

/** Collecte les erreurs console / pageerror pour vérifier qu'aucune erreur importante n'apparaît. */
export function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

export const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

export async function createCm(page: Page, opts: { subject?: string; module?: string; title: string }) {
  await page.getByTestId('new-cm').first().click();
  const dlg = page.getByRole('dialog', { name: 'Nouveau CM' });
  if (opts.subject) {
    await dlg.getByLabel('Matière').selectOption('__new__');
    await dlg.getByLabel('Nom de la nouvelle matière').fill(opts.subject);
  }
  if (opts.module) await dlg.getByLabel('Nom du nouveau module').fill(opts.module);
  await dlg.getByLabel(/^Titre/).fill(opts.title);
  await dlg.getByTestId('create-cm').click();
  await expect(page.getByTestId('editor')).toBeVisible();
}

export async function waitSaved(page: Page) {
  await expect(page.getByTestId('save-status')).toContainText('Enregistré', { timeout: 8000 });
}
