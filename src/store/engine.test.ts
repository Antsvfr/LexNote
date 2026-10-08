import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryAdapter } from '@/services/storage/memoryAdapter';
import { MemoryCaptureStorage } from '@/services/capture/storage/memory';
import { CloudDb, InMemoryRemote } from '@/services/sync/inMemoryRemote';
import { SyncEngine } from '@/services/sync/engine';
import { EngineUnavailableError, registerEngineProvider, setActiveEngineProvider, unregisterEngineProvider } from '@/services/engine/provider';
import { makeDocx, makePptx } from '@/test/docs';
import { H, LB, P, seg } from '@/test/engineFixtures';
import { U } from '@/test/fixtures';
import { useEngine } from './engine';
import { useLibrary } from './library';

const file = (bytes: Uint8Array, name: string, type = '') => new File([bytes.slice().buffer as ArrayBuffer], name, { type });
const NOTES = { type: 'doc', content: [H(1, 'Le dol'), LB('definition', 'Dol : manœuvres destinées à tromper.'), LB('article', 'Art. 1137 : le dol.')] };

async function setup(userId = U) {
  const adapter = new MemoryAdapter(true);
  useLibrary.setState({ subjects: [], modules: [], sessions: [], ready: false });
  await useLibrary.getState().init(adapter, userId);
  await useEngine.getState().init(adapter, userId);
  const subject = await useLibrary.getState().addSubject({ name: 'Droit' });
  const session = await useLibrary.getState().addSession({ subjectId: subject.id, type: 'CM', title: 'Contrats', date: '2026-01-01' });
  await useLibrary.getState().saveNotes(session.id, { content: NOTES, plainText: 'Dol' });
  return { adapter, session };
}
const gen = (session: { id: string }, capture: MemoryCaptureStorage | null = null, fallback = true) =>
  useEngine.getState().generate(useLibrary.getState().sessions.find((s) => s.id === session.id)!, { capture, loadNotes: (id) => useLibrary.getState().loadNotes(id), fallbackToLocal: fallback });

describe('documents d’une séance', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => { ctx = await setup(); });

  it('import Word : analysé, prêt, fichier original conservé À PART du texte analysé', async () => {
    const bytes = makeDocx([{ text: 'Chapitre', heading: 1 }, { text: 'Le dol suppose des manœuvres.' }]);
    await useEngine.getState().importFiles(ctx.session.id, [file(bytes, 'cours.docx')]);
    const [d] = useEngine.getState().documents;
    expect(d).toMatchObject({ name: 'cours.docx', status: 'ready', format: 'docx', sessionId: ctx.session.id, userId: U });
    expect(d!.extraction!.units[0]!.text).toContain('manœuvres');
    const original = await ctx.adapter.getDocumentFile(d!.id);
    expect(original?.size).toBe(bytes.length);
    expect(JSON.stringify(d)).not.toContain('PK'); // le contenu binaire n'est pas dans la ligne analysée
  });
  it('PowerPoint : slides comptées ; doublon refusé ; .doc et image : « non exploitable » avec explication', async () => {
    const pptx = makePptx([{ title: 'Dol', body: ['Manœuvres'] }, { title: 'Violence', body: ['Contrainte'] }]);
    await useEngine.getState().importFiles(ctx.session.id, [file(pptx, 'slides.pptx'), file(pptx, 'copie.pptx')]);
    expect(useEngine.getState().documents).toHaveLength(1); // même contenu = doublon
    expect(useEngine.getState().documents[0]).toMatchObject({ count: 2, unitLabel: 'slide', status: 'ready' });
    await useEngine.getState().importFiles(ctx.session.id, [file(new Uint8Array([1, 2, 3]), 'ancien.doc'), file(new Uint8Array([9, 9]), 'photo.png', 'image/png')]);
    const [, doc, img] = useEngine.getState().documents;
    expect(doc).toMatchObject({ status: 'unsupported' }); expect(doc!.error).toMatch(/\.docx/);
    expect(img).toMatchObject({ status: 'unsupported' }); expect(img!.error).toMatch(/OCR/);
    expect(await ctx.adapter.getDocumentFile(img!.id)).toBeTruthy(); // l'image est conservée
  });
  it('réanalyse depuis le fichier original (même identifiant) ; suppression retire texte ET fichier', async () => {
    await useEngine.getState().importFiles(ctx.session.id, [file(makeDocx([{ text: 'Texte A.' }]), 'a.docx')]);
    const d = useEngine.getState().documents[0]!;
    await useEngine.getState().reanalyze(d.id);
    expect(useEngine.getState().documents).toHaveLength(1);
    expect(useEngine.getState().documents[0]!.id).toBe(d.id);
    await useEngine.getState().removeDocument(d.id);
    expect(useEngine.getState().documents).toHaveLength(0);
    expect(await ctx.adapter.loadDocuments()).toHaveLength(0);
    expect(await ctx.adapter.getDocumentFile(d.id)).toBeUndefined();
  });
  it('fichier trop gros : refusé avec un message clair', async () => {
    const big = new File(['x'], 'enorme.pdf'); Object.defineProperty(big, 'size', { value: 80 * 1048576 });
    await useEngine.getState().importFiles(ctx.session.id, [big]);
    expect(useEngine.getState().documents[0]).toMatchObject({ status: 'error' });
    expect(useEngine.getState().documents[0]!.error).toMatch(/volumineux/);
  });
});

