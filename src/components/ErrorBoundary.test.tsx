import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ErrorBoundary } from './ErrorBoundary';
import { clearLogs, recentLogs } from '@/lib/log';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null; let el: HTMLElement | null = null;
afterEach(() => { act(() => root?.unmount()); el?.remove(); clearLogs(); vi.restoreAllMocks(); });

let shouldCrash = true;
function Bomb() { if (shouldCrash) throw new TypeError('contenu secret de la note'); return <p>tout va bien</p>; }
const mount = () => { el = document.createElement('div'); document.body.append(el); root = createRoot(el); act(() => root!.render(<ErrorBoundary><Bomb /></ErrorBoundary>)); return el; };

describe('ErrorBoundary global', () => {
  it('affiche le message prévu, un code de diagnostic, et JAMAIS le message technique ni le contenu', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    shouldCrash = true;
    const host = mount();
    expect(host.textContent).toContain('LexNote a rencontré un problème.');
    expect(host.textContent).toMatch(/Code de diagnostic : UI-CRASH-01\/[0-9a-f]{4}/);
    expect(host.textContent).not.toContain('contenu secret');
    expect([...host.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Réessayer', 'Retour à l’accueil']);
    expect(recentLogs().some((l) => l.scope === 'ui' && l.level === 'error')).toBe(true);
  });
  it('« Réessayer » ré-affiche l’application quand le problème a disparu', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    shouldCrash = true;
    const host = mount();
    shouldCrash = false;
    act(() => { (host.querySelector('button') as HTMLButtonElement).click(); });
    expect(host.textContent).toContain('tout va bien');
  });
});
