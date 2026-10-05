import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { Modal } from './Modal';

interface Ask {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}
interface ConfirmState {
  current: (Ask & { resolve: (v: boolean) => void }) | null;
  ask: (a: Ask) => Promise<boolean>;
}

const useConfirmStore = create<ConfirmState>((set) => ({
  current: null,
  ask: (a) => new Promise<boolean>((resolve) => set({ current: { ...a, resolve } })),
}));

/** `if (await confirm({...})) …` — remplace window.confirm par une modale accessible. */
export const confirm = (a: Ask) => useConfirmStore.getState().ask(a);

export function ConfirmHost() {
  const { current } = useConfirmStore();
  const close = (v: boolean) => {
    current?.resolve(v);
    useConfirmStore.setState({ current: null });
  };
  return (
    <Modal
      open={!!current}
      onClose={() => close(false)}
      title={current?.title ?? ''}
      description={current?.message}
      footer={
        <>
          <button className="btn" onClick={() => close(false)} type="button">Annuler</button>
          <button className={`btn ${current?.danger ? 'btn--danger-solid' : 'btn--primary'}`} onClick={() => close(true)} type="button">
            {current?.confirmLabel ?? 'Confirmer'}
          </button>
        </>
      }
    />
  );
}

/* ---- saisie de texte (créer / renommer) ---- */
interface PromptAsk { title: string; label: string; initial?: string; placeholder?: string; confirmLabel?: string }
const usePromptStore = create<{
  current: (PromptAsk & { resolve: (v: string | null) => void }) | null;
}>(() => ({ current: null }));

/** Renvoie le texte saisi (non vide), ou `null` si annulé. */
export const promptText = (a: PromptAsk) =>
  new Promise<string | null>((resolve) => usePromptStore.setState({ current: { ...a, resolve } }));

export function PromptHost() {
  const { current } = usePromptStore();
  const [value, setValue] = useState('');
  useEffect(() => { setValue(current?.initial ?? ''); }, [current]);
  const close = (v: string | null) => {
    current?.resolve(v);
    usePromptStore.setState({ current: null });
  };
  return (
    <Modal
      open={!!current}
      onClose={() => close(null)}
      title={current?.title ?? ''}
      onSubmit={() => value.trim() && close(value.trim())}
      footer={
        <>
          <button type="button" className="btn" onClick={() => close(null)}>Annuler</button>
          <button type="submit" className="btn btn--primary" disabled={!value.trim()}>{current?.confirmLabel ?? 'Valider'}</button>
        </>
      }
    >
      <div className="field">
        <label htmlFor="prompt-input">{current?.label}</label>
        <input id="prompt-input" className="input" value={value} placeholder={current?.placeholder}
          onChange={(e) => setValue(e.target.value)} autoFocus maxLength={120} />
      </div>
    </Modal>
  );
}
