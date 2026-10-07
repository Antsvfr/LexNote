import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryAdapter } from '@/services/storage/memoryAdapter';
import { useLibrary } from './library';

let adapter: MemoryAdapter;
beforeEach(async () => {
  adapter = new MemoryAdapter(true);
  useLibrary.setState({ subjects: [], modules: [], sessions: [], ready: false });
  await useLibrary.getState().init(adapter);
});
const lib = () => useLibrary.getState();

async function seed() {
  const s = await lib().addSubject('Droit');
  const m = await lib().addModule(s.id, 'Droit des contrats');
  const cm = await lib().addSession({ subjectId: s.id, moduleId: m.id, type: 'CM', title: 'Introduction', date: '2025-02-01' });
  return { s, m, cm };
}

describe('bibliothèque multi-types', () => {
  it('crée et numérote CM, TD et TP indépendamment', async () => {
    const { s, m, cm } = await seed();
    expect(cm.number).toBe(1);
    const cm2 = await lib().addSession({ subjectId: s.id, moduleId: m.id, type: 'CM', title: 'Formation', date: '2025-02-08' });
    const td1 = await lib().addSession({ subjectId: s.id, moduleId: m.id, type: 'TD', title: 'Cas pratique', date: '2025-02-09' });
    const tp1 = await lib().addSession({ subjectId: s.id, moduleId: m.id, type: 'TP', title: 'Atelier', date: '2025-02-10' });
    expect(cm2.number).toBe(2);
    expect(td1.number).toBe(1);
    expect(tp1.number).toBe(1);
    expect((await adapter.loadLibrary()).sessions).toHaveLength(4);
  });

  it('autorise une séance sans module', async () => {
    const s = await lib().addSubject('Économie');
    const td = await lib().addSession({ subjectId: s.id, type: 'TD', title: 'Exercices', date: '2025-02-01' });
    expect(td.moduleId).toBe('');
    expect(td.type).toBe('TD');
  });

  it('sauvegarde les notes et les relit', async () => {
    const { cm } = await seed();
    const note = { type: 'doc', content: [] };
    await lib().saveNotes(cm.id, { content: note, plainText: "L'article 1128 exige un consentement.", durationSec: 90 });
    const s = lib().sessions[0]!;
    expect(s.wordCount).toBe(5);
    expect(s.durationSec).toBe(90);
    expect(s.searchText).toContain('1128');
    expect(await lib().loadNotes(cm.id)).toEqual(note);
  });

  it('supprime une séance avec ses notes', async () => {
    const { cm } = await seed();
    await lib().saveNotes(cm.id, { content: { a: 1 }, plainText: 'x' });
    await lib().deleteSession(cm.id);
    expect(lib().sessions).toHaveLength(0);
    expect(await adapter.getNotes(cm.id)).toBeUndefined();
  });

  it('supprimer une matière supprime en cascade modules, séances et notes', async () => {
    const { s, cm } = await seed();
    await lib().saveNotes(cm.id, { content: { a: 1 }, plainText: 'x' });
    await lib().deleteSubject(s.id);
    const stored = await adapter.loadLibrary();
    expect(stored.subjects.length + stored.modules.length + stored.sessions.length).toBe(0);
    expect(await adapter.getNotes(cm.id)).toBeUndefined();
  });

  it('termine puis rouvre une séance', async () => {
    const { cm } = await seed();
    await lib().setStatus(cm.id, 'completed');
    expect(lib().sessions[0]?.status).toBe('completed');
    expect(lib().sessions[0]?.completedAt).toBeTruthy();
    await lib().setStatus(cm.id, 'in_progress');
    expect(lib().sessions[0]?.completedAt).toBeNull();
  });
});
