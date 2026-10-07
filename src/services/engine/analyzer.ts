/**
 * Analyse des morceaux → connaissances (définitions, articles, arrêts, dates, chiffres, formules, exemples, points d'examen,
 * étapes de méthode, raisonnements, ambiguïtés, passages incomplets…).
 *
 * `KnowledgeAnalyzer` est l'interface ; `RuleBasedAnalyzer` est l'implémentation locale (déterministe, hors-ligne, sans IA).
 * RÈGLE : une détection ne contient QUE du texte présent dans le morceau (extrait exact) — jamais de numéro d'article,
 * de juridiction, de date ou de citation reconstitué. Une détection est indépendante de l'emplacement : elle peut être mise en cache
 * par empreinte du morceau (traitement incrémental).
 */
import type { KnowledgeType, SourceChunk } from '@/domain/course';
import { foldKey, sentences } from './text';

export interface Detection {
  type: KnowledgeType;
  label?: string;
  /** Extrait exact (sous-chaîne du morceau). */
  quote: string;
  values?: string[];
  note?: string;
}

export interface KnowledgeAnalyzer {
  readonly id: string;
  /** Change quand les règles changent : invalide le cache d'analyse. */
  readonly version: string;
  analyze(chunk: SourceChunk, ctx: { markerReasons?: string[] }): Promise<Detection[]> | Detection[];
}

