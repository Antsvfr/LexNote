import { describe, expect, it } from 'vitest';
import { MemoryAdapter } from '@/services/storage/memoryAdapter';
import { MemoryCaptureStorage } from '@/services/capture/storage/memory';
import { CloudDb, InMemoryRemote } from './inMemoryRemote';
import { SyncEngine } from './engine';
import { NetworkError, type RemoteStore } from './types';
import { createModule, createSession, createSubject } from '@/domain/session';
import type { CourseSession } from '@/domain/types';

/**
 * Scénarios de PERTE DE DONNÉES (production readiness) : la règle d'or est « une note écrite n'est jamais perdue en silence ».
 * Chaque test vérifie le contenu final des notes sur tous les appareils, pas seulement l'absence d'erreur.
 */
interface Device { local: MemoryAdapter; cap: MemoryCaptureStorage; engine: SyncEngine; conflicts: CourseSession[]; online: boolean; remote: RemoteStore }
type Wrap = (r: RemoteStore) => RemoteStore;

function device(cloud: CloudDb, userId: string, o: { local?: MemoryAdapter; cap?: MemoryCaptureStorage; wrap?: Wrap } = {}): Device {
  const d = { local: o.local ?? new MemoryAdapter(true), cap: o.cap ?? new MemoryCaptureStorage(true), conflicts: [] as CourseSession[], online: true } as Device;
  const base = new InMemoryRemote(cloud, userId);
  d.remote = o.wrap ? o.wrap(base) : base;
  d.engine = new SyncEngine({
    userId, deviceId: `dev-${Math.random()}`, local: d.local, capture: () => d.cap, remote: d.remote,
    status: { update: () => undefined }, onApplied: () => undefined, isOnline: () => d.online,
    onConflictCopy: (_o, c) => d.conflicts.push(c),
  });
  return d;
}
/** « Rechargement de la page » : même base locale, tout le reste (moteur, mémoire) est neuf. */
const reload = (cloud: CloudDb, userId: string, d: Device, wrap?: Wrap) => device(cloud, userId, { local: d.local, cap: d.cap, wrap });

const doc = (text: string) => ({ type: 'doc', text });
const noteRow = (id: string, text: string) => ({ sessionId: id, content: doc(text), updatedAt: new Date().toISOString() });
async function seed(d: Device, userId: string) {
  const subject = createSubject(userId, { name: 'Droit', color: 'indigo' });
  const module = createModule(userId, subject.id, 'Contrats');
  const session = { ...createSession(userId, { subjectId: subject.id, moduleId: module.id, type: 'CM', title: 'Cours', number: 1, date: '2026-01-01' }), searchText: 'v1' };
  await d.local.commit({ putSubjects: [subject], putModules: [module], putSessions: [session], putNotes: [noteRow(session.id, 'v1')] });
  return session;
}
async function edit(d: Device, id: string, text: string, at = new Date()) {
  const s = (await d.local.loadLibrary()).sessions.find((x) => x.id === id)!;
  await d.local.commit({ putSessions: [{ ...s, searchText: text, updatedAt: at.toISOString() }], putNotes: [{ sessionId: id, content: doc(text), updatedAt: at.toISOString() }] });
}
const noteOf = async (d: Device, id: string) => (await d.local.getNotes(id))?.content;
const allNoteTexts = async (d: Device) => {
  const l = await d.local.loadLibrary();
  return (await Promise.all(l.sessions.map(async (s) => (await d.local.getNotes(s.id))?.content as { text?: string } | undefined))).map((c) => c?.text).sort();
};
const later = (ms: number) => new Date(Date.now() + ms);