describe('cours reconstruit : versions et sources intactes', () => {
  it('chaque génération crée une VERSION ; les anciennes et les sources ne changent pas', async () => {
    const { adapter, session } = await setup();
    await useEngine.getState().importFiles(session.id, [file(makeDocx([{ text: 'Dol : manœuvres destinées à tromper. Art. 1137.' }]), 'support.docx')]);
    const notesBefore = JSON.stringify(await adapter.getNotes(session.id));
    const docsBefore = JSON.stringify(await adapter.loadDocuments());
    const v1 = (await gen(session))!;
    expect(v1.courseVersion).toBe(1); expect(v1.content.sections.length).toBeGreaterThan(0);
    const v1Copy = JSON.stringify(v1);
    await useLibrary.getState().saveNotes(session.id, { content: { ...NOTES, content: [...NOTES.content, P('Nouveau paragraphe.')] }, plainText: 'x' });
    const v2 = (await gen(session))!;
    expect(v2.courseVersion).toBe(2);
    expect(v2.sourceSnapshot.hash).not.toBe(v1.sourceSnapshot.hash);
    const stored = await adapter.loadCourses();
    expect(stored.map((c) => c.courseVersion).sort()).toEqual([1, 2]);
    const strip = (c: unknown) => JSON.stringify({ ...(c as object), dirty: undefined });
    expect(strip(stored.find((c) => c.id === v1.id))).toBe(strip(JSON.parse(v1Copy))); // v1 conservée à l'identique
    expect(docsBefore).toBe(JSON.stringify(await adapter.loadDocuments())); // documents non modifiés
    expect(notesBefore).not.toBe(JSON.stringify(await adapter.getNotes(session.id))); // seules MES modifications changent mes notes
    expect(JSON.stringify((await adapter.getNotes(session.id))!.content)).toContain('Nouveau paragraphe');
  });
  it('moteur de cours injoignable : erreur claire, repli local possible, et les NOTES restent enregistrables (hors-ligne)', async () => {
    const { adapter, session } = await setup();
    registerEngineProvider({ id: 'remote', label: 'Cloud', local: false, isAvailable: () => true, compose: async () => { throw new EngineUnavailableError('injoignable'); } });
    setActiveEngineProvider('remote');
    expect(await gen(session, null, false)).toBeNull();
    expect(useEngine.getState().runs[session.id]).toMatchObject({ state: 'error', error: 'injoignable' });
    // l'application des notes ne dépend pas du moteur
    await useLibrary.getState().saveNotes(session.id, { content: { ...NOTES, content: [...NOTES.content, P('Écrit hors-ligne.')] }, plainText: 'Écrit hors-ligne.' });
    expect(JSON.stringify((await adapter.getNotes(session.id))!.content)).toContain('Écrit hors-ligne');
    // repli : un cours est quand même produit, et signalé
    const c = (await gen(session, null, true))!;
    expect(c.providerId).toBe('local'); expect(c.providerLabel).toMatch(/injoignable/);
    unregisterEngineProvider('remote');
  });
  it('transcription + documents + notes : le cours cite les trois', async () => {
    const { adapter, session } = await setup();
    const cap = new MemoryCaptureStorage(true);
    await cap.putSegments([{ ...seg('g1', 0, 'Le dol, ce sont des manœuvres destinées à tromper, article 1137.'), sessionId: session.id }] as never);
    await useEngine.getState().importFiles(session.id, [file(makeDocx([{ text: 'Le dol : manœuvres destinées à tromper (art. 1137).' }]), 's.docx')]);
    const c = (await gen(session, cap))!;
    const kinds = new Set<string>(); const walk = (s: (typeof c.content.sections)[number]) => { s.blocks.forEach((b) => b.refs.forEach((r) => kinds.add(r.location.kind))); s.children.forEach(walk); }; c.content.sections.forEach(walk);
    expect(kinds).toEqual(new Set(['NOTES', 'TRANSCRIPT', 'DOCUMENT']));
    void adapter;
  });
});

describe('isolation et synchronisation', () => {
  it('les documents et cours de A ne sont jamais visibles pour B ; le fichier original ne quitte pas l’appareil', async () => {
    const cloud = new CloudDb();
    const a = await setup('user-a');
    await useEngine.getState().importFiles(a.session.id, [file(makeDocx([{ text: 'Secret de A.' }]), 'secret.docx')]);
    await gen(a.session);
    const mk = (adapter: MemoryAdapter, userId: string) => new SyncEngine({ userId, deviceId: userId, local: adapter, capture: () => null, remote: new InMemoryRemote(cloud, userId), status: { update: () => undefined }, onApplied: () => undefined, isOnline: () => true });
    await mk(a.adapter, 'user-a').syncNow();
    expect(cloud.rows('source_documents').size).toBe(1); expect(cloud.rows('generated_courses').size).toBe(1);
    const row = [...cloud.rows('source_documents').values()][0]!;
    expect(JSON.stringify(row)).not.toContain('PK'); expect(row).not.toHaveProperty('file');
    // appareil 2 du même compte : texte et cours présents, fichier original absent
    const dev2 = new MemoryAdapter(true);
    await mk(dev2, 'user-a').syncNow();
    expect((await dev2.loadDocuments())[0]!.name).toBe('secret.docx');
    expect((await dev2.loadCourses())).toHaveLength(1);
    expect(await dev2.getDocumentFile((await dev2.loadDocuments())[0]!.id)).toBeUndefined();
    // utilisateur B
    const other = new MemoryAdapter(true);
    await mk(other, 'user-b').syncNow();
    expect(await other.loadDocuments()).toEqual([]); expect(await other.loadCourses()).toEqual([]);
  });
  it('déconnexion : l’état du moteur est vidé', async () => {
    await setup();
    useEngine.getState().reset();
    expect(useEngine.getState()).toMatchObject({ documents: [], courses: [], ready: false });
  });
});
