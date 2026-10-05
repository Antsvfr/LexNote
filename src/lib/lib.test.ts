import { afterEach, describe, expect, it, vi } from 'vitest';
import { debounce } from './debounce';
import { countWords, normalize } from './text';
import { formatClock, formatDuration, todayISO } from './dates';

describe('debounce', () => {
  afterEach(() => vi.useRealTimers());
  it('regroupe les appels rapprochés', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 100, 1000);
    d(1); d(2); d(3);
    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith(3);
  });
  it('maxWait garantit une sauvegarde pendant une frappe continue', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 100, 500);
    for (let i = 0; i < 20; i++) { d(i); vi.advanceTimersByTime(50); }
    expect(fn).toHaveBeenCalled();
  });
  it('flush exécute immédiatement, cancel annule', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d('a'); d.flush();
    expect(fn).toHaveBeenCalledWith('a');
    d('b'); d.cancel(); vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalledOnce();
  });
});

describe('texte & dates', () => {
  it('compte les mots (accents, apostrophes, tirets)', () => {
    expect(countWords("L'article 1128 — c'est-à-dire le consentement")).toBe(5);
    expect(countWords('')).toBe(0);
  });
  it('normalise accents et casse', () => expect(normalize('Économie ÉLASTICITÉ')).toBe('economie elasticite'));
  it('formate durées et chrono', () => {
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatClock(65)).toBe('01:05');
    expect(formatDuration(0)).toBe('—');
    expect(formatDuration(5400)).toBe('1 h 30');
    expect(formatDuration(600)).toBe('10 min');
  });
  it('todayISO est local', () => expect(todayISO(new Date(2025, 0, 5))).toBe('2025-01-05'));
});
