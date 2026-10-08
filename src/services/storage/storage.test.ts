import { beforeEach, describe, expect, it } from 'vitest';
import { IndexedDbAdapter } from './indexedDbAdapter';
import { MemoryAdapter } from './memoryAdapter';
import type { StorageAdapter } from './types';
import { mod as mkMod, sess, subj } from '@/test/fixtures';

/** Le même contrat doit être respecté par TOUS les adaptateurs (mémoire, IndexedDB, futur cloud). */
const factories: [string, () => Promise<StorageAdapter>][] = [
  ['memory', async () => new MemoryAdapter(true)],
  ['indexeddb', async () => IndexedDbAdapter.open(`test-${Math.random().toString(36).slice(2)}`)],
];

describe.each(factories)('StorageAdapter contract — %s', (_name, make) => {
  let db: StorageAdapter;
  beforeEach(async () => { db = await make(); });

  const fixture = () => {
    const subject = subj();
    const mod = mkMod(subject.id, 'Droit des contrats');
    const session = sess({ subjectId: subject.id, moduleId: mod.id, title: 'Formation', number: 2 });
    return { subject, mod, session };
  };

  it('persiste et recharge la bibliothèque', async () => {
    const { subject, mod, session } = fixture();
    await db.commit({ putSubjects: [subject], putModules: [mod], putSessions: [session] });
    const lib = await db.loadLibrary();
    expect(lib.subjects.map((s) => s.name)).toEqual(['Droit']);
    expect(lib.modules).toHaveLength(1);
    expect(lib.sessions[0]?.title).toBe('Formation');
  });

  it('stocke le contenu des notes séparément et le restitue à l’identique', async () => {
    const { session } = fixture();
    const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Art. 1128' }] }] };
    await db.commit({ putSessions: [session], putNotes: [{ sessionId: session.id, content, updatedAt: 'x' }] });
    expect((await db.getNotes(session.id))?.content).toEqual(content);
  });

  it('supprimer une séance supprime ses notes (atomique)', async () => {
    const { session } = fixture();
    await db.commit({ putSessions: [session], putNotes: [{ sessionId: session.id, content: {}, updatedAt: 'x' }] });
    await db.commit({ deleteSessions: [session.id] });
    expect(await db.getNotes(session.id)).toBeUndefined();
    expect((await db.loadLibrary()).sessions).toHaveLength(0);
  });

  it('meta + export + clearAll', async () => {
    const { subject } = fixture();
    await db.commit({ putSubjects: [subject] });
    await db.setMeta('k', 42);
    expect(await db.getMeta('k')).toBe(42);
    const bundle = await db.exportAll();
    expect(bundle.app).toBe('lexnote');
    expect(bundle.subjects).toHaveLength(1);
    await db.clearAll();
    expect((await db.loadLibrary()).subjects).toHaveLength(0);
    expect(await db.getMeta('k')).toBeUndefined();
  });
});

describe('IndexedDB — réouverture (simule un redémarrage du navigateur)', () => {
  it('retrouve les données après fermeture / réouverture de la base', async () => {
    const name = `reopen-${Math.random().toString(36).slice(2)}`;
    const first = await IndexedDbAdapter.open(name);
    const s = sess({ subjectId: 'a', moduleId: 'b', title: 'Persistant' });
    await first.commit({ putSessions: [s], putNotes: [{ sessionId: s.id, content: { hello: 'monde' }, updatedAt: 'x' }] });

    const second = await IndexedDbAdapter.open(name); // nouvelle connexion
    expect((await second.loadLibrary()).sessions[0]?.title).toBe('Persistant');
    expect((await second.getNotes(s.id))?.content).toEqual({ hello: 'monde' });
  });
});
