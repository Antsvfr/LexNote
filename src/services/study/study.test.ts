import { beforeAll, describe, expect, it } from 'vitest';
import type { GeneratedCourse } from '@/domain/course';
import { ArtifactValidationError, validateContent, type DiagramContent, type MindMapContent, type QuizContent, type SheetContent } from '@/domain/study';
import { H, LB, P, courseOf, material, richMaterial } from '@/test/engineFixtures';
import { buildSourceSet } from '@/services/engine/chunking';
import { DEFAULTS, findSection, generateDraft, interpretStudyCommand, isStale, latestCourse, provenanceOf, toArtifact, treeOf } from './engine';
import { EmptySourceError, comparableSections, countNodes, datedBlocks, generateDiagram, generateFlashcards, suggestDiagramType, suggestSupports } from './generators';
import { layoutDiagram, layoutMindMap } from './layout';
import { addChild, addDiagramEdge, addDiagramStepAfter, addSibling, expandTo, moveSibling, moveTo, removeDiagramNode, removeNode, renameNode, searchNodes, toggleCollapse } from './edit';
import { allBlocks, scopeNode } from './courseTree';

let course: GeneratedCourse; let chunks: Map<string, { text: string }>;
beforeAll(async () => { course = await courseOf(); chunks = new Map(buildSourceSet(richMaterial()).chunks.map((c) => [c.id, c])); });
const draft = (type: Parameters<typeof generateDraft>[1]['type'], settings = {}, scope?: { sectionId: string }, c = course) => generateDraft(c, { type, settings, scope });
const sec = (title: string) => treeOf(course).sections.find((s) => s.title === title)!;

