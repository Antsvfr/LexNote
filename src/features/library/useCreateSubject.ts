import { promptText } from '@/components/confirm';
import { useLibrary } from '@/store/library';
import { toast } from '@/store/toasts';

/** Création d'une matière via une petite boîte de dialogue (utilisée par la barre latérale et la page Matières). */
export function useCreateSubject() {
  const addSubject = useLibrary((s) => s.addSubject);
  return async () => {
    const name = await promptText({ title: 'Nouvelle matière', label: 'Nom de la matière', placeholder: 'ex. Droit', confirmLabel: 'Créer' });
    if (!name) return;
    try { await addSubject(name); toast.success(`Matière « ${name} » créée.`); } catch { /* toast déjà affiché */ }
  };
}
