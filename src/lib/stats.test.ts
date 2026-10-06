import { describe, expect, it } from 'vitest';
import { computeDashboardStats, moduleProgress, pickResumeSession, shortDuration } from './stats';
import { thumbFor, THUMB_KEYS } from './thumbs';
import { greeting } from '@/store/profile';
import { createSession } from '@/domain/session';
import type { CourseSession, Module, Subject } from '@/domain/types';

const NOW = new Date(2026, 9, 6, 12).getTime();
const iso = (daysAgo: number) => { const d = new Date(NOW - daysAgo * 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const cm = (over: Partial<CourseSession>): CourseSession => ({ ...createSession({ subjectId: 's', moduleId: 'm', title: 'x', number: 1, date: iso(0) }), ...over });
const sub = (name: string, daysOld = 90): Subject => ({ id: name, name, color: 'indigo', createdAt: new Date(NOW - daysOld * 86_400_000).toISOString(), updatedAt: '' });

describe('statistiques du tableau de bord (valeurs réelles, jamais inventées)', () => {
  const sessions = [
    cm({ id: 'a', date: iso(1), wordCount: 100, durationSec: 3600 }),
    cm({ id: 'b', date: iso(3), wordCount: 50, durationSec: 1800 }),
    cm({ id: 'c', date: iso(20), wordCount: 300, durationSec: 7200 }),
  ];
  const mods = [{ id: 'm' } as Module, { id: 'm2' } as Module];

  it('totaux et évolution de la semaine', () => {
    const s = computeDashboardStats(sessions, [sub('Droit'), sub('Eco')], mods, NOW);
    expect(s.cm).toMatchObject({ value: '3', note: '+2 cette semaine', up: true });
    expect(s.words.value).toBe('450');
    expect(s.words.note).toBe('+150 cette semaine');
    expect(s.time.value).toBe('3 h 30');
    expect(s.time.note).toBe('+1 h 30 cette semaine');
    expect(s.subjects).toMatchObject({ value: '2', note: '2 modules', up: false });
  });
  it('repli sur « ce mois-ci » puis sur une information neutre — aucun pourcentage inventé', () => {
    expect(computeDashboardStats([cm({ date: iso(20) })], [], [], NOW).cm.note).toBe('+1 ce mois-ci');
    const old = computeDashboardStats([cm({ date: iso(200) })], [], [], NOW);
    expect(old.cm).toMatchObject({ note: 'Aucun récent', up: false });
    expect(old.words.note).toBe('Aucun cette semaine');
    expect(JSON.stringify(old)).not.toMatch(/%/);
  });
  it('bibliothèque vide', () => {
    const s = computeDashboardStats([], [], [], NOW);
    expect([s.cm.value, s.subjects.value, s.words.value]).toEqual(['0', '0', '0']);
    expect(s.time.value).toBe('0 min');
  });
  it('matière créée cette semaine', () => {
    expect(computeDashboardStats([], [sub('Neuf', 2)], [], NOW).subjects).toMatchObject({ note: '+1 cette semaine', up: true });
  });
  it('durées', () => { expect(shortDuration(2400)).toBe('40 min'); expect(shortDuration(3600 * 10 + 2400)).toBe('10 h 40'); });
});

describe('avancement honnête', () => {
  it('module : CM terminés / CM du module', () => {
    const l = [cm({ moduleId: 'm', status: 'completed' }), cm({ moduleId: 'm', status: 'completed' }), cm({ moduleId: 'm', status: 'completed' }), cm({ moduleId: 'm' }), cm({ moduleId: 'z', status: 'completed' })];
    expect(moduleProgress(l, 'm')).toEqual({ done: 3, total: 4, pct: 75 });
    expect(moduleProgress(l, 'vide')).toEqual({ done: 0, total: 0, pct: 0 });
  });
  it('CM à reprendre : le plus récent « en cours », sinon le plus récent', () => {
    const a = cm({ id: 'a', status: 'completed', updatedAt: '2026-10-05T10:00:00Z' });
    const b = cm({ id: 'b', updatedAt: '2026-10-01T10:00:00Z' });
    expect(pickResumeSession([a, b])?.id).toBe('b');
    expect(pickResumeSession([a])?.id).toBe('a');
    expect(pickResumeSession([])).toBeUndefined();
  });
});

describe('vignettes locales déterministes', () => {
  it('même CM = même image ; choix explicite prioritaire', () => {
    const droit = { name: 'Droit', color: 'indigo' };
    expect(thumbFor({ id: 'x1' }, droit)).toBe(thumbFor({ id: 'x1' }, droit));
    expect(['architecture', 'justice', 'document']).toContain(thumbFor({ id: 'x2' }, droit));
    expect(thumbFor({ id: 'x1', thumbnail: 'skyline' }, droit)).toBe('skyline');
  });
  it('par matière', () => {
    expect(thumbFor({ id: 'a' }, { name: 'Finance', color: 'x' })).toBe('chart');
    expect(thumbFor({ id: 'a' }, { name: 'Économie', color: 'x' })).toBe('skyline');
    expect(thumbFor({ id: 'a' }, { name: 'Marketing', color: 'x' })).toBe('abstract');
    expect(THUMB_KEYS).toContain(thumbFor({ id: 'a' }, { name: 'Histoire', color: 'x' }));
  });
});

describe('profil', () => {
  it('salutation générique sans prénom, personnalisée sinon', () => {
    expect(greeting('')).toBe('Bon cours !');
    expect(greeting('  Anton ')).toBe('Bon cours, Anton !');
  });
});
