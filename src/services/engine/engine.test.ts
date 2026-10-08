import { describe, expect, it } from 'vitest';
import { H, LB, P, doc, material, seg } from '@/test/engineFixtures';
import { buildSourceSet, chunkDocument, chunkNotes, chunkTranscript } from './chunking';
import { CourseContextBuilder, MemoryAnalysisCache } from './context';
import { RuleBasedAnalyzer } from './analyzer';
import { dedupeChunks, cleanExtraction } from './normalize';
import { buildChunkIndex } from './sourceIndex';

describe('chunking et provenance des emplacements', () => {
  it('notes : un morceau par bloc juridique, chemin des titres, ancrage relié à la transcription', () => {
    const c = chunkNotes(material());
    const dol = c.find((x) => x.text.startsWith('Dol :'))!;
    expect(dol.kind).toBe('NOTES');
    expect(dol.location.headingPath).toEqual(['Formation du contrat', 'Consentement', 'Dol']);
    expect(dol.blockKind).toBe('definition');
    expect(dol.location.anchorId).toBe('a1');
    expect(dol.linkedSegmentIds).toEqual(['g2']);
    expect(c.filter((x) => x.blockKind === 'article')).toHaveLength(1);
  });
  it('transcription : plage temporelle, segments, marqueurs, qualité', () => {
    const [t] = chunkTranscript(material());
    expect(t!.location).toMatchObject({ kind: 'TRANSCRIPT', startMs: 0, endMs: 14000, segmentIds: ['g1', 'g2', 'g3'], markerIds: ['m1'] });
    expect(t!.quality).toBeCloseTo(0.9);
  });
  it('transcription longue : fenêtres bornées (jamais un bloc de 3 h)', () => {
    const segs = Array.from({ length: 2700 }, (_, i) => seg(`s${i}`, i * 4000, `Phrase numéro ${i} du cours sur le consentement et la capacité des parties.`));
    const cs = chunkTranscript(material({ segments: segs }));
    expect(cs.length).toBeGreaterThan(100);
    expect(Math.max(...cs.map((c) => c.text.length))).toBeLessThan(1100);
    expect(Math.max(...cs.map((c) => (c.location.endMs ?? 0) - (c.location.startMs ?? 0)))).toBeLessThanOrEqual(130_000);
  });
  it('documents : page / slide / section dans l’emplacement', () => {
    const pdf = chunkDocument(doc({ id: 'd1', name: 'cours.pdf', units: [{ index: 18, text: 'Texte page dix-huit.' }] }));
    expect(pdf[0]!.location).toMatchObject({ kind: 'DOCUMENT', documentId: 'd1', documentName: 'cours.pdf', page: 18 });
    const ppt = chunkDocument(doc({ id: 'd2', unitLabel: 'slide', units: [{ index: 24, title: 'Le dol', text: 'Manœuvres' }] }));
    expect(ppt[0]!.location).toMatchObject({ slide: 24, headingPath: ['Le dol'] });
    expect(ppt[0]!.text.startsWith('Le dol')).toBe(true);
  });
  it('documents non prêts : aucun morceau', () => { expect(chunkDocument(doc({ status: 'error', extraction: null }))).toEqual([]); });
  it('identifiants stables d’une génération à l’autre ; sources avec empreinte', () => {
    const a = buildSourceSet(material()), b = buildSourceSet(material());
    expect(a.chunks.map((c) => c.id)).toEqual(b.chunks.map((c) => c.id));
    expect(a.sources.map((s) => s.kind)).toEqual(['NOTES', 'TRANSCRIPT', 'DOCUMENT']);
    expect(a.sources[0]!.hash).toBe(b.sources[0]!.hash);
  });
});

describe('normalisation et déduplication', () => {
  it('retire en-têtes / pieds de page répétés et numéros de page', () => {
    const units = [1, 2, 3, 4].map((i) => ({ index: i, text: `Université de Droit — Cours 2026\nContenu de la page ${i} sur le dol.\nPage ${i}/4` }));
    const c = cleanExtraction({ unitLabel: 'page', units, warnings: [] });
    expect(c.units[0]!.text).toBe('Contenu de la page 1 sur le dol.');
  });
  it('un même texte vu deux fois dans une source est fusionné (autre emplacement conservé) ; entre sources il est gardé (corroboration)', () => {
    const m = material({ documents: [doc({ units: [{ index: 1, text: 'Le dol est une manœuvre destinée à tromper.' }, { index: 2, text: 'Le dol est une manœuvre destinée à tromper.' }] })] });
    const { chunks, removed } = dedupeChunks(buildSourceSet(m).chunks);
    expect(removed).toBe(1);
    const d = chunks.find((c) => c.kind === 'DOCUMENT')!;
    expect(d.alsoIn?.[0]).toMatchObject({ page: 2 });
  });
});