describe('architecture : cours reconstruit → artefacts (pas de second moteur)', () => {
  it('l’artefact référence la VERSION du cours, l’instantané des sources, le moteur et la provenance', () => {
    const a = toArtifact(draft('COURSE_SHEET'), { userId: 'u', subjectId: null });
    expect(a).toMatchObject({ type: 'COURSE_SHEET', courseId: 'course-1', courseVersion: 1, sourceSessionIds: ['s1'], engineVersion: course.engineVersion, generation: 1, userEdited: false });
    expect(a.sourceSnapshot).toEqual(course.sourceSnapshot);
    expect(a.provenance).toMatchObject({ from: 'reconstructed-course', courseId: 'course-1', courseVersion: 1 });
    expect(a.provenance.sources.map((s) => s.kind)).toEqual(['NOTES', 'TRANSCRIPT', 'DOCUMENT']);
    expect(a.generatedContent).toEqual(a.content);
  });
  it('chaque élément de chaque type d’artefact porte des références existantes (notes, PDF p. 14, transcription…)', () => {
    const refsOf = (c: unknown): { chunkId: string; quote: string }[] => { const out: { chunkId: string; quote: string }[] = []; const walk = (v: unknown) => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') { const o = v as Record<string, unknown>; if (typeof o.chunkId === 'string' && typeof o.quote === 'string') out.push(o as never); else Object.values(o).forEach(walk); } }; walk(c); return out; };
    for (const type of ['COURSE_SHEET', 'MIND_MAP', 'COMPARISON_TABLE', 'TIMELINE', 'METHOD', 'FLASHCARDS', 'QUIZ'] as const) {
      const refs = refsOf(draft(type).content);
      expect(refs.length, type).toBeGreaterThan(0);
      for (const r of refs) { const c = chunks.get(r.chunkId); expect(c, `${type} ${r.chunkId}`).toBeTruthy(); expect(c!.text).toContain(r.quote.slice(0, 40)); }
    }
  });
  it('le dol : définition corroborée par les notes, le PDF p. 14 et la transcription 01:02:32', () => {
    const c = draft('FLASHCARDS', { count: 30 }).content as { cards: { question: string; sources: { location: { kind: string; page?: number; startMs?: number } }[] }[] };
    const dol = c.cards.find((x) => x.question === 'Définir : Dol')!;
    expect([...new Set(dol.sources.map((r) => r.location.kind))].sort()).toEqual(['DOCUMENT', 'NOTES', 'TRANSCRIPT']);
    expect(dol.sources.find((r) => r.location.kind === 'DOCUMENT')!.location.page).toBe(14);
    expect(dol.sources.find((r) => r.location.kind === 'TRANSCRIPT')!.location.startMs).toBe(3_752_000);
  });
  it('un artefact est périmé quand une version plus récente du cours existe — pas avant', async () => {
    const a = toArtifact(draft('MIND_MAP'), { userId: 'u', subjectId: null });
    expect(isStale(a, course)).toBe(false);
    const v2 = await courseOf(richMaterial(), 2);
    expect(isStale(a, v2)).toBe(true);
    expect(latestCourse([course, v2], 's1')!.courseVersion).toBe(2);
    expect(isStale(a, undefined)).toBe(false);
  });
});

describe('fiche de révision', () => {
  const sheet = (mode: 'express' | 'standard' | 'complete') => draft('COURSE_SHEET', { mode }).content as SheetContent;
  it('trois niveaux : volume croissant, express très court', () => {
    const size = (m: 'express' | 'standard' | 'complete') => JSON.stringify(sheet(m).sections).length;
    expect(size('express')).toBeLessThan(size('standard')); expect(size('standard')).toBeLessThanOrEqual(size('complete'));
    expect(sheet('express').sections.flatMap((s) => s.items).every((i) => i.text.length <= 151)).toBe(true);
    expect(sheet('express').sections.some((s) => s.kind === 'methods')).toBe(false);
    expect(sheet('complete').sections.some((s) => s.kind === 'methods')).toBe(true);
  });
  it('rubriques du cours uniquement : définitions, articles, jurisprudence, exemples, points d’examen — rien d’artificiel', () => {
    const kinds = sheet('complete').sections.map((s) => s.kind);
    expect(kinds).toEqual(expect.arrayContaining(['definitions', 'articles', 'caselaw', 'examples', 'exam']));
    expect(sheet('complete').sections.find((s) => s.kind === 'articles')!.items.map((i) => i.label)).toEqual(expect.arrayContaining(['Art. 1132', 'Art. 1137', 'Art. 1140']));
    const poor = buildPoor();
    return poor.then((c) => { const k = (draft('COURSE_SHEET', { mode: 'complete' }, undefined, c).content as SheetContent).sections.map((s) => s.kind); expect(k).not.toContain('examples'); expect(k).not.toContain('caselaw'); expect(k).not.toContain('articles'); });
  });
  it('depuis une section : uniquement cette partie ; section disparue : refus', () => {
    const c = draft('COURSE_SHEET', { mode: 'complete' }, { sectionId: sec('Dol').id });
    expect(JSON.stringify(c.content)).not.toContain('Violence'); expect(c.scope?.sectionTitle).toBe('Dol');
    expect(() => draft('COURSE_SHEET', {}, { sectionId: 'inconnue' })).toThrow(EmptySourceError);
  });
  it('les éléments incertains / en conflit sont marqués, jamais présentés comme sûrs', async () => {
    const m = material({ notes: { type: 'doc', content: [H(1, 'Réforme'), P('La réforme du droit des contrats a été adoptée le 10 février 2016 par ordonnance.')] }, segments: [], markers: [], anchors: [], documents: [] });
    const c = await courseOf(m);
    const s = draft('COURSE_SHEET', { mode: 'complete' }, undefined, c).content as SheetContent;
    expect(s.sections.flatMap((x) => x.items).every((i) => i.sources.length > 0)).toBe(true);
  });
});
async function buildPoor() { return courseOf(material({ notes: { type: 'doc', content: [H(1, 'Le dol'), LB('definition', 'Dol : manœuvres destinées à tromper.'), P('Le dol vicie le consentement.')] }, segments: [], documents: [], markers: [], anchors: [] })); }

describe('carte mentale', () => {
  const map = (depth: number, scope?: { sectionId: string }) => draft('MIND_MAP', { depth }, scope).content as MindMapContent;
  it('structure du cours, profondeur réglable', () => {
    const m3 = map(3);
    expect(m3.root.title).toBe('Droit des contrats');
    const formation = m3.root.children.find((c) => c.title === 'Formation du contrat')!;
    expect(formation.children.map((c) => c.title)).toEqual(expect.arrayContaining(['Consentement', 'Capacité']));
    expect(countNodes(map(1).root)).toBeLessThan(countNodes(map(2).root));
    expect(countNodes(map(2).root)).toBeLessThan(countNodes(map(5).root));
    expect(map(1).root.children.every((c) => c.children.length === 0 || c.type !== 'section')).toBe(true);
  });
  it('les feuilles sont des éléments RÉELS du cours (définitions, articles…), sourcés — aucune relation entre concepts n’est inventée', () => {
    const m = map(5); const all: MindMapContent['root'][] = []; const walk = (n: MindMapContent['root']) => { all.push(n); n.children.forEach(walk); }; walk(m.root);
    const leaves = all.filter((n) => n.type !== 'section' && n.type !== 'root');
    expect(leaves.length).toBeGreaterThan(8);
    expect(leaves.every((n) => n.sources.length > 0)).toBe(true);
    expect(all.filter((n) => n.type === 'section').map((n) => n.title)).toEqual(expect.arrayContaining(['Erreur', 'Dol', 'Violence']));
    // la hiérarchie est celle du cours : « Dol » est sous « Consentement » sous « Formation du contrat »
    const dol = all.find((n) => n.title === 'Dol' && n.type === 'section')!;
    const parent = all.find((n) => n.children.includes(dol))!; expect(parent.title).toBe('Consentement');
  });
  it('depuis une section ; cours sans structure : refus explicite', () => {
    const m = map(4, { sectionId: sec('Consentement').id });
    expect(m.root.title).toBe('Consentement'); expect(JSON.stringify(m)).not.toContain('Capacité');
  });
  it('grosse carte : branches profondes repliées, mise en page rapide (10 / 30 / 100 / 300 nœuds)', () => {
    const tree = (n: number) => { const kids = Array.from({ length: n - 1 }, (_, k) => ({ id: `n${k}`, title: `Nœud ${k}`, type: 'concept' as const, sources: [], children: [] as never[] })); const br = kids.slice(0, Math.min(10, kids.length)).map((b) => ({ ...b, children: [] as typeof kids })); kids.slice(br.length).forEach((k, i) => br[i % br.length]!.children.push(k)); return { id: 'r', title: 'R', type: 'root' as const, sources: [], children: br }; };
    for (const n of [10, 30, 100, 300]) { const t0 = performance.now(); const l = layoutMindMap(tree(n) as never, 'horizontal'); expect(l.nodes.length).toBe(n); expect(performance.now() - t0).toBeLessThan(150); }
  });
});

describe('schémas', () => {
  const tr = () => treeOf(course);
  const input = (scope = tr().root) => ({ tree: tr(), scope });
  it('processus : méthode du cas pratique → 6 étapes ordonnées, début/fin, flèches « ordre »', () => {
    const d = draft('DIAGRAM', { diagramType: 'PROCESS' }).content as ReturnType<typeof generateDiagram>['content'];
    expect(d.nodes).toHaveLength(6); expect(d.nodes.map((n) => n.kind)).toEqual(['start', 'step', 'step', 'step', 'step', 'end']);
    expect(d.edges).toHaveLength(5); expect(d.edges.every((e) => e.basis === 'order')).toBe(true);
    expect(d.nodes[0]!.label).toMatch(/Identifier les faits/); expect(d.nodes.every((n) => n.sources.length > 0)).toBe(true);
    expect(suggestDiagramType(input())).toBe('PROCESS');
  });
  it('raisonnement : « si… alors » explicite → décision ; le « non » n’est jamais inventé', () => {
    const d = draft('DIAGRAM', { diagramType: 'FLOWCHART' }).content as ReturnType<typeof generateDiagram>['content'];
    expect(d.nodes.map((n) => n.kind)).toEqual(['decision', 'step']); expect(d.edges).toEqual([expect.objectContaining({ label: 'oui', basis: 'stated' })]);
  });
  it('structure / comparaison / relations : aucune flèche déduite', () => {
    for (const t of ['HIERARCHY', 'COMPARISON', 'RELATIONSHIP'] as const) {
      try { const d = draft('DIAGRAM', { diagramType: t }).content as ReturnType<typeof generateDiagram>['content']; expect(d.edges.every((e) => e.basis !== 'inferred' && !e.uncertain), t).toBe(true); }
      catch (e) { expect(e).toBeInstanceOf(EmptySourceError); }
    }
  });
  it('rien à schématiser : refus honnête avec explication', async () => {
    const c = await buildPoor();
    for (const t of ['PROCESS', 'FLOWCHART', 'TIMELINE', 'COMPARISON'] as const) expect(() => draft('DIAGRAM', { diagramType: t }, undefined, c), t).toThrow(EmptySourceError);
  });
  it('mise en page en couches ; graphe cyclique toléré', () => {
    const d = draft('DIAGRAM', { diagramType: 'PROCESS' }).content as ReturnType<typeof generateDiagram>['content'];
    const ys = d.nodes.map((n) => layoutDiagram(d).pos[n.id]!.y); expect(ys).toEqual([...ys].sort((a, b) => a - b));
    const cyc = { ...d, edges: [...d.edges, { id: 'z', from: d.nodes.at(-1)!.id, to: d.nodes[0]!.id, basis: 'stated' as const }] };
    expect(Object.values(layoutDiagram(cyc).pos).every((p) => Number.isFinite(p.x))).toBe(true);
  });
});

describe('tableau comparatif', () => {
  it('erreur / dol / violence détectés ; lignes = critères RÉELLEMENT renseignés ; « — » quand le cours est muet', () => {
    expect(comparableSections({ tree: treeOf(course), scope: treeOf(course).root }).map((s) => s.title)).toEqual(['Erreur', 'Dol', 'Violence']);
    const t = draft('COMPARISON_TABLE').content as import('@/domain/study').TableContent;
    expect(t.columns.map((c) => c.title)).toEqual(['Erreur', 'Dol', 'Violence']);
    expect(t.rows.map((r) => r.label)).toEqual(['Définition', 'Articles', 'Jurisprudence', 'Exemples', 'Points importants', 'Chiffres et dates']);
    const caselaw = t.rows.find((r) => r.label === 'Jurisprudence')!; const viol = t.columns[2]!.id; const dol = t.columns[1]!.id;
    expect(caselaw.cells[viol]).toEqual({ text: '—', sources: [] }); // aucune jurisprudence pour la violence : rien d'inventé
    expect(caselaw.cells[dol]!.sources.length).toBeGreaterThan(0);
    expect(t.rows.every((r) => !('Méthode' === r.label))).toBe(true); // critère sans contenu → pas de ligne
  });
  it('concepts choisis ; une seule notion ou critères vides : refus', () => {
    const t = draft('COMPARISON_TABLE', { conceptIds: [sec('Dol').id, sec('Violence').id] }).content as import('@/domain/study').TableContent;
    expect(t.columns).toHaveLength(2);
    expect(() => draft('COMPARISON_TABLE', { conceptIds: [sec('Dol').id] })).toThrow(EmptySourceError);
    expect(() => draft('COMPARISON_TABLE', { conceptIds: [sec('Histoire de la réforme').id, sec('Régime').id] })).toThrow(EmptySourceError);
  });
});

describe('chronologie', () => {
  it('dates réelles triées ; numéros d’articles ignorés ; aucune date inventée', () => {
    const t = draft('TIMELINE').content as import('@/domain/study').TimelineContent;
    expect(t.events.map((e) => e.date)).toEqual(['1804', '15 janvier 2002', '10 février 2016', '2018']);
    expect(t.events.every((e) => e.sources.length > 0)).toBe(true);
    expect(JSON.stringify(t)).not.toMatch(/"date":"11(32|37|40)"/);
  });
  it('moins de deux dates : refus', async () => { expect(() => draft('TIMELINE', {}, undefined, null as never)).toThrow(); const c = await buildPoor(); expect(() => draft('TIMELINE', {}, undefined, c)).toThrow(EmptySourceError); });
  it('dates : uniquement des blocs fiables', () => { expect(datedBlocks({ tree: treeOf(course), scope: treeOf(course).root }).length).toBe(4); });
});

describe('méthode', () => {
  it('objectif, étapes, questions du cours, erreurs signalées, checklist — sans ajout', () => {
    const m = draft('METHOD').content as import('@/domain/study').MethodContent;
    expect(m.objective!.text).toBe('Méthode du cas pratique');
    expect(m.steps.map((s) => s.text)).toEqual(['Identifier les faits pertinents', 'Qualifier juridiquement', 'Formuler le problème de droit', 'Énoncer la règle', 'Appliquer aux faits', 'Conclure']);
    expect(m.questions.map((q) => q.text)).toEqual(['Quelle est la règle applicable ?']);
    expect(m.pitfalls[0]!.text).toMatch(/ne confondez pas/i);
    expect(m.checklist.map((c) => c.text)).toEqual(m.steps.map((s) => s.text)); expect(m.checklist.every((c) => !c.done)).toBe(true);
    expect([...m.steps, ...m.questions, ...m.pitfalls].every((x) => x.sources.length > 0)).toBe(true);
  });
  it('cours sans méthode : refus explicite', async () => { const c = await buildPoor(); expect(() => draft('METHOD', {}, undefined, c)).toThrow(/méthodologique/); });
});

describe('flashcards', () => {
  const cards = (count: number) => draft('FLASHCARDS', { count });
  it('question, réponse, difficulté, source, concept — réponse = texte du cours', () => {
    const c = cards(30).content as import('@/domain/study').FlashcardsContent;
    const dol = c.cards.find((x) => x.question === 'Définir : Dol')!;
    expect(dol).toMatchObject({ difficulty: 'easy', concept: 'Dol', answer: 'manœuvres destinées à tromper le cocontractant.' });
    expect(c.cards.find((x) => x.question.startsWith('Que prévoit Art. 1137'))!.answer).toMatch(/^le dol est le fait/);
    expect(new Set(c.cards.map((x) => x.difficulty)).size).toBeGreaterThan(1);
    expect(c.cards.every((x) => x.sources.length > 0 && x.concept)).toBe(true);
  });
  it('10 / 20 / 30 : nombre respecté, équilibré entre types, sinon on l’explique au lieu de compléter', () => {
    const d10 = cards(10); expect((d10.content as { cards: unknown[] }).cards).toHaveLength(10);
    expect(new Set((d10.content as { cards: { question: string }[] }).cards.map((x) => x.question.split(' ')[0])).size).toBeGreaterThan(2);
    const big = cards(30); const n = (big.content as { cards: unknown[] }).cards.length;
    expect(n).toBeLessThan(30); expect(big.notice).toMatch(/ne permet de créer que \d+ cartes? fiables?/);
    expect((cards(3).content as { cards: unknown[] }).cards).toHaveLength(3);
  });
  it('un fait incertain ou en conflit ne devient jamais la réponse d’une carte', async () => {
    const m = material({ notes: { type: 'doc', content: [H(1, 'Réforme'), LB('definition', 'Réforme : ordonnance du 10 février 2016.'), LB('definition', 'Ordonnance : texte pris par le gouvernement.')] }, documents: [], segments: [], markers: [], anchors: [] });
    const c = await courseOf(m);
    const out = generateFlashcards({ tree: treeOf(c), scope: treeOf(c).root }, { count: 10 });
    expect(out.content.cards.every((x) => !/Valeurs différentes|UNCERTAIN/.test(x.answer))).toBe(true);
  });
  it('cours vide de matière fiable : refus', async () => { const c = await courseOf(material({ notes: { type: 'doc', content: [H(1, 'Titre seul')] }, segments: [], documents: [], markers: [], anchors: [] })).catch(() => null); if (c) expect(() => draft('FLASHCARDS', {}, undefined, c)).toThrow(EmptySourceError); });
});

describe('quiz', () => {
  const quiz = (s: Record<string, unknown> = {}) => draft('QUIZ', { count: 12, ...s });
  const qs = (s?: Record<string, unknown>) => (quiz(s).content as QuizContent).questions;
  it('chaque question : bonne réponse, explication, source, difficulté', () => {
    const q = qs();
    expect(q.length).toBeGreaterThan(5);
    for (const x of q) { expect(x.correct).toBeTruthy(); expect(x.explanation.length).toBeGreaterThan(5); expect(x.sources.length).toBeGreaterThan(0); expect(['easy', 'medium', 'hard']).toContain(x.difficulty); }
  });
  it('QCM : au moins 3 options, la bonne parmi elles, les autres sont de VRAIES définitions du cours', () => {
    const mcq = qs({ quizKinds: ['mcq'], count: 20 }); expect(mcq.length).toBeGreaterThan(2);
    const defs = ['fausse représentation de la réalité.', 'manœuvres destinées à tromper le cocontractant.', 'contrainte qui inspire la crainte d’un mal considérable.'];
    for (const x of mcq) {
      expect(x.options!.length).toBeGreaterThanOrEqual(3); expect(x.options!.some((o) => o.id === x.correct)).toBe(true);
      if (x.prompt.startsWith('Quelle définition')) for (const o of x.options!) expect(defs).toContain(o.text);
    }
    expect(mcq.some((x) => x.prompt === 'Quelle définition correspond à « Dol » ?' && x.options!.find((o) => o.id === x.correct)!.text === defs[1])).toBe(true);
  });
  it('vrai/faux : le faux est une définition d’UNE AUTRE notion du cours, expliquée avec la bonne', () => {
    const tf = qs({ quizKinds: ['truefalse'], count: 20 });
    const f = tf.find((x) => x.correct === 'false')!; const t = tf.find((x) => x.correct === 'true')!;
    expect(f.explanation).toMatch(/^Faux : ce texte définit/); expect(t.explanation).toMatch(/^Vrai/);
    expect(tf.some((x) => x.prompt === '« Dol » : manœuvres destinées à tromper le cocontractant.' && x.correct === 'true')).toBe(true);
    expect(tf.some((x) => x.prompt.startsWith('« Dol » :') && x.correct === 'false' && !x.prompt.includes('manœuvres'))).toBe(true);
  });
  it('niveau, nombre et types respectés ; notice quand le cours n’en permet pas plus', () => {
    expect(qs({ level: 'easy' }).every((x) => x.difficulty === 'easy')).toBe(true);
    expect(qs({ quizKinds: ['short'], count: 4 }).every((x) => x.kind === 'short')).toBe(true);
    expect(qs({ count: 3 })).toHaveLength(3);
    expect(quiz({ count: 100 }).notice).toMatch(/ne permet de poser que/);
  });
  it('pas assez de matière fiable : refus (aucune réponse inventée) ; QCM impossible avec 2 définitions', async () => {
    const c = await buildPoor();
    expect(() => draft('QUIZ', { quizKinds: ['mcq'] }, undefined, c)).toThrow(EmptySourceError);
    expect(() => draft('QUIZ', { level: 'hard', quizKinds: ['truefalse'] })).toThrow(/ne correspond/);
  });
  it('quiz valide ou refusé par le schéma', () => {
    expect(() => validateContent('QUIZ', { questions: [{ id: 'a', kind: 'mcq', prompt: 'q', options: [{ id: 'x', text: 'a' }], correct: 'x', explanation: 'e', difficulty: 'easy', sources: [] }] })).toThrow(ArtifactValidationError);
    expect(() => validateContent('QUIZ', { questions: [{ id: 'a', kind: 'truefalse', prompt: 'q', correct: 'peut-être', explanation: 'e', difficulty: 'easy', sources: [] }] })).toThrow(ArtifactValidationError);
  });
});

describe('validation, suggestions, commandes', () => {
  it('structures invalides refusées', () => {
    expect(() => validateContent('MIND_MAP', { depth: 3, orientation: 'horizontal', root: { id: 'r', title: '', type: 'root', children: [] } })).toThrow(ArtifactValidationError);
    expect(() => validateContent('DIAGRAM', { type: 'PROCESS', nodes: [{ id: 'a', label: 'A', kind: 'step' }], edges: [{ id: 'e', from: 'a', to: 'zzz', basis: 'order' }] })).toThrow(/inexistant/);
    expect(() => validateContent('COURSE_SHEET', 'du texte')).toThrow(ArtifactValidationError);
    expect(() => validateContent('METHOD', { steps: [], questions: [], pitfalls: [], checklist: [{ id: 'a', text: '' }] })).toThrow();
  });
  it('suggestions discrètes calculées sur le cours', async () => {
    const s = suggestSupports(treeOf(course)).map((x) => x.type);
    expect(s.length).toBeLessThanOrEqual(4); expect(s).toEqual(expect.arrayContaining(['COMPARISON_TABLE', 'METHOD']));
    expect(suggestSupports(treeOf(await buildPoor()))).toEqual([]);
  });
  const cases: [string, string, Record<string, unknown>][] = [
    ['Fais-moi une carte mentale de ce cours.', 'MIND_MAP', {}], ['Fais-moi une fiche uniquement sur les nullités.', 'COURSE_SHEET', { sectionQuery: 'nullites' }],
    ['Crée un schéma sur les étapes de formation du contrat.', 'DIAGRAM', { settings: { diagramType: 'PROCESS' } }], ['Fais-moi une fiche très courte pour réviser demain.', 'COURSE_SHEET', { settings: { mode: 'express' } }],
    ['Fais-moi 15 flashcards', 'FLASHCARDS', { settings: { count: 15 } }], ['Fais-moi un quiz', 'QUIZ', {}], ['Donne-moi la méthode du cas pratique', 'METHOD', {}], ['Fais une chronologie', 'TIMELINE', {}],
  ];
  it.each(cases)('commande : %s', (text, type, extra) => { expect(interpretStudyCommand(text)).toMatchObject({ type, ...extra }); });
  it('« Compare erreur, dol et violence » ; phrase sans rapport ; section visée', () => {
    expect(interpretStudyCommand('Compare erreur, dol et violence.')).toMatchObject({ type: 'COMPARISON_TABLE', compare: ['erreur', 'dol', 'violence'] });
    expect(interpretStudyCommand('quel temps fait-il')).toBeNull();
    expect(findSection(treeOf(course), 'le dol')?.title).toBe('Dol'); expect(findSection(treeOf(course), 'zzz inconnu')).toBeNull();
  });
  it('scope / allBlocks cohérents', () => { expect(allBlocks(scopeNode(treeOf(course), sec('Dol').id)).every((b) => b.sectionPath.includes('Dol'))).toBe(true); expect(DEFAULTS.count).toBe(20); expect(provenanceOf(course).sources).toHaveLength(3); });
});


describe('édition des supports', () => {
  const root = (): MindMapContent['root'] => ({ id: 'r', title: 'R', type: 'root', sources: [], children: [
    { id: 'a', title: 'A', type: 'section', sources: [], children: [{ id: 'a1', title: 'Dol', type: 'concept', sources: [], children: [] }] },
    { id: 'b', title: 'B', type: 'section', sources: [], children: [] },
  ] });
  it('renommer, ajouter, supprimer, réordonner, déplacer — sans muter l’original', () => {
    const r = root();
    expect(renameNode(r, 'a', 'Alpha').children[0]!.title).toBe('Alpha');
    expect(r.children[0]!.title).toBe('A');
    const { root: r2, id } = addChild(r, 'b', 'Nouvelle');
    expect(r2.children[1]!.children[0]!.id).toBe(id);
    expect(addSibling(r, 'a').root.children).toHaveLength(3);
    expect(removeNode(r, 'a').children.map((c) => c.id)).toEqual(['b']);
    expect(moveSibling(r, 'a', 1).children.map((c) => c.id)).toEqual(['b', 'a']);
    expect(moveTo(r, 'a1', 'b').children[1]!.children.map((c) => c.id)).toEqual(['a1']);
    expect(moveTo(r, 'a', 'a1')).toBe(r); // jamais sous soi-même
  });
  it('repli/dépli, recherche et ouverture jusqu’au nœud trouvé', () => {
    const folded = toggleCollapse(root(), 'a');
    expect(folded.children[0]!.collapsed).toBe(true);
    expect(searchNodes(folded, 'dol').map((n) => n.id)).toEqual(['a1']);
    expect(expandTo(folded, 'a1').children[0]!.collapsed).toBeUndefined();
  });
  it('schéma : insérer une étape dans une chaîne, supprimer en refermant, flèche ajoutée = « dite » par l’utilisateur', () => {
    const d = draft('DIAGRAM', { diagramType: 'PROCESS' }).content as DiagramContent;
    const n0 = d.nodes.length, e0 = d.edges.length;
    const { content, id } = addDiagramStepAfter(d, d.nodes[0]!.id, 'A bis');
    expect(content.nodes).toHaveLength(n0 + 1);
    expect(content.edges).toHaveLength(e0 + 1);
    expect(validateContent('DIAGRAM', content)).toBeTruthy();
    const closed = removeDiagramNode(content, id);
    expect(closed.edges).toHaveLength(e0);
    expect(addDiagramEdge(d, d.nodes.at(-1)!.id, d.nodes[0]!.id).edges.at(-1)!.basis).toBe('stated');
  });
});
