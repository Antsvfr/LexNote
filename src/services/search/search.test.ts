import { describe, expect, it } from 'vitest';
import { TextSearchProvider } from './index';
import { createModule, createSession, createSubject } from '@/domain/session';

const subject = createSubject('Économie', 'cyan');
const droit = createSubject('Droit', 'indigo');
const mod = createModule(droit.id, 'Droit des contrats');
const session = {
  ...createSession({ subjectId: droit.id, moduleId: mod.id, type: 'CM', title: 'Formation du contrat', number: 2, date: '2026-10-01' }),
  searchText: 'arrêt Poussin erreur qualité essentielle',
  excerpt: 'L’arrêt Poussin illustre l’erreur.',
};
const lib = { subjects: [subject, droit], modules: [mod], sessions: [session] };
const search = (q: string) => new TextSearchProvider().search(q, lib);

describe('recherche globale', () => {
  it('trouve une matière', () => expect(search('economie').some((h) => h.kind === 'subject' && h.title === 'Économie')).toBe(true));
  it('trouve un module', () => expect(search('contrats').some((h) => h.kind === 'module')).toBe(true));
  it('trouve une séance par son titre, insensible aux accents et à la casse', () => {
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
