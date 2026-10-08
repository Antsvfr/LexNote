import { describe, expect, it } from 'vitest';
import { H, LB, P, doc, material, seg } from '@/test/engineFixtures';
import type { CourseSectionNode, GeneratedBlock } from '@/domain/course';
import { buildSourceSet } from './chunking';
import { MemoryAnalysisCache } from './context';
import { ENGINE_VERSION, STAGES, runCourseEngine, snapshotOf, type Stage } from './pipeline';
import { EngineUnavailableError, createRemoteProvider, type CourseEngineProvider } from './provider';
import { validateCourse, UNVERIFIED } from './validator';

const blocksOf = (secs: CourseSectionNode[]): GeneratedBlock[] => secs.flatMap((s) => [...s.blocks, ...blocksOf(s.children)]);
const flatSecs = (secs: CourseSectionNode[]): CourseSectionNode[] => secs.flatMap((s) => [s, ...flatSecs(s.children)]);

describe('cours reconstruit : structure issue des sources', () => {
  it('le plan reprend les titres réels des notes (pas de modèle fixe)', async () => {
    const run = await runCourseEngine(material());
    const titles = flatSecs(run.content.sections).map((s) => s.title);
    expect(titles).toEqual(['Formation du contrat', 'Consentement', 'Dol', 'Violence', 'Capacité']);
    expect(flatSecs(run.content.sections).every((s) => s.titleOrigin === 'notes')).toBe(true);
    const dol = flatSecs(run.content.sections).find((s) => s.title === 'Dol')!;
    expect(dol.blocks.map((b) => b.kind)).toEqual(expect.arrayContaining(['definition', 'reference', 'important']));
  });
  it('rien d’artificiel : pas d’introduction, de conclusion ni de section vide quand le cours n’en a pas', async () => {
    const run = await runCourseEngine(material());
    expect(run.content.conclusion).toBeUndefined();
    expect(flatSecs(run.content.sections).every((s) => s.blocks.length > 0 || s.children.length > 0)).toBe(true);
    const c2 = await runCourseEngine(material({ notes: { type: 'doc', content: [P('Introduction du professeur.'), H(1, 'Partie'), P('Contenu. En conclusion, le dol vicie le consentement.')] } }));
    expect(c2.content.intro?.text).toBe('Introduction du professeur.');
    expect(c2.content.conclusion?.text).toMatch(/^En conclusion/);
  });
  it('sans notes ni plan : découpage thématique de la transcription, titres signalés « déduits »', async () => {
    const segs = Array.from({ length: 40 }, (_, i) => seg(`s${i}`, i * 30_000, i < 20 ? `Le consentement doit être libre et éclairé, le dol vicie le consentement ${i}.` : `La capacité des mineurs et des majeurs protégés est encadrée, tutelle curatelle ${i}.`));
    const run = await runCourseEngine(material({ notes: { type: 'doc', content: [] }, segments: segs, documents: [], markers: [], anchors: [] }));
    const secs = run.content.sections;
    expect(secs.length).toBeGreaterThanOrEqual(2);
    expect(secs.every((s) => s.titleOrigin === 'transcript' && /^Passage \d\d:\d\d–\d\d:\d\d/.test(s.title))).toBe(true);
  });
  it('les documents sans titre rejoignent la bonne partie par similarité', async () => {
    const run = await runCourseEngine(material());
    const viol = flatSecs(run.content.sections).find((s) => s.title === 'Violence')!;
    expect(blocksOf([viol]).some((b) => b.refs.some((r) => r.location.kind === 'DOCUMENT' && r.location.page === 18))).toBe(true);
  });
});

