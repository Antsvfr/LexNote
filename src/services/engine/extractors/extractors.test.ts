// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ab, makeDocx, makePdf, makePptx } from '@/test/docs';
import { ExtractorRegistry, UnsupportedDocumentError, detectFormat, makePdfExtractor } from './index';
import { DocxExtractor } from './docx';
import { ImageExtractor } from './image';
import { PptxExtractor } from './pptx';
import { TextExtractor } from './text';

const ctx = { name: 'x' };
const legacy = makePdfExtractor(async () => {
  const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  lib.GlobalWorkerOptions.workerSrc = new URL('../../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href;
  return lib as never;
});

describe('extracteurs de documents', () => {
  it('PDF : une unité par page, numéro de page exact', async () => {
    const r = await legacy.extract(ab(makePdf(['Première page : le dol.', 'Seconde page : la violence.'])), ctx);
    expect(r.unitLabel).toBe('page'); expect(r.count).toBe(2);
    expect(r.units.map((u) => [u.index, u.text])).toEqual([[1, 'Première page : le dol.'], [2, 'Seconde page : la violence.']]);
  });
  it('PDF corrompu : erreur claire, pas de plantage', async () => {
    await expect(legacy.extract(ab(new TextEncoder().encode('pas un pdf')), ctx)).rejects.toBeInstanceOf(UnsupportedDocumentError);
  });
  it('PowerPoint : une unité par slide, titre détecté, notes du présentateur signalées', async () => {
    const r = await PptxExtractor.extract(ab(makePptx([{ title: 'Le dol', body: ['Manœuvres', 'Art. 1137'], notes: 'Insister sur la tromperie' }, { body: ['Slide sans titre'] }])), ctx);
    expect(r.unitLabel).toBe('slide'); expect(r.count).toBe(2);
    expect(r.units[0]).toMatchObject({ index: 1, title: 'Le dol' });
    expect(r.units[0]!.text).toContain('Art. 1137');
    expect(r.units[0]!.text).toContain('[Notes du présentateur] Insister sur la tromperie');
    expect(r.units[1]).toMatchObject({ index: 2, text: 'Slide sans titre' });
  });
  it('PowerPoint ordre numérique (slide10 après slide2)', async () => {
    const r = await PptxExtractor.extract(ab(makePptx(Array.from({ length: 11 }, (_, i) => ({ title: `S${i + 1}`, body: [`texte ${i + 1}`] })))), ctx);
    expect(r.units.map((u) => u.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });
  it('Word : titres, découpage par titre de niveau 1 ou par saut de page', async () => {
    const byHeading = await DocxExtractor.extract(ab(makeDocx([{ text: 'Chapitre 1', heading: 1 }, { text: 'Texte un.' }, { text: 'Chapitre 2', heading: 1 }, { text: 'Texte deux.' }])), ctx);
    expect(byHeading.unitLabel).toBe('section'); expect(byHeading.units.map((u) => u.title)).toEqual(['Chapitre 1', 'Chapitre 2']);
    const byPage = await DocxExtractor.extract(ab(makeDocx([{ text: 'Page un.' }, { text: 'Page deux.', pageBreak: true }])), ctx);
    expect(byPage.unitLabel).toBe('page'); expect(byPage.units).toHaveLength(2);
  });
  it('Word / PowerPoint invalides ou mal nommés : erreur claire', async () => {
    await expect(DocxExtractor.extract(ab(new TextEncoder().encode('xx')), ctx)).rejects.toBeInstanceOf(UnsupportedDocumentError);
    await expect(PptxExtractor.extract(ab(makeDocx([{ text: 'a' }])), ctx)).rejects.toThrow(/PowerPoint/);
  });
  it('texte / markdown : sections par titre', async () => {
    const r = await TextExtractor.extract(ab(new TextEncoder().encode('# Dol\nManœuvres.\n\n# Violence\nContrainte.')), ctx);
    expect(r.units.map((u) => u.title)).toEqual(['Dol', 'Violence']);
  });
  it('image : acceptée mais « texte non exploitable » (pas d’OCR simulé)', async () => {
    await expect(ImageExtractor.extract(ab(new Uint8Array(4)), ctx)).rejects.toThrow(/OCR/);
  });
  it('registre : extracteur remplaçable (ex. un OCR) sans toucher au reste', () => {
    const reg = new ExtractorRegistry([ImageExtractor, TextExtractor, DocxExtractor, PptxExtractor, legacy]);
    expect(reg.find({ name: 'a.PDF', mime: '' })?.id).toBe('pdf-1');
    expect(reg.find({ name: 'a.png', mime: 'image/png' })?.id).toBe('image-none');
    expect(reg.find({ name: 'a.doc', mime: 'application/msword' })).toBeUndefined();
    reg.register({ ...ImageExtractor, id: 'ocr-custom' });
    expect(reg.find({ name: 'a.png', mime: 'image/png' })?.id).toBe('ocr-custom');
    expect(detectFormat({ name: 'cours.pptx', mime: '' })).toBe('pptx');
  });
});
