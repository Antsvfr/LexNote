import { Modal } from '@/components/Modal';

/** Avertissement affiché à la première utilisation — jamais d'enregistrement sans action explicite. */
export function ConsentDialog({ open, onCancel, onAccept }: { open: boolean; onCancel: () => void; onAccept: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Enregistrer ce cours ?"
      description="Enregistrer ou transcrire un cours peut nécessiter l’autorisation du professeur et des personnes concernées. Vous devez respecter le règlement de votre établissement et le droit applicable."
      footer={
        <>
          <button type="button" className="btn" onClick={onCancel}>Annuler</button>
          <button type="button" className="btn btn--primary" onClick={onAccept} data-testid="consent-accept">J’ai l’autorisation — continuer</button>
        </>
      }
    >
      <p className="muted" style={{ fontSize: 13.5 }}>
        Le micro ne s’active qu’après votre accord, et un indicateur « REC » reste visible tant qu’il fonctionne.
        L’audio est conservé sur cet appareil uniquement (selon le moteur choisi, la reconnaissance vocale peut passer par un service en ligne —
        le moteur actif est indiqué dans le panneau Transcription).
      </p>
    </Modal>
  );
}
