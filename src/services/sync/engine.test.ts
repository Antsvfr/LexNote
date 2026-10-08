import { describe, expect, it } from 'vitest';
import { MemoryAdapter } from '@/services/storage/memoryAdapter';
import { MemoryCaptureStorage } from '@/services/capture/storage/memory';
import { CloudDb, InMemoryRemote } from './inMemoryRemote';
import { SyncEngine } from './engine';
import { createModule, createSession, createSubject } from '@/domain/session';
import type { CourseSession } from '@/domain/types';

interface Device { local: MemoryAdapter; cap: MemoryCaptureStorage; engine: SyncEngine; conflicts: CourseSession[]; online: boolean }

function device(cloud: CloudDb, userId: string): Device {
  const d = { local: new MemoryAdapter(true), cap: new MemoryCaptureStorage(true), conflicts: [] as CourseSession[], online: true } as Device;
  d.engine = new SyncEngine({
    userId, deviceId: `dev-${Math.random()}`, local: d.local, capture: () => d.cap, remote: new InMemoryRemote(cloud, userId),
    status: { update: () => undefined }, onApplied: () => undefined, isOnline: () => d.online,
    onConflictCopy: (_o, c) => d.conflicts.push(c),
  });
  return d;
}
const notes = (id: string, text: string) => ({ sessionId: id, content: { type: 'doc', text }, updatedAt: new Date().toISOString() });
const setup = async (d: Device, userId: string) => {
  const subject = createSubject(userId, { name: 'Droit', color: 'indigo' });
  const module = createModule(userId, subject.id, 'Contrats');
  const session = { ...createSession(userId, { subjectId: subject.id, moduleId: module.id, type: 'TD', title: 'Cas', number: 1, date: '2026-01-01' }), searchText: 'cas' };
  await d.local.commit({ putSubjects: [subject], putModules: [module], putSessions: [session], putNotes: [notes(session.id, 'v1')] });
  return { subject, module, session };
};

