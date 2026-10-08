import { describe, expect, it } from 'vitest';
import { TextSearchProvider } from './index';
import { mod, sess, subj } from '@/test/fixtures';

const eco = subj('Économie', 'green');
const droit = subj('Droit', 'indigo');
const contrats = mod(droit.id, 'Droit des contrats');
const formation = { ...sess({ subjectId: droit.id, moduleId: contrats.id, title: 'La formation du contrat' }), searchText: 'La formation du contrat. Le tableau de Poussin illustre le consentement.' };
const lib = { subjects: [eco, droit], modules: [contrats], sessions: [formation] };
const search = (q: string) => new TextSearchProvider().search(q, lib);

describe('recherche globale', () => {
  it('trouve une matière', () => expect(search('economie').some((h) => h.kind === 'subject' && h.title === 'Économie')).toBe(true));
  it('trouve un module', () => expect(search('contrats').some((h) => h.kind === 'module')).toBe(true));
  it('trouve un CM par son titre, insensible aux accents et à la casse', () => {
    const hits = search('FORMATION du contrat');
    expect(hits.some((h) => h.kind === 'session' && h.matchedIn === 'title')).toBe(true);
  });
  it('trouve dans le contenu des notes', () => {
    const hits = search('Poussin');
    expect(hits.some((h) => h.kind === 'session' && h.matchedIn === 'content' && h.snippet?.includes('Poussin'))).toBe(true);
  });
  it('tous les mots doivent correspondre', () => expect(search('poussin xyzinconnu')).toHaveLength(0));
  it('requête vide = aucun résultat', () => expect(search('  ')).toEqual([]));
});
