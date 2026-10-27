import { describe, expect, it } from 'vitest';
import { CONFLICT_SUFFIX, findConflictOriginal, isConflictCopy, stripConflictSuffix } from '@/domain/conflict';
import { resolveConflict, type ConflictStore } from './conflictResolution';
import type { CourseSession } from '@/domain/types';

const mk = (over: Partial<CourseSession>): CourseSession => ({ id: 'x', subjectId: 'S', moduleId: null, type: 'CM', number: 1, title: 'Droit civil', date: '2026-10-01', durationSec: 0, status: 'in_progress', completedAt: null, wordCount: 0, excerpt: '', searchText: '', createdAt: '', updatedAt: '', ...over } as CourseSession);
const original = mk({ id: 'orig', searchText: 'version serveur' });
const copy = mk({ id: 'copy', title: `Droit civil ${CONFLICT_SUFFIX}`, conflictOf: 'orig', searchText: 'version locale' });

function fakeStore() {
  const notes = new Map<string, unknown>([['orig', 'N-serveur'], ['copy', 'N-locale']]);
  const calls: string[] = [];
  const store: ConflictStore = {
    loadNotes: async (id) => notes.get(id),
    saveNotes: async (id, i) => { calls.push(`save:${id}`); notes.set(id, i.content); },
    deleteSession: async (id) => { calls.push(`delete:${id}`); notes.delete(id); },
    updateSession: async (id, p) => { calls.push(`update:${id}:${p.title}`); },
  };
  return { store, notes, calls };
}

describe('conflit de notes — reconnaissance', () => {
  it('copie reconnue par conflictOf ou, à défaut, par le suffixe du titre', () => {
    expect(isConflictCopy(copy)).toBe(true);
    expect(isConflictCopy(original)).toBe(false);
    expect(findConflictOriginal(copy, [original, copy])?.id).toBe('orig');
    const fromOtherDevice = { ...copy, conflictOf: undefined };
    expect(findConflictOriginal(fromOtherDevice, [original, fromOtherDevice])?.id).toBe('orig');
    expect(findConflictOriginal(copy, [copy])).toBeNull();                     // l'autre version n'existe plus
    expect(stripConflictSuffix(copy.title)).toBe('Droit civil');
  });
});

describe('conflit de notes — résolution sans perte', () => {
  it('« Garder celle-ci » : les notes de la copie remplacent l’original, PUIS la copie est supprimée', async () => {
    const f = fakeStore();
    expect(await resolveConflict('keep-this', copy, original, f.store)).toBe('orig');
    expect(f.notes.get('orig')).toBe('N-locale');
    expect(f.calls).toEqual(['save:orig', 'delete:copy']);                       // écrire AVANT de supprimer
  });
  it('« Garder l’autre » : la copie est supprimée, l’original est intact', async () => {
    const f = fakeStore();
    expect(await resolveConflict('keep-other', copy, original, f.store)).toBe('orig');
    expect(f.notes.get('orig')).toBe('N-serveur');
    expect(f.calls).toEqual(['delete:copy']);
  });
  it('« Conserver les deux » : rien n’est supprimé, la copie devient une séance ordinaire', async () => {
    const f = fakeStore();
    expect(await resolveConflict('keep-both', copy, original, f.store)).toBe('copy');
    expect(f.calls).toEqual(['update:copy:Droit civil (copie)']);
    expect(f.notes.size).toBe(2);
  });
  it('échec d’écriture : la copie n’est PAS supprimée', async () => {
    const f = fakeStore();
    f.store.saveNotes = async () => { throw new Error('quota'); };
    await expect(resolveConflict('keep-this', copy, original, f.store)).rejects.toThrow();
    expect(f.calls).toEqual([]);
    expect(f.notes.has('copy')).toBe(true);
  });
  it('notes de la copie introuvables : on refuse plutôt que d’écraser l’original par du vide', async () => {
    const f = fakeStore(); f.notes.delete('copy');
    await expect(resolveConflict('keep-this', copy, original, f.store)).rejects.toThrow();
    expect(f.notes.get('orig')).toBe('N-serveur');
  });
});