describe('provenance', () => {
  it('chaque bloc cite au moins une source ; chaque citation est un extrait EXACT d’un morceau existant', async () => {
    const m = material();
    const run = await runCourseEngine(m);
    const chunks = new Map(buildSourceSet(m).chunks.map((c) => [c.id, c]));
    const bs = blocksOf(run.content.sections);
    expect(bs.length).toBeGreaterThan(5);
    for (const b of bs) {
      expect(b.refs.length, b.text).toBeGreaterThan(0);
      for (const r of b.refs) { const c = chunks.get(r.chunkId)!; expect(c, r.chunkId).toBeTruthy(); expect(c.text).toContain(r.quote.slice(0, 40)); }
    }
  });
  it('un même élément retrouvé dans les notes, la transcription et le PDF cumule ses trois sources', async () => {
    const run = await runCourseEngine(material());
    const art = blocksOf(run.content.sections).find((b) => b.kind === 'reference' && b.label === 'Art. 1137')!;
    const kinds = new Set(art.refs.map((r) => r.location.kind));
    expect(kinds).toEqual(new Set(['NOTES', 'TRANSCRIPT', 'DOCUMENT']));
    expect(art.confidence).toBe('VERIFIED');
    expect(art.refs.find((r) => r.location.kind === 'TRANSCRIPT')!.location).toMatchObject({ startMs: 0, segmentIds: expect.arrayContaining(['g2']) });
  });
  it('le point marqué « examen » pendant le cours renvoie à la plage de transcription et au marqueur', async () => {
    const run = await runCourseEngine(material());
    const exam = blocksOf(run.content.sections).filter((b) => b.kind === 'important').flatMap((b) => b.refs).find((r) => r.location.kind === 'TRANSCRIPT')!;
    expect(exam.location.markerIds).toEqual(['m1']);
  });
  it('NON-INVENTION : tout article / arrêt / date affiché figure dans les sources citées', async () => {
    const run = await runCourseEngine(material());
    for (const b of blocksOf(run.content.sections)) {
      const cited = b.refs.map((r) => r.quote).join(' ').toLowerCase();
      for (const t of b.text.match(/art\.?\s*\d+|n°\s*\d[\d./-]+/gi) ?? []) expect(cited.replace(/\s+/g, '')).toContain(t.toLowerCase().replace(/\s+/g, ''));
    }
  });
});

describe('fiabilité : VERIFIED / SUPPORTED / UNCERTAIN / CONFLICTING / MISSING_SOURCE', () => {
  it('conflit entre deux sources : affiché dans « à vérifier », avec les deux valeurs et leurs sources', async () => {
    const m = material({
      notes: { type: 'doc', content: [H(1, 'Réforme'), P('L’ordonnance portant réforme du droit des contrats date du 10 février 2016.')] },
      documents: [doc({ name: 'plan.pdf', units: [{ index: 5, text: 'L’ordonnance portant réforme du droit des contrats date du 12 mars 2017.' }] })], segments: [], markers: [], anchors: [],
    });
    const run = await runCourseEngine(m);
    const conflict = run.content.toVerify.find((b) => b.kind === 'verify' && b.conflict)!;
    expect(conflict.confidence).toBe('CONFLICTING');
    expect(conflict.conflict!.values).toHaveLength(2);
    expect(conflict.refs.map((r) => r.location.kind).sort()).toEqual(['DOCUMENT', 'NOTES']);
    expect(run.stats.conflicts).toBe(1);
    expect(run.content.stats.byConfidence.CONFLICTING).toBeGreaterThan(0);
  });
  it('date uniquement dans les notes alors que le PDF traite du sujet : INCERTAINE', async () => {
    const m = material({
      notes: { type: 'doc', content: [H(1, 'Réforme'), P('La réforme du droit des contrats a été adoptée le 10 février 2016 par ordonnance.')] },
      documents: [doc({ units: [{ index: 3, text: 'La réforme du droit des contrats a été adoptée par ordonnance.' }] })], segments: [], markers: [], anchors: [],
    });
    const run = await runCourseEngine(m);
    const b = blocksOf(run.content.sections).find((x) => x.kind === 'figure')!;
    expect(b.confidence).toBe('UNCERTAIN');
    expect(run.content.toVerify.some((v) => v.id === `v-${b.id}`)).toBe(true);
  });
});