describe('synchronisation local-first', () => {
  it('envoie parents avant enfants puis un 2e appareil du même compte récupère tout', async () => {
    const cloud = new CloudDb();
    const a = device(cloud, 'u1'), b = device(cloud, 'u1');
    const { session } = await setup(a, 'u1');
    await a.engine.syncNow();
    expect((await a.local.listDirty()).sessions).toHaveLength(0);
    await b.engine.syncNow();
    const lib = await b.local.loadLibrary();
    expect(lib.subjects.map((s) => s.name)).toEqual(['Droit']);
    expect(lib.sessions[0]).toMatchObject({ id: session.id, type: 'TD', title: 'Cas' });
    expect((await b.local.getNotes(session.id))?.content).toEqual({ type: 'doc', text: 'v1' });
  });

  it('hors ligne : rien n’est perdu, tout part au retour du réseau', async () => {
    const cloud = new CloudDb();
    const a = device(cloud, 'u1');
    cloud.offline = true;
    const { session } = await setup(a, 'u1');
    await a.engine.syncNow();
    expect((await a.local.listDirty()).sessions).toHaveLength(1);
    expect((await a.local.loadLibrary()).sessions[0]?.id).toBe(session.id);
    cloud.offline = false;
    await a.engine.syncNow();
    expect((await a.local.listDirty()).sessions).toHaveLength(0);
    expect(cloud.rows('course_sessions').size).toBe(1);
  });

  it('plusieurs synchronisations de suite ne créent aucun doublon', async () => {
    const cloud = new CloudDb();
    const a = device(cloud, 'u1');
    await setup(a, 'u1');
    await Promise.all([a.engine.syncNow(), a.engine.syncNow(), a.engine.syncNow()]);
    await a.engine.syncNow();
    expect(cloud.rows('subjects').size).toBe(1);
    expect(cloud.rows('course_sessions').size).toBe(1);
  });

  it('JAMAIS de mélange entre comptes : un autre utilisateur ne reçoit rien', async () => {
    const cloud = new CloudDb();
    const a = device(cloud, 'u1'), other = device(cloud, 'u2');
    await setup(a, 'u1');
    await a.engine.syncNow();
    await other.engine.syncNow();
    const lib = await other.local.loadLibrary();
    expect(lib.subjects.length + lib.modules.length + lib.sessions.length).toBe(0);
  });

  it('suppression propagée à l’autre appareil (pierre tombale)', async () => {
    const cloud = new CloudDb();
    const a = device(cloud, 'u1'), b = device(cloud, 'u1');
    const { session, subject, module } = await setup(a, 'u1');
    await a.engine.syncNow(); await b.engine.syncNow();
    await a.local.commit({ deleteSessions: [session.id], deleteModules: [module.id], deleteSubjects: [subject.id] });
    await a.engine.syncNow(); await b.engine.syncNow();
    const lib = await b.local.loadLibrary();
    expect(lib.sessions).toHaveLength(0);
    expect(lib.subjects).toHaveLength(0);
  });

  it('conflit sur les notes : les deux versions sont conservées, rien n’est écrasé en silence', async () => {
    const cloud = new CloudDb();
    const a = device(cloud, 'u1'), b = device(cloud, 'u1');
    const { session } = await setup(a, 'u1');
    await a.engine.syncNow(); await b.engine.syncNow();
    // A et B modifient la même séance sans se voir.
    const base = (await a.local.loadLibrary()).sessions[0]!;
    await a.local.commit({ putSessions: [{ ...base, searchText: 'version A', updatedAt: new Date().toISOString() }], putNotes: [notes(session.id, 'A')] });
    const baseB = (await b.local.loadLibrary()).sessions[0]!;
    await b.local.commit({ putSessions: [{ ...baseB, searchText: 'version B', updatedAt: new Date().toISOString() }], putNotes: [notes(session.id, 'B')] });
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow();
    const texts = async (d: Device) => {
      const l = await d.local.loadLibrary();
      return (await Promise.all(l.sessions.map(async (s) => JSON.stringify((await d.local.getNotes(s.id))?.content)))).sort();
    };
    const ta = await texts(a), tb = await texts(b);
    expect(tb).toHaveLength(2);
    expect(tb.join()).toContain('"text":"A"');
    expect(tb.join()).toContain('"text":"B"');
    expect(ta).toEqual(tb);
    expect(b.conflicts).toHaveLength(1);
  });

  it('une modification locale en attente n’est jamais écrasée par une réception', async () => {
    const cloud = new CloudDb();
    const a = device(cloud, 'u1'), b = device(cloud, 'u1');
    const { session } = await setup(a, 'u1');
    await a.engine.syncNow(); await b.engine.syncNow();
    const s = (await b.local.loadLibrary()).sessions[0]!;
    await b.local.commit({ putSessions: [{ ...s, title: 'Titre local', updatedAt: new Date().toISOString() }] });
    await b.engine.syncNow();
    expect((await b.local.loadLibrary()).sessions.find((x) => x.id === session.id)?.title).toBe('Titre local');
    await a.engine.syncNow();
    expect((await a.local.loadLibrary()).sessions.find((x) => x.id === session.id)?.title).toBe('Titre local');
  });

  it('les marqueurs et segments de capture se synchronisent (l’audio ne part jamais)', async () => {
    const cloud = new CloudDb();
    const a = device(cloud, 'u1'), b = device(cloud, 'u1');
    const { session } = await setup(a, 'u1');
    await a.cap.putSegments([{ id: 'g1', userId: 'u1', sessionId: session.id, startMs: 0, endMs: 1000, text: 'Art. 1128', provider: 'fake', status: 'final', source: 'TRANSCRIPTION', verification: 'UNVERIFIED', createdAt: 'x' } as never]);
    await a.cap.putMarker({ id: 'm1', userId: 'u1', sessionId: session.id, atMs: 500, reasons: ['exam'], createdAt: 'x' } as never);
    await a.engine.syncNow(); await b.engine.syncNow();
    expect((await b.cap.listSegments(session.id)).map((s) => s.text)).toEqual(['Art. 1128']);
    expect(await b.cap.listMarkers(session.id)).toHaveLength(1);
    expect(JSON.stringify([...cloud.tables.keys()])).not.toMatch(/chunk|audio_blob/);
  });
});