describe('index (sélection du contexte)', () => {
  it('retrouve les morceaux pertinents sans parcourir toute la séance', () => {
    const idx = buildChunkIndex(buildSourceSet(material()).chunks);
    const hits = idx.search('manœuvres tromper cocontractant', { k: 3 });
    expect(hits.length).toBeGreaterThan(0);
    expect(idx.get(hits[0]!.id)!.text).toMatch(/manœuvres/);
    expect(idx.search('zzzxyz')).toEqual([]);
  });
  it('3 h de transcription (≈ 2 700 segments) : index + requête en moins d’une seconde', () => {
    const segs = Array.from({ length: 2700 }, (_, i) => seg(`s${i}`, i * 4000, `Segment ${i} : le consentement, la capacité, le contenu du contrat, thème ${i % 40}.`));
    const t0 = performance.now();
    const idx = buildChunkIndex(chunkTranscript(material({ segments: segs })));
    idx.search('capacité consentement thème 7', { k: 10 });
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe('analyse : connaissances extraites, jamais inventées', () => {
  const analyze = (text: string, extra: Record<string, unknown> = {}) => new RuleBasedAnalyzer().analyze({ id: 'c', sessionId: 's', sourceId: 'x', kind: 'NOTES', text, location: { kind: 'NOTES' }, hash: 'h', order: 0, tokens: 1, ...extra } as never, {});
  it('article, jurisprudence, date, chiffre, formule, auteur — littéralement', () => {
    const d = analyze('Selon le professeur Dupont, l’article 1128 du Code civil impose le consentement. Cass. civ. 3e, 15 janvier 2002, n° 99-12345. Le taux est de 5 %. VAN = Σ flux / (1+t)^n');
    const types = d.map((x) => x.type);
    expect(types).toEqual(expect.arrayContaining(['article', 'caselaw', 'date', 'figure', 'formula', 'author']));
    expect(d.find((x) => x.type === 'article')!.label).toBe('Art. 1128 du Code civil');
    expect(d.find((x) => x.type === 'author')!.label).toBe('Dupont');
    expect(d.find((x) => x.type === 'caselaw')!.label).toMatch(/^Cass\. civ\. 3e/);
  });
  it('NON-INVENTION : aucun numéro d’article / arrêt / date quand le texte n’en contient pas', () => {
    const d = analyze('Le dol vicie le consentement lorsque les manœuvres sont déterminantes.');
    expect(d.filter((x) => ['article', 'caselaw', 'date'].includes(x.type))).toEqual([]);
  });
  it('numéro d’article ≠ année', () => {
    expect(analyze('Voir art. 1132 et l’article 1137.').some((x) => x.type === 'date')).toBe(false);
  });
  it('chaque extrait est une sous-chaîne exacte du morceau', () => {
    const text = 'Art. 1137 : le dol. Par exemple, une fausse facture. Attention, ça tombe à l’examen. Peut-être faut-il vérifier.';
    for (const d of analyze(text)) expect(text).toContain(d.quote);
  });
  it('blocs typés, hésitations, passages incomplets, méthode orale', () => {
    expect(analyze('Je ne suis pas sûr de cela, peut-être 12 jours.').some((x) => x.type === 'ambiguity')).toBe(true);
    expect(analyze('Art.', { blockKind: 'article' }).some((x) => x.type === 'incomplete')).toBe(true);
    expect(analyze('Il faut d’abord qualifier, ensuite appliquer la règle, puis conclure.').some((x) => x.type === 'method_step')).toBe(true);
    expect(analyze('1. Faits\n2. Règle', { blockKind: 'step' }).some((x) => x.type === 'method_step')).toBe(true);
  });
});

describe('CourseContextBuilder : corroboration, conflits, incrémental', () => {
  const build = async (m = material(), cache = new MemoryAnalysisCache(), an = new RuleBasedAnalyzer()) => ({ ctx: await new CourseContextBuilder(an, cache).build(m), an, cache });

  it('un article présent dans les notes ET dans le PDF est « corroboré » avec les deux références', async () => {
    const { ctx } = await build();
    const art = ctx.units.find((u) => u.type === 'article' && u.refs[0]!.location.kind === 'NOTES')!;
    expect(art.confidence).toBe('VERIFIED');
    expect(art.refs.map((r) => r.location.kind)).toEqual(expect.arrayContaining(['NOTES', 'DOCUMENT']));
    expect(art.refs.find((r) => r.location.kind === 'DOCUMENT')!.location).toMatchObject({ page: 17, documentName: 'support.pdf' });
  });
  it('notes ↔ transcription reliées par l’ancrage', async () => {
    const { ctx } = await build();
    const def = ctx.units.find((u) => u.type === 'definition' && u.label === 'Dol' && u.refs[0]!.location.kind === 'NOTES')!;
    expect(def.refs.some((r) => r.location.kind === 'TRANSCRIPT')).toBe(true);
  });
  it('une définition unique reste « appuyée » (jamais présentée comme vérifiée)', async () => {
    const { ctx } = await build(material({ documents: [], segments: [], markers: [], anchors: [] }));
    const cap = ctx.units.find((u) => u.type === 'exam_point')!;
    expect(cap.confidence).toBe('SUPPORTED');
  });
  it('date dans les notes mais absente du PDF qui traite du même sujet → INCERTAIN, pas certaine', async () => {
    const m = material({
      notes: { type: 'doc', content: [H(1, 'Réforme'), P('La réforme du droit des contrats a été adoptée le 10 février 2016 par ordonnance.')] },
      documents: [doc({ units: [{ index: 3, text: 'La réforme du droit des contrats a été adoptée par ordonnance et modernise le Code civil.' }] })], segments: [], markers: [], anchors: [],
    });
    const { ctx } = await build(m);
    const d = ctx.units.find((u) => u.type === 'date')!;
    expect(d.confidence).toBe('UNCERTAIN');
    expect(d.note).toMatch(/n’apparaît pas dans support\.pdf/);
  });
  it('CONFLIT : deux sources donnent deux dates différentes → CONFLICTING des deux côtés + unité « contradiction »', async () => {
    const m = material({
      notes: { type: 'doc', content: [H(1, 'Réforme'), P('L’ordonnance portant réforme du droit des contrats date du 10 février 2016.')] },
      documents: [doc({ units: [{ index: 5, text: 'L’ordonnance portant réforme du droit des contrats date du 12 mars 2017.' }] })], segments: [], markers: [], anchors: [],
    });
    const { ctx } = await build(m);
    const dates = ctx.units.filter((u) => u.type === 'date');
    expect(dates.every((u) => u.confidence === 'CONFLICTING')).toBe(true);
    const c = ctx.units.find((u) => u.type === 'contradiction')!;
    expect(c.refs).toHaveLength(2);
    expect(c.text).toMatch(/10 février 2016/); expect(c.text).toMatch(/12 mars 2017/);
    expect(c.note).toMatch(/Aucune des deux valeurs/);
  });
  it('un article entendu uniquement à l’oral n’est pas présenté comme sûr', async () => {
    const m = material({ notes: { type: 'doc', content: [P('Cours.')] }, documents: [], anchors: [], markers: [], segments: [seg('g1', 0, 'Alors l’article 1128 exige le consentement des parties.')] });
    const { ctx } = await build(m);
    expect(ctx.units.find((u) => u.type === 'article')!.confidence).toBe('UNCERTAIN');
  });
  it('transcription peu fiable → zone ambiguë', async () => {
    const m = material({ segments: [seg('g1', 0, 'blabla incompréhensible sur la capacité', 0.3)], markers: [], anchors: [], documents: [] });
    expect((await build(m)).ctx.units.some((u) => u.type === 'ambiguity' && u.refs[0]!.location.kind === 'TRANSCRIPT')).toBe(true);
  });
  it('INCRÉMENTAL : relancer sans changement = 0 analyse ; modifier une note = 1 seule analyse', async () => {
    const cache = new MemoryAnalysisCache();
    const first = await build(material(), cache);
    expect(first.an.analyzed).toBeGreaterThan(5);
    const again = await build(material(), cache);
    expect(again.an.analyzed).toBe(0);
    expect(again.ctx.stats.cacheHits).toBe(first.ctx.stats.chunks);
    const changed = material({ notes: { type: 'doc', content: [
      H(1, 'Formation du contrat'), P('Le contrat se forme par la rencontre des volontés.'),
      H(2, 'Consentement'), P('Le consentement doit être libre, éclairé et DÉTERMINANT.'),
      H(3, 'Dol'), LB('definition', 'Dol : manœuvres destinées à tromper le cocontractant.'), LB('article', 'Art. 1137 : le dol est le fait d’obtenir le consentement par des manœuvres.'),
      LB('important', 'Le dol peut être commis par un tiers.'), H(3, 'Violence'), LB('definition', 'Violence : contrainte qui inspire la crainte d’un mal considérable.'),
      H(2, 'Capacité'), P('Toute personne peut contracter sauf incapacité.'),
    ] } });
    const third = await build(changed, cache);
    expect(third.an.analyzed).toBe(1);
  });
  it('séance longue (3 h de transcription) : contexte construit sans bloquer, unités rattachées à des morceaux', async () => {
    const segs = Array.from({ length: 2700 }, (_, i) => seg(`s${i}`, i * 4000, `Le professeur explique la notion ${i} : définition numéro ${i} du contrat, point ${i * 7}.`));
    const t0 = performance.now();
    const { ctx } = await build(material({ segments: segs, markers: [], anchors: [], documents: [] }));
    expect(performance.now() - t0).toBeLessThan(15_000);
    expect(ctx.chunks.length).toBeGreaterThan(100);
    expect(ctx.units.every((u) => u.refs.length > 0)).toBe(true);
  });
});