const MONTHS = 'janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre|janv\\.?|févr\\.?|avr\\.?|juil\\.?|sept\\.?|oct\\.?|nov\\.?|déc\\.?';
const DATE_RE = new RegExp(`\\b(?:\\d{1,2}(?:er)?\\s+(?:${MONTHS})\\s+(?:1[0-9]{3}|20[0-9]{2})|(?:${MONTHS})\\s+(?:1[0-9]{3}|20[0-9]{2})|\\d{1,2}[/.]\\d{1,2}[/.](?:1[0-9]{3}|20[0-9]{2})|(?:1[0-9]{3}|20[0-9]{2}))\\b`, 'gi');
const ART_RE = /\bart(?:icles?)?\.?\s*((?:[LRD]\.?\s*)?\d{1,4}(?:-\d{1,3})*(?:\s*(?:et|à|,)\s*\d{1,4}(?:-\d{1,3})*)*)(?:\s+(?:du|de la|de l['’]|des)\s+((?:[Cc]ode\s+(?:civil|pénal|penal|de commerce|du travail|de procédure civile|de procédure pénale|de la consommation|monétaire et financier|général des impôts|de la propriété intellectuelle|de justice administrative|de l['’]environnement|de la sécurité sociale|rural)|[Cc]onstitution|TFUE|CPC|CPP)))?/giu;
const CASE_RE = /\b(?:Cass\.?(?:\s*(?:civ\.?|com\.?|crim\.?|soc\.?|ass\.?\s*plén\.?|ch\.?\s*mixte|req\.?))?(?:\s*\d(?:re|e|ère|ème)?)?|Cour de cassation|Conseil d['’]État|CE\b|CJUE|CEDH|Cons\.?\s*const\.?|Conseil constitutionnel|CA\s+[A-ZÉ][\p{L}-]+|T\.?\s*com\.?\s+[A-ZÉ][\p{L}-]+)(?:[^.;\n]{0,80}?(?:n°|pourvoi)\s*[\d./-]+)?/giu;
const FIG_RE = /\b\d+(?:[  .,]\d+)*\s?(?:%|€|euros?|k€|M€|Md€|ans?|mois|jours?|heures?|h\b|km|kg|m²|points?)/giu;
const HEDGE = /\b(?:peut-être|je crois|il me semble|je ne suis pas sûr|pas certain|à vérifier|à confirmer|vérifier|sous réserve|à voir|environ|euh+)\b|\?\?+/i;
const EXAM = /\b(?:à retenir|retenez|important|essentiel|attention|piège|tombe(?:r|ra)?\b|examen|partiel|exam\b|incontournable|fondamental)\b/i;
const EXAMPLE = /^(?:par exemple|exemple|ex\s*:|ainsi|imaginons|supposons|prenons)\b/i;
const REASON = /\b(?:donc|par conséquent|en conséquence|il en résulte|dès lors|c['’]est pourquoi|puisque|parce que|en effet|or,|si\b.{3,80}\balors)\b/i;
const STEP_SEQ = /\b(?:d['’]abord|premièrement|en premier|ensuite|puis|deuxièmement|enfin|troisièmement|pour finir)\b/gi;
const AUTHOR_RE = /\b(?:[Ss]elon|[Dd]['’]après|[Pp]our)\s+(?:le\s+|la\s+)?(?:professeur|pr\.?|prof\.?|doyen|auteur|M\.|Mme)?\s*([A-ZÀ-Ý][\p{L}'’-]{2,}(?:\s+[A-ZÀ-Ý][\p{L}'’-]{2,}){0,2})/gu;
const BIB_RE = /\(\s*([A-ZÀ-Ý][\p{L}'’-]+(?:\s+(?:et|&)\s+[A-ZÀ-Ý][\p{L}'’-]+)?),?\s+((?:1[5-9]|20)\d{2})[a-z]?\s*\)|\b(?:op\.?\s*cit\.?|ibid\.?|ouvrage|manuel|traité de|RTD\s*civ\.?|D\.\s*\d{4}|JCP)\b[^.;\n]{0,80}/gu;
const FORMULA_RE = /^[^=:]{1,40}=\s*[^=]{1,100}$/;
const DEF_RE = [
  /^([A-ZÀ-Ý][\p{L}'’ -]{1,60}?)\s*:\s+(.{12,})$/u,
  /^(?:on appelle|on nomme|on désigne par)\s+([\p{L}'’ -]{2,60}?)\s+(.{12,})$/iu,
  /^(?:le |la |les |l['’])?([\p{L}'’ -]{2,50}?)\s+(?:est|sont|désigne|signifie|correspond à|consiste en|se définit comme)\s+(?:le |la |les |l['’]|un |une |des |du |de la )?(.{15,})$/iu,
];
const isYearOfArticle = (text: string, idx: number) => /(?:art(?:icles?)?\.?|n°|[LRD]\.)\s*$/i.test(text.slice(Math.max(0, idx - 12), idx)) || /^[-–]\d/.test(text.slice(idx + 4, idx + 6));

export const RULES_VERSION = 'rules-3';

export class RuleBasedAnalyzer implements KnowledgeAnalyzer {
  readonly id = 'local-rules';
  readonly version = RULES_VERSION;
  /** Compteur (tests) : nombre de morceaux réellement analysés. */
  analyzed = 0;

  analyze(c: SourceChunk, ctx: { markerReasons?: string[] } = {}): Detection[] {
    this.analyzed++;
    const t = c.text; const out: Detection[] = []; const add = (d: Detection) => { if (t.includes(d.quote) && d.quote.trim()) out.push(d); };
    const kind = c.blockKind;
    const sents = sentences(t);

    // --- structure explicite des notes (blocs typés par l'étudiant)
    if (kind === 'definition') {
      const m = DEF_RE[0]!.exec(t.split('\n')[0] ?? '');
      add({ type: 'definition', label: m?.[1]?.trim(), quote: t });
    } else if (kind === 'example') add({ type: 'example', quote: t });
    else if (kind === 'important') add({ type: 'exam_point', quote: t });
    else if (kind === 'question') add({ type: 'ambiguity', quote: t, note: 'Marqué « à vérifier » dans vos notes.' });
    else if (kind === 'step') add({ type: 'method_step', quote: t, values: t.split('\n').map((l) => l.replace(/^\d+\.\s*/, '')) });
    if ((kind === 'article' || kind === 'caselaw' || kind === 'definition') && t.trim().length < 25) add({ type: 'incomplete', quote: t, note: 'Passage très court : référence ou définition probablement non terminée.' });

    for (const s of sents) {
      const st = s.text;
      // --- articles de loi : numéro EXACT tel qu'écrit
      for (const m of st.matchAll(ART_RE)) add({ type: 'article', label: `Art. ${m[1]!.trim()}${m[2] ? ` du ${m[2].trim()}` : ''}`, quote: st, values: [m[1]!.replace(/\s+/g, '')] });
      // --- jurisprudence : citation littérale uniquement
      for (const m of st.matchAll(CASE_RE)) { if (m[0].length > 3) add({ type: 'caselaw', label: m[0].trim(), quote: st, values: [...(m[0].match(/n°\s*[\d./-]+|pourvoi\s*[\d./-]+/gi) ?? []).map((x) => x.replace(/\s+/g, ''))] }); }
      // --- dates (un numéro d'article n'est pas une année)
      const dates = [...st.matchAll(DATE_RE)].filter((m) => !(/^\d{4}$/.test(m[0]) && isYearOfArticle(st, m.index ?? 0))).map((m) => m[0]);
      if (dates.length) add({ type: 'date', label: dates[0], quote: st, values: dates.map((d) => foldKey(d)) });
      // --- chiffres
      const figs = [...st.matchAll(FIG_RE)].map((m) => m[0]);
      if (figs.length) add({ type: 'figure', label: figs[0], quote: st, values: figs.map((f) => foldKey(f)) });
      if (FORMULA_RE.test(st) && /[+\-*/×÷^()]|\d/.test(st) && st.length <= 120) add({ type: 'formula', label: st.split('=')[0]!.trim(), quote: st });
      // --- auteurs, références
      for (const m of st.matchAll(AUTHOR_RE)) add({ type: 'author', label: m[1]!.trim(), quote: st });
      for (const m of st.matchAll(BIB_RE)) add({ type: 'reference', label: m[0].trim().slice(0, 80), quote: st });
      // --- définitions (hors blocs déjà typés)
      if (!kind || kind === 'paragraph' || kind === 'list') {
        for (const re of DEF_RE) { const m = re.exec(st); if (m && m[1]!.split(/\s+/).length <= 6 && st.length <= 420) { add({ type: 'definition', label: m[1]!.trim(), quote: st }); break; } }
      }
      if (EXAMPLE.test(st) && kind !== 'example') add({ type: 'example', quote: st });
      if (REASON.test(st) && st.length >= 40) add({ type: 'reasoning', quote: st });
      if (HEDGE.test(st) && kind !== 'question') add({ type: 'ambiguity', quote: st, note: 'Formulation hésitante (« peut-être », « à vérifier »…) dans la source.' });
      if (EXAM.test(st) && kind !== 'important' && st.length >= 20) add({ type: 'exam_point', quote: st });
    }
    // --- séquence « d'abord… ensuite… enfin » (méthode orale)
    if (kind !== 'step' && (t.match(STEP_SEQ)?.length ?? 0) >= 3) add({ type: 'method_step', quote: t.slice(0, 600), note: 'Suite d’étapes annoncée à l’oral.' });
    // --- moment marqué par l'étudiant (examen / important) : le passage entier compte
    if (c.kind === 'TRANSCRIPT' && ctx.markerReasons?.some((r) => r === 'exam' || r === 'important')) add({ type: 'exam_point', quote: t.slice(0, 500), note: 'Moment que vous avez marqué pendant le cours.' });
    // --- reconnaissance vocale peu fiable
    if (c.kind === 'TRANSCRIPT' && (c.quality ?? 1) < 0.6) add({ type: 'ambiguity', quote: t.slice(0, 300), note: 'Reconnaissance vocale peu fiable sur ce passage.' });
    // --- passage inachevé
    if (/(?:\.\.\.|…|\[\.\.\.\]|à compléter|\bTODO\b|\bXXX\b)\s*$/i.test(t.trim()) || /\b(?:à compléter|TODO|XXX)\b/i.test(t)) add({ type: 'incomplete', quote: t.slice(0, 400), note: 'Passage marqué comme inachevé dans la source.' });

    return out.slice(0, 40);
  }
}
