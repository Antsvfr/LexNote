/** Demande en langage naturel → MÊME chemin que le panneau « Créer » : version du cours → générateur → artefact. */
import { useArtifacts } from '@/store/artifacts';
import { useAuth } from '@/store/auth';
import { useEngine } from '@/store/engine';
import { useLibrary } from '@/store/library';
import type { StudyArtifact } from '@/domain/study';
import { findSection, generateDraft, latestCourse, toArtifact, treeOf, type StudyIntent } from './engine';

export async function runStudyIntent(intent: StudyIntent, sessionId?: string): Promise<StudyArtifact> {
  const lib = useLibrary.getState();
  const userId = useAuth.getState().user?.id;
  if (!userId) throw new Error('Connectez-vous pour créer un support.');
  const session = lib.sessions.find((s) => s.id === sessionId) ?? [...lib.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (!session) throw new Error('Créez d’abord une séance et prenez des notes.');
  const course = latestCourse(useEngine.getState().courses, session.id);
  if (!course) throw new Error('Reconstruisez d’abord le cours de cette séance (espace « Cours »).');
  const tree = treeOf(course);
  let sectionId: string | undefined;
  if (intent.sectionQuery) {
    const sec = findSection(tree, intent.sectionQuery);
    if (!sec) throw new Error(`Je ne trouve pas de partie « ${intent.sectionQuery} » dans le cours.`);
    sectionId = sec.id;
  }
  const settings = { ...intent.settings };
  if (intent.compare?.length) {
    const ids = intent.compare.map((c) => findSection(tree, c)?.id).filter((x): x is string => !!x);
    if (ids.length < 2) throw new Error('Je n’ai pas retrouvé au moins deux des notions à comparer dans le cours.');
    settings.conceptIds = ids;
  }
  const draft = generateDraft(course, { type: intent.type, scope: sectionId ? { sectionId } : undefined, settings });
  const art = toArtifact(draft, { userId, subjectId: session.subjectId });
  await useArtifacts.getState().add(art);
  return art;
}