describe('validation : dernière barrière (valable pour tout fournisseur, y compris IA)', () => {
  const base = (m = material()) => new Map(buildSourceSet(m).chunks.map((c) => [c.id, c]));
  const content = (blocks: unknown[]) => ({ title: 'T', sections: [{ id: 's', title: 'S', level: 1, titleOrigin: 'engine', blocks, children: [] }], toVerify: [], stats: { chunks: 0, units: 0, blocks: 0, byConfidence: {}, byOrigin: {}, dropped: 0 } });
  it('un bloc « extrait » sans source valide est écarté ; une citation inexistante est retirée', () => {
    const chunks = base(); const real = [...chunks.values()].find((c) => c.text.startsWith('Dol :'))!;
    const r = validateCourse(content([
      { id: 'a', kind: 'definition', text: 'Dol : manœuvres', origin: 'extracted', confidence: 'SUPPORTED', unitIds: [], refs: [{ sourceId: real.sourceId, chunkId: real.id, location: real.location, quote: 'Dol : manœuvres destinées à tromper' }] },
      { id: 'b', kind: 'definition', text: 'Inventé', origin: 'extracted', confidence: 'SUPPORTED', unitIds: [], refs: [{ sourceId: 'x', chunkId: 'inexistant', location: { kind: 'NOTES' }, quote: 'zzz' }] },
      { id: 'c', kind: 'explanation', text: 'Citation fausse', origin: 'extracted', confidence: 'SUPPORTED', unitIds: [], refs: [{ sourceId: real.sourceId, chunkId: real.id, location: real.location, quote: 'Phrase qui ne figure pas dans le morceau' }] },
    ]), chunks);
    expect(r.content.sections[0]!.blocks.map((b) => b.id)).toEqual(['a']);
    expect(r.dropped).toBe(2);
  });
  it('un bloc généré cite un article / arrêt / date absents des sources → MISSING_SOURCE « Information non vérifiée dans les sources »', () => {
    const chunks = base(); const real = [...chunks.values()].find((c) => c.text.startsWith('Dol :'))!;
    const ref = { sourceId: real.sourceId, chunkId: real.id, location: real.location, quote: 'Dol : manœuvres destinées à tromper' };
    const r = validateCourse(content([
      { id: 'a', kind: 'reference', text: 'Cass. civ. 1re, 12 mars 2019, n° 18-12345 : le dol…', origin: 'generated', confidence: 'VERIFIED', unitIds: [], refs: [ref] },
      { id: 'b', kind: 'explanation', text: 'Voir l’article 1240 du Code civil.', origin: 'generated', confidence: 'SUPPORTED', unitIds: [], refs: [] },
    ]), chunks);
    const [a, b] = r.content.sections[0]!.blocks;
    expect(a!.confidence).toBe('MISSING_SOURCE'); expect(a!.note).toContain(UNVERIFIED);
    expect(b!.confidence).toBe('MISSING_SOURCE'); expect(b!.note).toContain(UNVERIFIED);
    expect(r.downgraded).toBe(2);
  });
  it('structure invalide : refusée (aucun parsing fragile)', () => {
    expect(() => validateCourse({ title: 'x' }, base())).toThrow();
    expect(() => validateCourse(content([{ id: 'a', kind: 'poeme', text: 'x', origin: 'extracted', confidence: 'SUPPORTED', unitIds: [], refs: [] }]), base())).toThrow();
  });
});

