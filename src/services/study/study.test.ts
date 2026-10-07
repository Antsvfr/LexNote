import { describe, expect, it } from 'vitest';
import { buildOutline, scopeSection } from './outline';
import { findSection, generateDraft, guardAiContent, interpretStudyCommand, isStale, setStudyProvider, toArtifact } from './engine';
import { EmptySourceError, comparableSections, countNodes, generateComparison, generateDiagram, generateMindMap, suggestDiagramType, suggestSupports } from './generators';
import { validateContent, ArtifactValidationError, type MindMapContent, type SheetContent } from '@/domain/study';
import { layoutMindMap, layoutDiagram } from './layout';

const t = (text: string) => ({ type: 'text', text });
const p = (text: string) => ({ type: 'paragraph', content: [t(text)] });
const h = (level: number, text: string) => ({ type: 'heading', attrs: { level }, content: [t(text)] });
const lb = (kind: string, text: string) => ({ type: 'legalBlock', attrs: { kind }, content: [p(text)] });
const ol = (...items: string[]) => ({ type: 'orderedList', content: items.map((x) => ({ type: 'listItem', content: [p(x)] })) });

/** Cours de droit réaliste. Aucune « exception », aucune date, aucune condition « si… alors ». */
const DROIT = { type: 'doc', content: [
  h(1, 'Formation du contrat'), p('Le contrat se forme par la rencontre des volontés.'),
  h(2, 'Consentement'), p('Le consentement doit être libre et éclairé.'),
  h(3, 'Erreur'), lb('definition', 'Erreur : fausse représentation de la réalité.'), lb('article', 'Art. 1132 : l’erreur de droit ou de fait est une cause de nullité.'),
  h(3, 'Dol'), lb('definition', 'Dol : manœuvres destinées à tromper le cocontractant.'), lb('article', 'Art. 1137 : le dol est le fait pour un contractant d’obtenir le consentement par des manœuvres.'), lb('caselaw', 'Cass. civ. 3e, 15 janvier 2002 : réticence dolosive.'),
  h(3, 'Violence'), lb('definition', 'Violence : contrainte qui inspire la crainte d’un mal considérable.'),
  h(2, 'Capacité'), p('Toute personne peut contracter sauf incapacité.'), lb('important', 'Les mineurs non émancipés sont incapables.'),
] };
const out = () => buildOutline('s1', 'Droit des contrats', DROIT);
const sheet = async (mode: 'express' | 'standard' | 'complete') => (await generateDraft(out(), { type: 'COURSE_SHEET', options: { mode } })).content as SheetContent;

describe('plan du cours (outline)', () => {
  it('reconstruit la hiérarchie et les blocs juridiques', () => {
    const o = out();
    expect(o.sections.map((s) => s.title)).toEqual(['Formation du contrat', 'Consentement', 'Erreur', 'Dol', 'Violence', 'Capacité']);
    const dol = o.sections.find((s) => s.title === 'Dol')!;
    expect(dol.path).toEqual(['Formation du contrat', 'Consentement', 'Dol']);
    expect(dol.blocks.map((b) => b.kind)).toEqual(['definition', 'article', 'caselaw']);
  });
  it('document vide ou invalide : plan vide, sans erreur', () => {
    expect(buildOutline('x', 'T', null).sections).toEqual([]);
    expect(buildOutline('x', 'T', { type: 'doc' }).wordCount).toBe(0);
  });
});

