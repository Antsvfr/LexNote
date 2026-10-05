import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryAdapter } from '@/services/storage/memoryAdapter';
import { useLibrary } from './library';
import { buildDemoLibrary } from '@/data/demo/demoData';

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
  const cm = await lib().addSession({ subjectId: s.id, moduleId: m.id, title: 'Introduction', date: '2025-02-01' });
  return { s, m, cm };
}

describe('bibliothèque', () => {
  it('crée matière, module et CM, et les persiste', async () => {
    const { s, m, cm } = await seed();
    expect(cm.number).toBe(1);
    const second = await lib().addSession({ subjectId: s.id, moduleId: m.id, title: 'Formation', date: '2025-02-08' });
    expect(second.number).toBe(2);
    const stored = await adapter.loadLibrary();
    expect(stored.subjects).toHaveLength(1);
    expect(stored.modules).toHaveLength(1);
    expect(stored.sessions).toHaveLength(2);
  });

  it('modifie un CM (titre, date) et la matière', async () => {
    const { s, cm } = await seed();
    await lib().updateSession(cm.id, { title: '  Nouveau titre ', date: '2025-03-03' });
    await lib().renameSubject(s.id, 'Droit privé');
    const stored = await adapter.loadLibrary();
    expect(stored.sessions[0]?.title).toBe('Nouveau titre');
    expect(stored.sessions[0]?.date).toBe('2025-03-03');
    expect(stored.subjects[0]?.name).toBe('Droit privé');
  });

  it('sauvegarde les notes, calcule mots/extrait et les relit', async () => {
    const { cm } = await seed();
    const content = { type: 'doc', content: [] };
    await lib().saveNotes(cm.id, { content, plainText: "L'article 1128 exige un consentement.", durationSec: 90 });
    const s = lib().sessions[0]!;
    expect(s.wordCount).toBe(5);
    expect(s.durationSec).toBe(90);
    expect(s.searchText).toContain('1128');
    expect(await lib().loadNotes(cm.id)).toEqual(content);
  });

  it('supprime un CM avec ses notes', async () => {
    const { cm } = await seed();
    await lib().saveNotes(cm.id, { content: { a: 1 }, plainText: 'x' });
    await lib().deleteSession(cm.id);
    expect(lib().sessions).toHaveLength(0);
    expect(await adapter.getNotes(cm.id)).toBeUndefined();
  });

  it('supprimer une matière supprime en cascade modules, CM et notes', async () => {
    const { s, cm } = await seed();
    await lib().saveNotes(cm.id, { content: { a: 1 }, plainText: 'x' });
    await lib().deleteSubject(s.id);
    const stored = await adapter.loadLibrary();
    expect(stored.subjects.length + stored.modules.length + stored.sessions.length).toBe(0);
    expect(await adapter.getNotes(cm.id)).toBeUndefined();
  });

  it('terminer / rouvrir un CM', async () => {
    const { cm } = await seed();
    await lib().setStatus(cm.id, 'completed');
    expect(lib().sessions[0]?.status).toBe('completed');
    expect(lib().sessions[0]?.completedAt).toBeTruthy();
    await lib().setStatus(cm.id, 'in_progress');
    expect(lib().sessions[0]?.completedAt).toBeNull();
  });
});

describe('données de démonstration', () => {
  async function installDemo() {
    const demo = buildDemoLibrary();
    await adapter.commit({ putSubjects: demo.subjects, putModules: demo.modules, putSessions: demo.sessions, putNotes: demo.notes });
    await lib().reload();
    return demo;
  }

  it('se suppriment entièrement sans toucher aux données utilisateur', async () => {
    const mine = await seed();
    await installDemo();
    await lib().removeDemoData();
    expect(lib().subjects.map((s) => s.id)).toEqual([mine.s.id]);
    expect(lib().sessions.map((s) => s.id)).toEqual([mine.cm.id]);
    expect((await adapter.exportAll()).notes.every((n) => !n.sessionId.startsWith('demo-'))).toBe(true);
  });

  it('conservent la matière/module de démo qui contient un CM créé par l’étudiant', async () => {
    const demo = await installDemo();
    const droit = demo.subjects[0]!;
    const contrats = demo.modules.find((m) => m.subjectId === droit.id && m.name.includes('contrats'))!;
    const mine = await lib().addSession({ subjectId: droit.id, moduleId: contrats.id, title: 'Le mien', date: '2025-05-05' });
    await lib().removeDemoData();
    expect(lib().subjects.map((s) => s.id)).toEqual([droit.id]);
    expect(lib().subjects[0]?.isDemo).toBeUndefined();
    expect(lib().sessions.map((s) => s.id)).toEqual([mine.id]);
  });

  it('une séance de démo modifiée par l’étudiant est conservée', async () => {
    const demo = await installDemo();
    const edited = demo.sessions.find((s) => s.id === 'demo-cm-c4')!;
    await lib().saveNotes(edited.id, { content: { x: 1 }, plainText: 'Mes vraies notes' });
    await lib().removeDemoData();
    expect(lib().sessions.map((s) => s.id)).toEqual([edited.id]);
  });
});
