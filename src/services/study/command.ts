/**
 * Exécution d'une demande en langage naturel (« fais-moi une fiche sur les nullités ») : MÊME moteur que le panneau « Créer un support ».
 * L'assistant n'a pas de chemin parallèle : interpretStudyCommand → generateDraft → StudyArtifact.
 */
import { useArtifacts } from '@/store/artifacts';
import { useAuth } from '@/store/auth';
import { useLibrary } from '@/store/library';
import type { StudyArtifact } from '@/domain/study';
import { findSection, generateDraft, outlineFor, toArtifact, type StudyIntent } from './engine';

export async function runStudyIntent(intent: StudyIntent, sessionId?: string): Promise<StudyArtifact> {
  const lib = useLibrary.getState();
  const userId = useAuth.getState().user?.id;
  if (!userId) throw new Error('Connectez-vous pour créer un support.');
  const session = lib.sessions.find((s) => s.id === sessionId) ?? [...lib.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (!session) throw new Error('Créez d’abord une séance et prenez des notes.');
  const outline = outlineFor(session.id, session.title, await lib.loadNotes(session.id));

  let sectionId: string | undefined;
  if (intent.sectionQuery) {
    const sec = findSection(outline, intent.sectionQuery);
    if (!sec) throw new Error(`Je ne trouve pas de partie « ${intent.sectionQuery} » dans ce cours.`);
    sectionId = sec.id;
  }
  const options = { ...intent.options };
  if (intent.compare?.length) {
    const ids = intent.compare.map((c) => findSection(outline, c)?.id).filter((x): x is string => !!x);
    if (ids.length < 2) throw new Error('Je n’ai pas retrouvé au moins deux des notions à comparer dans ce cours.');
    options.compareSectionIds = ids;
  }
  const draft = await generateDraft(outline, { type: intent.type, scope: sectionId ? { sectionId } : undefined, options });
  const art = toArtifact(draft, { userId, sessionId: session.id, subjectId: session.subjectId });
  art.type = intent.type;
  await useArtifacts.getState().add(art);
  return art;
}