describe('fiche de cours', () => {
  it('structure juridique : définitions, articles, jurisprudences — seulement ce qui existe', async () => {
    const c = await sheet('standard');
    expect(c.sections.map((s) => s.kind)).toEqual(['plan', 'definitions', 'articles', 'caselaw', 'exam', 'concepts']);
    expect(c.sections.find((s) => s.kind === 'articles')!.items).toHaveLength(2);
  });
  it('NON-HALLUCINATION : le cours n’a aucune exception → aucune section « Exceptions »/« Pièges »/« Exemples » artificielle', async () => {
    const c = await sheet('complete');
    const titles = c.sections.map((s) => s.title.toLowerCase()).join('|');
    expect(titles).not.toMatch(/exception|piège|exemple|vérifier/);
    expect(c.sections.some((s) => s.kind === 'examples' || s.kind === 'pitfalls')).toBe(false);
  });
  it('chaque élément cite un extrait EXACT du cours', async () => {
    const o = out();
    const c = await sheet('complete');
    for (const sec of c.sections) for (const it of sec.items) {
      expect(it.sources.length).toBeGreaterThan(0);
      for (const s of it.sources) expect(o.text).toContain(s.quote.slice(0, 40));
    }
  });
  it('modes : express < standard < complète en volume', async () => {
    const size = async (m: 'express' | 'standard' | 'complete') => JSON.stringify(await sheet(m)).length;
    expect(await size('express')).toBeLessThanOrEqual(await size('standard'));
    expect(await size('standard')).toBeLessThanOrEqual(await size('complete'));
    const ex = await sheet('express');
    expect(ex.sections.every((s) => s.items.every((i) => i.text.length <= 161))).toBe(true);
  });
  it('options : exclure les jurisprudences', async () => {
    const d = await generateDraft(out(), { type: 'COURSE_SHEET', options: { mode: 'standard', include: { caselaw: false } } });
    expect((d.content as SheetContent).sections.some((s) => s.kind === 'caselaw')).toBe(false);
  });
  it('matière non juridique (finance) : notions issues des titres, aucune rubrique juridique', async () => {
    const fin = buildOutline('f', 'Finance', { type: 'doc', content: [h(1, 'Valeur actuelle nette'), p('La VAN actualise les flux futurs au taux requis.'), h(1, 'TRI'), p('Le TRI annule la VAN du projet.')] });
    const c = (await generateDraft(fin, { type: 'COURSE_SHEET', options: { mode: 'standard' } })).content as SheetContent;
    expect(c.sections.map((s) => s.kind)).toEqual(['plan', 'concepts']);
    expect(c.sections[1]!.items.map((i) => i.label)).toEqual(['Valeur actuelle nette', 'TRI']);
  });
  it('résumé express', async () => {
    const c = (await generateDraft(out(), { type: 'COURSE_SHEET', options: { summary: true } })).content as SheetContent;
    expect(c.variant).toBe('summary');
    expect(c.sections).toHaveLength(1);
  });
  it('cours vide : refus explicite plutôt qu’un support inventé', async () => {
    await expect(generateDraft(buildOutline('e', 'Vide', { type: 'doc', content: [] }), { type: 'COURSE_SHEET' })).rejects.toBeInstanceOf(EmptySourceError);
    await expect(generateDraft(buildOutline('e', 'Vide', { type: 'doc', content: [] }), { type: 'MIND_MAP' })).rejects.toBeInstanceOf(EmptySourceError);
  });
});