describe('perte de données — scénarios de synchronisation', () => {
  it('A écrit → sync → B sync → B modifie → sync → A sync → rechargement de A : tout est identique, aucune perte', async () => {
    const cloud = new CloudDb();
    const a = device(cloud, 'u1'), b = device(cloud, 'u1');
    const s = await seed(a, 'u1');
    await a.engine.syncNow(); await b.engine.syncNow();
    expect(await noteOf(b, s.id)).toEqual(doc('v1'));
    await edit(b, s.id, 'v2 écrit sur B', later(1000));
    await b.engine.syncNow(); await a.engine.syncNow();
    const a2 = reload(cloud, 'u1', a);                       // rechargement de la page sur A
    await a2.engine.syncNow();
    expect(await noteOf(a2, s.id)).toEqual(doc('v2 écrit sur B'));
    expect(await allNoteTexts(a2)).toEqual(['v2 écrit sur B']);
    const c = device(cloud, 'u1'); await c.engine.syncNow();  // un 3e appareil neuf obtient la même chose
    expect(await allNoteTexts(c)).toEqual(['v2 écrit sur B']);
  });

  it('deux onglets (deux moteurs sur la même base locale) synchronisent en même temps : ni doublon ni perte', async () => {
    const cloud = new CloudDb();
    const tab1 = device(cloud, 'u1');
    const s = await seed(tab1, 'u1');
    const tab2 = reload(cloud, 'u1', tab1);
    await edit(tab1, s.id, 'frappe dans l’onglet 1', later(500));
    await Promise.all([tab1.engine.syncNow(), tab2.engine.syncNow(), tab1.engine.syncNow(), tab2.engine.syncNow()]);
    await tab1.engine.syncNow(); await tab2.engine.syncNow();
    expect(cloud.rows('course_sessions').size).toBe(1);
    expect(cloud.rows('subjects').size).toBe(1);
    expect(await allNoteTexts(tab1)).toEqual(['frappe dans l’onglet 1']);
    expect(await allNoteTexts(tab2)).toEqual(['frappe dans l’onglet 1']);
    expect(cloud.rows('course_sessions').get(s.id)?.notes_content).toEqual(doc('frappe dans l’onglet 1'));
  });

  it('réseau lent : la saisie continue pendant l’envoi, la nouvelle version part au tour suivant (modification PENDANT la synchronisation)', async () => {
    const cloud = new CloudDb();
    let release!: () => void; let started!: () => void;
    const inFlight = new Promise<void>((r) => { started = r; });
    const gate = new Promise<void>((r) => { release = r; });
    let slow = false;
    const wrap: Wrap = (r) => new Proxy(r, { get(t, k, rcv) {
      const v = Reflect.get(t, k, rcv);
      if (k === 'update' && typeof v === 'function') return async (...args: unknown[]) => { if (slow) { slow = false; started(); await gate; } return (v as (...a: unknown[]) => Promise<unknown>).apply(t, args); };
      return v;
    } });
    const a = device(cloud, 'u1', { wrap });
    const s = await seed(a, 'u1');
    await a.engine.syncNow();
    await edit(a, s.id, 'version 2', later(1000));
    slow = true;
    const syncing = a.engine.syncNow();                    // l'envoi de « version 2 » est bloqué (réseau lent)…
    await inFlight;
    await edit(a, s.id, 'version 3 tapée pendant l’envoi', later(2000));   // …l'étudiant continue d'écrire
    release(); await syncing;
    await a.engine.syncNow();
    expect(await noteOf(a, s.id)).toEqual(doc('version 3 tapée pendant l’envoi'));
    expect(cloud.rows('course_sessions').get(s.id)?.notes_content).toEqual(doc('version 3 tapée pendant l’envoi'));
    expect((await a.local.listDirty()).sessions).toHaveLength(0);
    expect(a.conflicts).toEqual([]);
  });

  it('coupure réseau au milieu d’un envoi de plusieurs lignes : reprise complète, sans doublon', async () => {
    const cloud = new CloudDb();
    let calls = 0; let failAt = 2;
    const wrap: Wrap = (r) => new Proxy(r, { get(t, k, rcv) {
      const v = Reflect.get(t, k, rcv);
      if ((k === 'insert' || k === 'update') && typeof v === 'function') return async (...args: unknown[]) => { if (++calls === failAt) throw new NetworkError(); return (v as (...a: unknown[]) => Promise<unknown>).apply(t, args); };
      return v;
    } });
    const a = device(cloud, 'u1', { wrap });
    const s = await seed(a, 'u1');                      // matière, module, séance : 3 envois
    await a.engine.syncNow();                           // le 2e échoue (réseau)
    expect((await a.local.listDirty()).sessions).toHaveLength(1);   // la séance est toujours « à envoyer »
    expect(await noteOf(a, s.id)).toEqual(doc('v1'));
    failAt = -1;
    await a.engine.syncNow();
    expect(cloud.rows('subjects').size).toBe(1); expect(cloud.rows('modules').size).toBe(1); expect(cloud.rows('course_sessions').size).toBe(1);
    expect((await a.local.listDirty()).sessions).toHaveLength(0);
  });

  it('hors ligne → modifications → retour en ligne : tout part, y compris après un rechargement pendant la coupure', async () => {
    const cloud = new CloudDb();
    const a = device(cloud, 'u1');
    const s = await seed(a, 'u1');
    await a.engine.syncNow();
    a.online = false;
    await edit(a, s.id, 'écrit hors ligne', later(1000));
    await a.engine.syncNow();                            // ne fait rien (hors ligne)
    const a2 = reload(cloud, 'u1', a); a2.online = false;  // l'étudiant recharge la page toujours hors ligne
    expect(await noteOf(a2, s.id)).toEqual(doc('écrit hors ligne'));
    a2.online = true;
    await a2.engine.syncNow();
    expect(cloud.rows('course_sessions').get(s.id)?.notes_content).toEqual(doc('écrit hors ligne'));
  });

  it('suppression distante d’une séance modifiée localement : la modification locale RESTAURE la séance', async () => {
    const cloud = new CloudDb();
    const a = device(cloud, 'u1'), b = device(cloud, 'u1');
    const s = await seed(a, 'u1');
    await a.engine.syncNow(); await b.engine.syncNow();
    await b.local.commit({ deleteSessions: [s.id] });
    await b.engine.syncNow();                            // B supprime la séance sur le serveur
    await edit(a, s.id, 'A a continué à écrire', later(1000));
    await a.engine.syncNow();                            // A n'a pas vu la suppression
    expect(await noteOf(a, s.id)).toEqual(doc('A a continué à écrire'));
    expect(cloud.rows('course_sessions').get(s.id)?.deleted_at ?? null).toBeNull();
    await b.engine.syncNow();
    expect(await noteOf(b, s.id)).toEqual(doc('A a continué à écrire'));
  });

  it('conflit distant avec rechargement entre les deux : les deux versions survivent sur les deux appareils', async () => {
    const cloud = new CloudDb();
    const a = device(cloud, 'u1'); let b = device(cloud, 'u1');
    const s = await seed(a, 'u1');
    await a.engine.syncNow(); await b.engine.syncNow();
    await edit(a, s.id, 'version A', later(1000));
    await edit(b, s.id, 'version B', later(2000));
    await a.engine.syncNow();
    b = reload(cloud, 'u1', b);                          // B recharge avant de se synchroniser
    await b.engine.syncNow(); await a.engine.syncNow(); await b.engine.syncNow();
    expect(await allNoteTexts(a)).toEqual(['version A', 'version B']);
    expect(await allNoteTexts(b)).toEqual(['version A', 'version B']);
    const copy = (await b.local.loadLibrary()).sessions.find((x) => x.conflictOf);
    expect(copy?.conflictOf).toBe(s.id);
  });

  it('reconnexion répétée (coupures en rafale) : état final cohérent, un seul exemplaire de chaque ligne', async () => {
    const cloud = new CloudDb();
    const a = device(cloud, 'u1');
    const s = await seed(a, 'u1');
    for (let i = 0; i < 5; i++) {
      cloud.offline = i % 2 === 0;
      await edit(a, s.id, `révision ${i}`, later(1000 * (i + 1)));
      await a.engine.syncNow();
    }
    cloud.offline = false;
    await a.engine.syncNow(); await a.engine.syncNow();
    expect(cloud.rows('course_sessions').size).toBe(1);
    expect(cloud.rows('course_sessions').get(s.id)?.notes_content).toEqual(doc('révision 4'));
    expect(await allNoteTexts(a)).toEqual(['révision 4']);
  });
});