describe('moteurs interchangeables, hors-ligne, sans écrasement', () => {
  it('un moteur distant « généré » passe par la même validation (une citation inventée est neutralisée)', async () => {
    const m = material();
    const chunks = buildSourceSet(m).chunks; const real = chunks.find((c) => c.text.startsWith('Dol :'))!;
    const provider: CourseEngineProvider = { id: 'fake-cloud', label: 'Faux cloud', local: false, isAvailable: () => true, compose: async () => ({
      title: 'Cours IA', sections: [{ id: 's1', title: 'Le dol', level: 1, titleOrigin: 'engine', children: [], blocks: [
        { id: 'x1', kind: 'definition', text: 'Dol : manœuvres destinées à tromper le cocontractant.', origin: 'extracted', confidence: 'SUPPORTED', unitIds: [], refs: [{ sourceId: real.sourceId, chunkId: real.id, location: real.location, quote: 'Dol : manœuvres destinées à tromper le cocontractant.' }] },
        { id: 'x2', kind: 'reference', text: 'Cass. civ. 3e, 5 mai 2010, n° 09-11111', origin: 'generated', confidence: 'VERIFIED', unitIds: [], refs: [] },
      ] }], toVerify: [], stats: { chunks: 0, units: 0, blocks: 0, byConfidence: {}, byOrigin: {}, dropped: 0 },
    }) };
    const run = await runCourseEngine(m, { provider });
    expect(run.providerId).toBe('fake-cloud');
    const bs = blocksOf(run.content.sections);
    expect(bs.find((b) => b.id === 'x1')!.confidence).toBe('SUPPORTED');
    expect(bs.find((b) => b.id === 'x2')!.confidence).toBe('MISSING_SOURCE');
  });
  it('moteur injoignable : repli local explicite, ou erreur nette — jamais un cours silencieusement vide', async () => {
    const down = createRemoteProvider({ endpoint: 'https://moteur.invalide', getToken: async () => 'jwt', fetchImpl: (async () => { throw new TypeError('network'); }) as typeof fetch });
    const fb = await runCourseEngine(material(), { provider: down, fallbackToLocal: true });
    expect(fb.fellBack).toBe(true); expect(fb.providerId).toBe('local'); expect(fb.providerLabel).toMatch(/injoignable/);
    expect(blocksOf(fb.content.sections).length).toBeGreaterThan(5);
    await expect(runCourseEngine(material(), { provider: down })).rejects.toBeInstanceOf(EngineUnavailableError);
  });
  it('le moteur distant n’envoie que le plan et les connaissances (pas la transcription brute), avec le jeton — jamais de clé de modèle', async () => {
    let body: { input: { units: unknown[] } } | undefined; let auth = '';
    const p = createRemoteProvider({ endpoint: 'https://x', getToken: async () => 'jeton-utilisateur', fetchImpl: (async (_u: string, init: RequestInit) => { body = JSON.parse(String(init.body)); auth = String((init.headers as Record<string, string>).Authorization); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch });
    await p.compose!({ title: 'T', plan: [], units: [] });
    expect(auth).toBe('Bearer jeton-utilisateur');
    expect(JSON.stringify(body)).not.toMatch(/api[_-]?key|sk-/i);
  });
  it('SOURCES NON ÉCRASÉES : la génération ne modifie ni les notes, ni la transcription, ni les documents', async () => {
    const m = material(); const before = JSON.stringify(m);
    await runCourseEngine(m);
    expect(JSON.stringify(m)).toBe(before);
  });
  it('instantané des sources + versionnage : l’empreinte change quand une source change, pas sinon', async () => {
    const a = await runCourseEngine(material()); const b = await runCourseEngine(material());
    expect(a.snapshot.hash).toBe(b.snapshot.hash);
    expect(a.snapshot.sources.map((s) => s.kind)).toEqual(['NOTES', 'TRANSCRIPT', 'DOCUMENT']);
    expect(a.engineVersion).toBe(ENGINE_VERSION);
    const changed = material({ documents: [doc({ units: [{ index: 17, text: 'Autre contenu du support.' }] })] });
    expect(snapshotOf(buildSourceSet(changed).sources).hash).not.toBe(a.snapshot.hash);
    expect(a.content).toEqual(b.content); // déterministe : régénérer sans changement redonne le même cours
  });
  it('étapes du pipeline dans l’ordre, avec progression', async () => {
    const seen: Stage[] = [];
    await runCourseEngine(material(), { onProgress: (s) => { if (seen.at(-1) !== s) seen.push(s); } });
    expect(seen).toEqual([...STAGES]);
  });
  it('annulation', async () => {
    const ctl = new AbortController(); ctl.abort();
    await expect(runCourseEngine(material(), { signal: ctl.signal })).rejects.toThrow(/annulée/);
  });
  it('traitement incrémental : régénérer avec le cache ne ré-analyse rien', async () => {
    const cache = new MemoryAnalysisCache();
    const first = await runCourseEngine(material(), { cache }); const second = await runCourseEngine(material(), { cache });
    expect(first.stats.analyzed).toBeGreaterThan(0); expect(second.stats.analyzed).toBe(0); expect(second.stats.cacheHits).toBe(first.stats.analyzed);
  });
  it('séance de 3 h : cours produit en quelques secondes, blocs bornés', async () => {
    const segs = Array.from({ length: 2700 }, (_, i) => seg(`s${i}`, i * 4000, `Le professeur explique la notion ${i} : définition numéro ${i} du contrat, point ${i * 7}.`));
    const t0 = performance.now();
    const run = await runCourseEngine(material({ segments: segs, markers: [], anchors: [], documents: [] }));
    expect(performance.now() - t0).toBeLessThan(20_000);
    expect(run.content.stats.chunks).toBeGreaterThan(100);
    expect(blocksOf(run.content.sections).every((b) => b.refs.length > 0)).toBe(true);
  });
});

void LB;