describe('carte mentale', () => {
  const map = async (detail: 'simple' | 'standard' | 'detailed') => (await generateDraft(out(), { type: 'MIND_MAP', options: { detail } })).content as MindMapContent;
  it('reflète la structure réelle du cours', async () => {
    const m = await map('standard');
    expect(m.root.title).toBe('Droit des contrats');
    const formation = m.root.children[0]!;
    expect(formation.title).toBe('Formation du contrat');
    expect(formation.children.map((c) => c.title)).toEqual(['Consentement', 'Capacité']);
    expect(formation.children[0]!.children.map((c) => c.title)).toEqual(['Erreur', 'Dol', 'Violence']);
  });
  it('niveaux de détail : simple ≤ 15, standard ≤ 30, détaillée complète', async () => {
    const s = await map('simple'), st = await map('standard'), d = await map('detailed');
    expect(countNodes(s.root)).toBeLessThanOrEqual(15);
    expect(countNodes(st.root)).toBeLessThanOrEqual(30);
    expect(countNodes(d.root)).toBeGreaterThanOrEqual(countNodes(st.root));
    expect(countNodes(s.root)).toBeLessThan(countNodes(d.root));
  });
  it('plafond respecté sur un gros cours (jamais 150 nœuds d’emblée en mode standard) + omissions signalées', () => {
    const big = buildOutline('b', 'Gros', { type: 'doc', content: Array.from({ length: 120 }, (_, k) => [h(2, `Partie ${k}`), lb('definition', `Terme ${k} : définition ${k}`)]).flat() });
    const g = generateMindMap({ outline: big, scope: big.root }, { detail: 'standard', orientation: 'horizontal' });
    expect(countNodes(g.content.root)).toBeLessThanOrEqual(30);
    expect(g.omitted).toBeGreaterThan(100);
  });
  it('détaillée volumineuse : branches profondes repliées par défaut', () => {
    const big = buildOutline('b', 'Gros', { type: 'doc', content: Array.from({ length: 40 }, (_, k) => [h(1, `A${k}`), h(2, `B${k}`), h(3, `C${k}`), lb('article', `Art. ${k} : texte`)]).flat() });
    const g = generateMindMap({ outline: big, scope: big.root }, { detail: 'detailed', orientation: 'horizontal' });
    expect(countNodes(g.content.root)).toBeGreaterThan(60);
    const lay = layoutMindMap(g.content.root, 'horizontal');
    expect(lay.nodes.length).toBeLessThan(countNodes(g.content.root));
  });
  it('génération depuis une SECTION : uniquement cette partie', async () => {
    const o = out();
    const sec = o.sections.find((s) => s.title === 'Consentement')!;
    const d = await generateDraft(o, { type: 'MIND_MAP', scope: { sectionId: sec.id }, options: { detail: 'standard' } });
    const m = d.content as MindMapContent;
    expect(m.root.title).toBe('Consentement');
    expect(JSON.stringify(m)).not.toContain('Capacité');
    expect(d.scope).toEqual({ sectionId: sec.id, sectionTitle: 'Consentement' });
  });
  it('nœuds sourcés avec extrait exact', async () => {
    const o = out();
    const m = await map('detailed');
    const dol = m.root.children[0]!.children[0]!.children[1]!;
    expect(dol.title).toBe('Dol');
    expect(dol.sources[0]!.headingPath).toEqual(['Formation du contrat', 'Consentement', 'Dol']);
    expect(o.text).toContain(dol.sources[0]!.quote);
  });
  it('mise en page : positions finies, pas de chevauchement, repli = nœuds en moins', async () => {
    const m = await map('detailed');
    for (const orient of ['horizontal', 'vertical', 'radial'] as const) {
      const l = layoutMindMap(m.root, orient);
      expect(l.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
      const ids = new Set(l.nodes.map((n) => n.node.id));
      expect(l.links.every((k) => ids.has(k.from) && ids.has(k.to))).toBe(true);
    }
    const folded = structuredClone(m); folded.root.children[0]!.collapsed = true;
    expect(layoutMindMap(folded.root, 'horizontal').nodes.length).toBeLessThan(layoutMindMap(m.root, 'horizontal').nodes.length);
  });
});

describe('schémas', () => {
  it('aucune étape / condition / date dans ce cours → refus honnête, pas de schéma inventé', () => {
    for (const type of ['PROCESS', 'FLOWCHART', 'TIMELINE'] as const) {
      const o = out();
      const fn = () => generateDiagram({ outline: o, scope: scopeSection(o, o.sections.find((s) => s.title === 'Violence')!.id) }, type);
      expect(fn, type).toThrow(EmptySourceError);
    }
  });
  it('processus depuis une liste numérotée : flèches « ordre », début/fin', () => {
    const o = buildOutline('p', 'Méthode', { type: 'doc', content: [h(1, 'Cas pratique'), ol('Identifier les faits', 'Qualifier juridiquement', 'Énoncer la règle', 'Appliquer', 'Conclure')] });
    const d = generateDiagram({ outline: o, scope: o.root }, 'PROCESS').content;
    expect(d.nodes.map((n) => n.kind)).toEqual(['start', 'step', 'step', 'step', 'end']);
    expect(d.edges).toHaveLength(4);
    expect(d.edges.every((e) => e.basis === 'order')).toBe(true);
    expect(suggestDiagramType({ outline: o, scope: o.root })).toBe('PROCESS');
  });
  it('raisonnement conditionnel : « si… alors » explicite → décision ; le « non » n’est PAS inventé', () => {
    const o = buildOutline('c', 'Cond', { type: 'doc', content: [h(1, 'Validité'), p('Si le consentement est vicié, alors le contrat est annulable.')] });
    const d = generateDiagram({ outline: o, scope: o.root }, 'FLOWCHART').content;
    expect(d.nodes.map((n) => n.kind)).toEqual(['decision', 'step']);
    expect(d.edges).toHaveLength(1);
    expect(d.edges[0]).toMatchObject({ label: 'oui', basis: 'stated' });
  });
  it('NON-HALLUCINATION : toutes les flèches générées ont une base vérifiable (jamais « inferred »)', () => {
    const o = out();
    for (const type of ['HIERARCHY', 'COMPARISON', 'RELATIONSHIP'] as const) {
      try {
        const d = generateDiagram({ outline: o, scope: o.root }, type).content;
        expect(d.edges.every((e) => e.basis !== 'inferred' && !e.uncertain), type).toBe(true);
      } catch (e) { expect(e).toBeInstanceOf(EmptySourceError); }
    }
  });
  it('hiérarchie et chronologie', () => {
    const o = out();
    expect(generateDiagram({ outline: o, scope: o.root }, 'HIERARCHY').content.edges.every((e) => e.basis === 'structure')).toBe(true);
    const t = buildOutline('t', 'Histoire', { type: 'doc', content: [h(1, 'Réformes'), p('La loi de 1804 crée le Code civil.'), p('L’ordonnance de 2016 réforme le droit des contrats.'), p('La loi de 1975 réforme le divorce.')] });
    const tl = generateDiagram({ outline: t, scope: t.root }, 'TIMELINE').content;
    expect(tl.nodes[0]!.label).toContain('1804');
    expect(tl.nodes.at(-1)!.label).toContain('2016');
  });
  it('mise en page en couches : début en haut, positions finies, graphe cyclique toléré', () => {
    const o = buildOutline('p', 'M', { type: 'doc', content: [ol('A', 'B', 'C')] });
    const d = generateDiagram({ outline: o, scope: o.root }, 'PROCESS').content;
    const l = layoutDiagram(d);
    const ys = d.nodes.map((n) => l.pos[n.id]!.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    const cyc = { ...d, edges: [...d.edges, { id: 'z', from: d.nodes[2]!.id, to: d.nodes[0]!.id, basis: 'stated' as const }] };
    expect(Object.values(layoutDiagram(cyc).pos).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });
});

describe('tableau comparatif', () => {
  it('erreur / dol / violence : lignes par type, cellule « — » quand le cours est muet, sources', () => {
    const o = out();
    const consent = o.sections.find((s) => s.title === 'Consentement')!;
    const g = generateComparison({ outline: o, scope: consent });
    expect(g.content.columns.map((c) => c.title)).toEqual(['Erreur', 'Dol', 'Violence']);
    const labels = g.content.rows.map((r) => r.label);
    expect(labels).toEqual(['Définition', 'Articles', 'Jurisprudence']);
    const art = g.content.rows.find((r) => r.label === 'Articles')!;
    const viol = g.content.columns[2]!.id;
    expect(art.cells[viol]).toEqual({ text: '—', sources: [] }); // la violence n'a pas d'article dans CE cours : rien d'inventé
    expect(Object.values(art.cells).filter((c) => c.sources.length).length).toBe(2);
  });
  it('une seule notion : refus', () => {
    const o = buildOutline('x', 'X', { type: 'doc', content: [h(1, 'Seul'), p('texte')] });
    expect(() => generateComparison({ outline: o, scope: o.root })).toThrow(EmptySourceError);
  });
  it('suggestions discrètes, calculées sur le cours', () => {
    const s = suggestSupports(out());
    expect(s.map((x) => x.type)).toEqual(expect.arrayContaining(['MIND_MAP', 'COMPARISON_TABLE']));
    expect(suggestSupports(buildOutline('v', 'V', { type: 'doc', content: [p('court')] }))).toEqual([]);
  });
});

describe('dates et numéros d’articles', () => {
  it('« Art. 1132 », « article L. 1240-1 » ne sont pas des dates', async () => {
    const o = buildOutline('d', 'D', { type: 'doc', content: [lb('article', 'Art. 1132 : erreur.'), lb('article', 'Article L. 1240-1 du code'), p('Selon l’article 1137 du code civil.'), lb('article', 'Art. 1137 : dol.')] });
    await expect(generateDraft(o, { type: 'TIMELINE' })).rejects.toBeInstanceOf(EmptySourceError);
  });
  it('« en 1804 », « le 13 juillet 1930 » en sont', async () => {
    const o = buildOutline('d', 'D', { type: 'doc', content: [p('Loi du 13 juillet 1930 sur l’assurance.'), p('Réforme en 2016.')] });
    const c = (await generateDraft(o, { type: 'TIMELINE' })).content as { events: { date: string }[] };
    expect(c.events.map((e) => e.date)).toEqual(['13 juillet 1930', '2016']);
  });
  it('tableau : choisit le groupe de notions qui porte le plus d’éléments juridiques (erreur / dol / violence)', () => {
    const o = out();
    expect(comparableSections({ outline: o, scope: o.root }).map((s) => s.title)).toEqual(['Erreur', 'Dol', 'Violence']);
  });
});

describe('flashcards, quiz, chronologie', () => {
  it('flashcards : définitions « Terme : texte » → recto/verso ; extraits réels', async () => {
    const d = (await generateDraft(out(), { type: 'FLASHCARDS' })).content as { cards: { front: string; back: string; sources: { quote: string }[] }[] };
    expect(d.cards.some((c) => c.front === 'Définir : Dol' && c.back.startsWith('manœuvres'))).toBe(true);
    expect(d.cards.every((c) => out().text.includes(c.sources[0]!.quote))).toBe(true);
  });
  it('quiz : la réponse est le passage du cours (aucune réponse inventée)', async () => {
    const q = (await generateDraft(out(), { type: 'QUIZ' })).content as { questions: { prompt: string; answer: string }[] };
    expect(q.questions.length).toBeGreaterThan(3);
    expect(q.questions.every((x) => out().text.includes(x.answer.slice(0, 30)))).toBe(true);
  });
  it('chronologie : trie les dates du cours', async () => {
    const o = buildOutline('t', 'H', { type: 'doc', content: [p('En 2016, réforme.'), p('En 1804, Code civil.')] });
    const c = (await generateDraft(o, { type: 'TIMELINE' })).content as { events: { date: string }[] };
    expect(c.events.map((e) => e.date)).toEqual(['1804', '2016']);
  });
});

describe('validation stricte (pas de parsing fragile)', () => {
  it('rejette une structure invalide', () => {
    expect(() => validateContent('MIND_MAP', { detail: 'standard', orientation: 'horizontal', root: { id: 'r', title: '', type: 'root', children: [] } })).toThrow(ArtifactValidationError);
    expect(() => validateContent('DIAGRAM', { type: 'PROCESS', nodes: [{ id: 'a', label: 'A', kind: 'step' }], edges: [{ id: 'e', from: 'a', to: 'zzz', basis: 'order' }] })).toThrow(/inexistant/);
    expect(() => validateContent('COURSE_SHEET', 'du texte libre')).toThrow(ArtifactValidationError);
    expect(() => validateContent('COMPARISON_TABLE', { columns: [{ id: 'a', title: 'A' }], rows: [] })).toThrow();
  });
});

describe('sortie IA : garde anti-invention', () => {
  const courseText = out().text;
  it('fiche : un élément dont l’extrait n’existe pas dans le cours est écarté', () => {
    const ai = validateContent('COURSE_SHEET', { mode: 'standard', sections: [
      { id: 'a', kind: 'articles', title: 'Articles', items: [
        { id: '1', text: 'Art. 1137', sources: [{ sessionId: 's1', quote: 'Art. 1137 : le dol est le fait pour un contractant' }] },
        { id: '2', text: 'Art. 9999 inventé', sources: [{ sessionId: 's1', quote: 'Art. 9999 : texte qui n’existe pas' }] },
        { id: '3', text: 'Sans source', sources: [] },
      ] },
      { id: 'b', kind: 'pitfalls', title: 'Pièges', items: [{ id: '4', text: 'Piège inventé', sources: [] }] },
    ] });
    const r = guardAiContent('COURSE_SHEET', ai, courseText);
    const c = r.content as SheetContent;
    expect(r.dropped).toBe(3);
    expect(c.sections).toHaveLength(1);
    expect(c.sections[0]!.items.map((i) => i.id)).toEqual(['1']);
  });
  it('schéma : flèche déduite marquée incertaine, nœud sans source marqué incertain', () => {
    const ai = validateContent('DIAGRAM', { type: 'RELATIONSHIP', nodes: [
      { id: 'a', label: 'Dol', kind: 'concept', sources: [{ sessionId: 's1', quote: 'Dol : manœuvres destinées à tromper' }] },
      { id: 'b', label: 'Fantôme', kind: 'concept', sources: [] },
    ], edges: [{ id: 'e', from: 'a', to: 'b', basis: 'inferred', label: 'cause' }] });
    const r = guardAiContent('DIAGRAM', ai, courseText).content as ReturnType<typeof validateContent<'DIAGRAM'>>;
    expect(r.nodes.find((n) => n.id === 'a')!.uncertain).toBeUndefined();
    expect(r.nodes.find((n) => n.id === 'b')!.uncertain).toBe(true);
    expect(r.edges[0]!.uncertain).toBe(true);
  });
  it('un fournisseur IA branché passe par la même validation', async () => {
    setStudyProvider({ id: 'fake', label: 'Faux', isAvailable: () => true, generate: async () => ({ not: 'valide' }) });
    await expect(generateDraft(out(), { type: 'MIND_MAP' }, { useAi: true })).rejects.toBeInstanceOf(ArtifactValidationError);
    setStudyProvider({ id: 'fake', label: 'Faux', isAvailable: () => true, generate: async () => ({ mode: 'express', sections: [{ id: 'x', kind: 'articles', title: 'A', items: [{ id: '1', text: 'inventé', sources: [{ sessionId: 's', quote: 'rien' }] }] }] }) });
    const d = await generateDraft(out(), { type: 'COURSE_SHEET' }, { useAi: true });
    expect(d.dropped).toBe(1);
    expect(d.generatedBy.providerId).toBe('fake');
    setStudyProvider(null);
  });
});

describe('commandes naturelles → même moteur', () => {
  const cases: [string, string, Record<string, unknown>][] = [
    ['Fais-moi une carte mentale de ce cours.', 'MIND_MAP', {}],
    ['Fais-moi une fiche uniquement sur les nullités.', 'COURSE_SHEET', { sectionQuery: 'nullites' }],
    ['Crée un schéma sur les étapes de formation du contrat.', 'DIAGRAM', { options: { diagramType: 'PROCESS' } }],
    ['Fais-moi une fiche très courte pour réviser demain.', 'COURSE_SHEET', { options: { mode: 'express' } }],
    ['Fais-moi des flashcards', 'FLASHCARDS', {}],
  ];
  it.each(cases)('%s', (text, type, extra) => {
    expect(interpretStudyCommand(text)).toMatchObject({ type, ...extra });
  });
  it('« Compare erreur, dol et violence » → tableau + notions', () => {
    expect(interpretStudyCommand('Compare erreur, dol et violence.')).toMatchObject({ type: 'COMPARISON_TABLE', compare: ['erreur', 'dol', 'violence'] });
  });
  it('phrase sans rapport : aucune action', () => { expect(interpretStudyCommand('quel temps fait-il')).toBeNull(); });
  it('retrouve la section visée', () => {
    expect(findSection(out(), 'vices du consentement')?.title).toBe('Consentement');
    expect(findSection(out(), 'dol')?.title).toBe('Dol');
    expect(findSection(out(), 'zzz inconnu')).toBeNull();
  });
});

describe('versions et mise à jour du cours', () => {
  it('un support à jour n’est pas signalé', async () => {
    const o = out();
    const a = toArtifact(await generateDraft(o, { type: 'MIND_MAP' }), { userId: 'u', sessionId: 's1', subjectId: null });
    expect(isStale(a, o)).toBe(false);
  });
  it('empreinte différente quand le texte change ; version IA conservée', async () => {
    const o = out();
    const a = toArtifact(await generateDraft(o, { type: 'COURSE_SHEET' }), { userId: 'u', sessionId: 's1', subjectId: null });
    expect(a.aiContent).toEqual(a.content);
    expect(a.userEdited).toBe(false);
    const changed = buildOutline('s1', 'Droit des contrats', { type: 'doc', content: [...DROIT.content, lb('article', 'Art. 1130 : nouveau')] });
    expect(isStale(a, changed)).toBe(true);
  });
});

describe('performance des cartes (10 / 30 / 100 / 300 nœuds)', () => {
  const tree = (n: number) => {
    const kids = Array.from({ length: n - 1 }, (_, k) => ({ id: `n${k}`, title: `Nœud ${k}`, type: 'concept' as const, sources: [], children: [] as never[] }));
    // 10 branches maximum au 1er niveau, le reste en sous-branches
    const branches = kids.slice(0, Math.min(10, kids.length)).map((b) => ({ ...b, children: [] as typeof kids }));
    kids.slice(branches.length).forEach((k, idx) => branches[idx % branches.length]!.children.push(k));
    return { id: 'r', title: 'Racine', type: 'root' as const, sources: [], children: branches };
  };
  it.each([10, 30, 100, 300])('mise en page de %i nœuds en moins de 150 ms', (n) => {
    const root = tree(n);
    const t0 = performance.now();
    const l = layoutMindMap(root as never, 'horizontal');
    const ms = performance.now() - t0;
    expect(l.nodes.length).toBe(n);
    expect(ms).toBeLessThan(150);
  });
});

import { addChild, addDiagramEdge, addDiagramStepAfter, addSibling, expandTo, moveSibling, moveTo, removeDiagramNode, removeNode, renameNode, searchNodes, toggleCollapse } from './edit';

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
    const o = buildOutline('p', 'M', { type: 'doc', content: [ol('A', 'B', 'C')] });
    const d = generateDiagram({ outline: o, scope: o.root }, 'PROCESS').content;
    const { content, id } = addDiagramStepAfter(d, d.nodes[0]!.id, 'A bis');
    expect(content.nodes).toHaveLength(4);
    expect(content.edges).toHaveLength(3);
    expect(validateContent('DIAGRAM', content)).toBeTruthy();
    const closed = removeDiagramNode(content, id);
    expect(closed.edges).toHaveLength(2);
    expect(addDiagramEdge(d, d.nodes[2]!.id, d.nodes[0]!.id).edges.at(-1)!.basis).toBe('stated');
  });
});
