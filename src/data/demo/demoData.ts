/**
 * Données de démonstration de LexNote.
 *
 * ⚠️ Fichier isolé volontairement : aucune logique applicative n'en dépend.
 *    Tout est marqué `isDemo` et supprimable en un clic (Réglages) ou en
 *    désactivant le seed (`VITE_SEED_DEMO=false`).
 *
 * Contenu pédagogique à but de test uniquement — à ne pas considérer comme une source juridique.
 */
import type { CourseSession, LibrarySnapshot, Module, NoteDocument, Subject } from '@/domain/types';
import { createSession } from '@/domain/session';
import { countWords, makeExcerpt } from '@/lib/text';
import { doc, h, hr, legal, ol, p, plainTextOf, quote, ul } from './docBuilder';

export interface DemoLibrary extends LibrarySnapshot {
  notes: NoteDocument[];
}

const iso = (daysAgo: number, hour = 9) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
const day = (daysAgo: number) => iso(daysAgo).slice(0, 10);

export function buildDemoLibrary(): DemoLibrary {
  const subjects: Subject[] = [];
  const modules: Module[] = [];
  const sessions: CourseSession[] = [];
  const notes: NoteDocument[] = [];

  const subject = (key: string, name: string, color: string): string => {
    const t = iso(30);
    subjects.push({ id: `demo-sub-${key}`, name, color, createdAt: t, updatedAt: t, isDemo: true });
    return `demo-sub-${key}`;
  };
  const module = (key: string, subjectId: string, name: string): string => {
    const t = iso(30);
    modules.push({ id: `demo-mod-${key}`, subjectId, name, createdAt: t, updatedAt: t, isDemo: true });
    return `demo-mod-${key}`;
  };
  const session = (
    key: string, subjectId: string, moduleId: string, number: number, title: string,
    daysAgo: number, durationMin: number, content?: ReturnType<typeof doc>,
  ) => {
    const base = createSession({ subjectId, moduleId, title, number, date: day(daysAgo) });
    const text = content ? plainTextOf(content) : '';
    const t = iso(daysAgo, 11);
    const s: CourseSession = {
      ...base, id: `demo-cm-${key}`, isDemo: true, durationSec: durationMin * 60,
      status: content ? 'completed' : 'in_progress', completedAt: content ? t : null,
      createdAt: iso(daysAgo, 9), updatedAt: t,
      wordCount: countWords(text), excerpt: makeExcerpt(text), searchText: text,
    };
    sessions.push(s);
    if (content) notes.push({ sessionId: s.id, content, updatedAt: t });
  };

  const droit = subject('droit', 'Droit', 'indigo');
  const intro = module('intro', droit, 'Introduction au droit');
  const contrats = module('contrats', droit, 'Droit des contrats');
  const societes = module('societes', droit, 'Droit des sociétés');

  session('intro1', droit, intro, 1, 'Les sources du droit', 21, 95, doc(
    h(1, 'Les sources du droit'),
    p('La hiérarchie des normes structure tout le cours : ', { b: 'Constitution' }, ' > traités > lois > règlements.'),
    legal('important', p('Un traité régulièrement ratifié a une autorité supérieure à celle de la loi (art. 55 de la Constitution) — à revérifier dans le texte.')),
    ul([ 'Sources internes : ', { i: 'Constitution, loi, règlement' } ], [ 'Sources internationales et européennes' ], [ 'Sources non écrites : coutume, jurisprudence' ]),
  ));

  session('c1', droit, contrats, 1, 'Introduction générale', 14, 88, doc(
    h(1, 'Introduction générale au droit des contrats'),
    p('Le professeur rappelle que la réforme de 2016 a recodifié le droit commun des contrats dans le Code civil.'),
    h(2, 'I. Notion de contrat'),
    legal('definition', p({ b: 'Contrat' }, ' : accord de volontés entre deux ou plusieurs personnes destiné à créer, modifier, transmettre ou éteindre des obligations (art. 1101 C. civ.).')),
    legal('article', p('Art. 1103 C. civ. — les contrats légalement formés tiennent lieu de loi à ceux qui les ont faits.')),
    h(2, 'II. Classification'),
    ol([ 'Contrat synallagmatique / unilatéral' ], [ 'Contrat à titre onéreux / gratuit' ], [ 'Contrat de gré à gré / d’adhésion' ]),
    legal('example', p('Exemple du professeur : un contrat de transport (billet de train) est un contrat d’adhésion — pas de négociation possible sur le prix ni les conditions.')),
  ));

  session('c2', droit, contrats, 2, 'Formation du contrat', 10, 102, doc(
    h(1, 'La formation du contrat'),
    p('Deux temps : ', { b: 'la négociation' }, ' puis ', { b: 'la rencontre des volontés' }, ' (offre et acceptation).'),
    legal('definition', p({ b: 'Offre' }, ' : manifestation de volonté ferme, précise et non équivoque de s’engager en cas d’acceptation.')),
    ul([ 'Offre ', { b: 'précise' }, ' et ferme' ], [ 'Acceptation ', { b: 'pure et simple' } ], [ 'Le silence ne vaut pas acceptation, sauf exceptions' ]),
    legal('question', p('Que se passe-t-il quand l’offrant meurt avant l’acceptation ? Le professeur a évoqué la caducité — retrouver l’article correspondant.')),
    quote('La liberté contractuelle n’est pas l’absence de règles : c’est un cadre.'),
  ));

  session('c3', droit, contrats, 3, 'Conditions de validité', 3, 110, doc(
    h(1, 'Les conditions de validité du contrat'),
    legal('article', p('Art. 1128 C. civ. — sont nécessaires à la validité d’un contrat : 1° le consentement des parties ; 2° leur capacité de contracter ; 3° un contenu licite et certain.')),
    h(2, 'I. Le consentement'),
    p('Il doit exister et être ', { b: 'exempt de vices' }, ' : erreur, dol, violence.'),
    legal('caselaw', p('Arrêt Poussin (Civ. 1re, 22 févr. 1978) — erreur sur les qualités substantielles : attribution d’un tableau. (référence à vérifier)')),
    legal('important', p('Le vice du consentement entraîne la ', { b: 'nullité relative' }, ' du contrat.')),
    h(2, 'II. La capacité'),
    ul([ 'Principe : toute personne peut contracter' ], [ 'Incapacités : mineurs non émancipés, majeurs protégés' ]),
    legal('question', p('Différence entre incapacité de jouissance et d’exercice : à reprendre dans le manuel.')),
  ));

  session('c4', droit, contrats, 4, 'Vices du consentement', 0, 0);

  const eco = subject('eco', 'Économie', 'teal');
  const micro = module('micro', eco, 'Microéconomie');
  session('m1', eco, micro, 1, 'Offre et demande', 12, 85, doc(
    h(1, 'Offre et demande'),
    p('Le prix d’équilibre se forme à l’intersection des courbes d’offre et de demande.'),
    legal('definition', p({ b: 'Élasticité-prix' }, ' : variation relative de la quantité demandée en réponse à une variation relative du prix.')),
    ul([ 'Demande élastique : |e| > 1' ], [ 'Demande inélastique : |e| < 1' ]),
  ));

  const fin = subject('fin', 'Finance', 'brass');
  const corpfin = module('corpfin', fin, 'Finance d’entreprise');
  session('f1', fin, corpfin, 1, 'Valeur actuelle nette', 8, 90, doc(
    h(1, 'Valeur actuelle nette (VAN)'),
    p('Un projet est acceptable si sa VAN est positive au taux d’actualisation retenu.'),
    legal('important', p('VAN = somme des flux actualisés − investissement initial.')),
  ));

  const mkt = subject('mkt', 'Marketing', 'plum');
  const strat = module('strat', mkt, 'Stratégie marketing');
  session('k1', mkt, strat, 1, 'Segmentation et ciblage', 17, 70, doc(
    h(1, 'Segmentation, ciblage, positionnement'),
    p('Le triptyque ', { b: 'STP' }, ' structure toute démarche marketing.'),
    ul([ 'Segmentation : découper le marché' ], [ 'Ciblage : choisir les segments' ], [ 'Positionnement : se différencier' ]),
    hr(),
    p('Études de cas à préparer pour la semaine prochaine.'),
  ));

  // Une matière vide pour tester les écrans vides.
  void societes;

  return { subjects, modules, sessions, notes };
}
