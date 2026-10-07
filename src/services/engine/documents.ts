/**
 * Import et analyse des documents d'une séance.
 * Le fichier ORIGINAL est conservé tel quel (sur l'appareil seulement) ; le texte analysé est un contenu séparé, ré-analysable à tout moment.
 */
import { newId } from '@/lib/ids';
import type { SourceDocument } from '@/domain/course';
import type { StorageAdapter } from '@/services/storage/types';
import { ExtractorRegistry, UnsupportedDocumentError, defaultExtractors, detectFormat, ext } from './extractors';
import { cleanExtraction } from './normalize';
import { hashText } from './text';

export const MAX_DOC_BYTES = 40 * 1024 * 1024;
export class DuplicateDocumentError extends Error {
  constructor(readonly existing: SourceDocument) { super(`« ${existing.name} » est déjà dans les sources de cette séance.`); this.name = 'DuplicateDocumentError'; }
}
export interface DocDeps { adapter: StorageAdapter; userId: string; registry?: ExtractorRegistry; now?: () => string }

export async function fileHash(buf: ArrayBuffer): Promise<string> {
  try {
    const d = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  } catch { const u = new Uint8Array(buf); return hashText(`${u.length}:${[...u.slice(0, 4096)].join(',')}:${[...u.slice(-4096)].join(',')}`); }
}

const countWords = (t: string) => (t.match(/\S+/g) ?? []).length;
const stamp = (d: DocDeps) => (d.now ? d.now() : new Date().toISOString());

/** Extrait et enregistre le texte analysé. Les états intermédiaires (processing) sont écrits pour que l'interface les affiche. */
export async function analyzeDocument(doc: SourceDocument, buf: ArrayBuffer, deps: DocDeps, onState?: (d: SourceDocument) => void): Promise<SourceDocument> {
  const save = async (d: SourceDocument) => { await deps.adapter.commit({ putDocuments: [d] }); onState?.(d); return d; };
  const cur = await save({ ...doc, status: 'processing', error: undefined, updatedAt: stamp(deps) });
  const registry = deps.registry ?? defaultExtractors();
  const ex = registry.find({ name: doc.name, mime: doc.mime });
  const e = ext(doc.name);
  if (!ex) {
    const legacy = e === 'doc' ? 'Ancien format Word (.doc) non pris en charge : enregistrez le document en .docx.' : e === 'ppt' ? 'Ancien format PowerPoint (.ppt) non pris en charge : enregistrez la présentation en .pptx.' : `Format « .${e || '?'} » non pris en charge.`;
    return save({ ...cur, status: 'unsupported', error: legacy, extraction: null, wordCount: 0, updatedAt: stamp(deps) });
  }
  try {
    const raw = await ex.extract(buf, { name: doc.name });
    const extraction = cleanExtraction(raw);
    const words = extraction.units.reduce((n, u) => n + countWords(u.text), 0);
    if (!words) return save({ ...cur, status: 'unsupported', extractorId: ex.id, unitLabel: raw.unitLabel, count: raw.count, extraction: null, wordCount: 0, error: raw.warnings[0] ?? 'Aucun texte exploitable dans ce document.', updatedAt: stamp(deps) });
    return save({ ...cur, status: 'ready', extractorId: ex.id, unitLabel: extraction.unitLabel, count: extraction.count ?? extraction.units.length, extraction, wordCount: words, error: undefined, analyzedAt: stamp(deps), updatedAt: stamp(deps) });
  } catch (err) {
    const unsupported = err instanceof UnsupportedDocumentError;
    return save({ ...cur, status: unsupported ? 'unsupported' : 'error', extractorId: ex.id, extraction: null, wordCount: 0, error: unsupported ? err.message : `Analyse impossible : ${(err as Error).message}`, updatedAt: stamp(deps) });
  }
}

export async function importDocument(file: File, sessionId: string, deps: DocDeps, onState?: (d: SourceDocument) => void): Promise<SourceDocument> {
  const now = stamp(deps);
  const base: SourceDocument = {
    id: newId(), userId: deps.userId, sessionId, name: file.name, mime: file.type || '', format: detectFormat({ name: file.name, mime: file.type }), size: file.size,
    status: 'pending', unitLabel: 'page', wordCount: 0, extraction: null, fileHash: '', addedAt: now, createdAt: now, updatedAt: now,
  };
  if (file.size > MAX_DOC_BYTES) { const d = { ...base, status: 'error' as const, error: `Fichier trop volumineux (${Math.round(file.size / 1048576)} Mo, maximum ${MAX_DOC_BYTES / 1048576} Mo).` }; await deps.adapter.commit({ putDocuments: [d] }); onState?.(d); return d; }
  const buf = await file.arrayBuffer();
  const hash = await fileHash(buf);
  const dup = (await deps.adapter.loadDocuments()).find((d) => d.sessionId === sessionId && d.fileHash === hash);
  if (dup) throw new DuplicateDocumentError(dup);
  const doc = { ...base, fileHash: hash };
  await deps.adapter.putDocumentFile(doc.id, new Blob([buf], { type: file.type }));
  await deps.adapter.commit({ putDocuments: [doc] });
  onState?.(doc);
  return analyzeDocument(doc, buf, deps, onState);
}

/** Ré-analyse depuis le fichier original conservé (ex. après l'ajout d'un nouvel extracteur). */
export async function reanalyzeDocument(id: string, deps: DocDeps, onState?: (d: SourceDocument) => void): Promise<SourceDocument> {
  const doc = (await deps.adapter.loadDocuments()).find((d) => d.id === id);
  if (!doc) throw new Error('Document introuvable.');
  const file = await deps.adapter.getDocumentFile(id);
  if (!file) return (async () => { const d = { ...doc, status: 'error' as const, error: 'Le fichier original n’est pas sur cet appareil (document ajouté depuis un autre appareil) : ajoutez-le de nouveau pour le ré-analyser.', updatedAt: stamp(deps) }; await deps.adapter.commit({ putDocuments: [d] }); onState?.(d); return d; })();
  return analyzeDocument(doc, await file.arrayBuffer(), deps, onState);
}

export const removeDocument = (id: string, deps: DocDeps) => deps.adapter.commit({ deleteDocuments: [id] });
