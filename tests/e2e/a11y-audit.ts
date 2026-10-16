import type { Page } from '@playwright/test';

/**
 * Audit d'accessibilité RAPIDE (sans dépendance externe) : règles WCAG 2.2 A/AA les plus fréquentes et vérifiables sans moteur d'accessibilité.
 * Ne remplace pas un audit axe-core / lecteur d'écran (voir docs/PRODUCTION_RUNBOOK.md §Accessibilité). Renvoie la liste des violations.
 */
export async function auditPage(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const vis = (el: Element) => { const r = (el as HTMLElement).getBoundingClientRect(); const s = getComputedStyle(el as HTMLElement); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const label = (el: Element): string => {
      const h = el as HTMLElement;
      const aria = h.getAttribute('aria-label')?.trim(); if (aria) return aria;
      const by = h.getAttribute('aria-labelledby'); if (by) { const t = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim(); if (t) return t; }
      const txt = (h.innerText || h.textContent || '').trim(); if (txt) return txt;
      if (h.getAttribute('title')?.trim()) return h.getAttribute('title')!.trim();
      const img = h.querySelector('img[alt]'); if (img && img.getAttribute('alt')?.trim()) return img.getAttribute('alt')!.trim();
      return '';
    };
    const desc = (el: Element) => `${el.tagName.toLowerCase()}${(el as HTMLElement).id ? '#' + (el as HTMLElement).id : ''}${el.getAttribute('data-testid') ? `[data-testid=${el.getAttribute('data-testid')}]` : ''}${(el as HTMLElement).className && typeof (el as HTMLElement).className === 'string' ? '.' + (el as HTMLElement).className.split(/\s+/).slice(0, 2).join('.') : ''}`;

    if (!document.documentElement.lang) out.push('html : attribut lang absent');
    if (!document.title.trim()) out.push('document sans <title>');
    if (!document.querySelector('main, [role=main]')) out.push('aucun repère <main>');
    if (document.querySelectorAll('h1').length === 0) out.push('aucun <h1>');
    for (const el of document.querySelectorAll('button, a[href], [role=button], [role=tab], [role=menuitem], summary')) if (vis(el) && !label(el)) out.push(`nom accessible manquant : ${desc(el)}`);
    for (const el of document.querySelectorAll('input:not([type=hidden]), select, textarea')) {
      if (!vis(el)) continue;
      const h = el as HTMLInputElement;
      const labelled = (h.id && document.querySelector(`label[for="${CSS.escape(h.id)}"]`)) || h.closest('label') || h.getAttribute('aria-label') || h.getAttribute('aria-labelledby') || h.getAttribute('title');
      if (!labelled) out.push(`champ sans étiquette : ${desc(el)}`);
    }
    for (const el of document.querySelectorAll('img')) if (vis(el) && !el.hasAttribute('alt') && el.getAttribute('role') !== 'presentation' && el.getAttribute('aria-hidden') !== 'true') out.push(`image sans alt : ${desc(el)}`);
    for (const el of document.querySelectorAll('[tabindex]')) if (Number((el as HTMLElement).getAttribute('tabindex')) > 0) out.push(`tabindex positif : ${desc(el)}`);
    for (const el of document.querySelectorAll('dialog[open], [role=dialog], [role=alertdialog]')) if (vis(el) && !label(el) && !el.getAttribute('aria-labelledby')) out.push(`boîte de dialogue sans nom : ${desc(el)}`);
    const ids = new Map<string, number>(); document.querySelectorAll('[id]').forEach((e) => ids.set(e.id, (ids.get(e.id) ?? 0) + 1));
    for (const [id, n] of ids) if (n > 1) out.push(`id dupliqué : ${id}`);
    return out;
  });
}

/** Débordement horizontal de la page (mobile) : doit rester nul. */
export const horizontalOverflow = (page: Page) => page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
