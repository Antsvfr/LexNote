import { useEffect, useRef, type ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  onSubmit?: () => void;
}

export function Modal({ open, onClose, title, description, children, footer, onSubmit }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const Body = onSubmit ? 'form' : 'div';
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="modal-title"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      {open && (
        <Body
          {...(onSubmit ? { onSubmit: (e: React.FormEvent) => { e.preventDefault(); onSubmit(); } } : {})}
        >
          <h2 id="modal-title">{title}</h2>
          {description && <p className="modal__desc">{description}</p>}
          {children && <div className="modal__body">{children}</div>}
          {footer && <div className="modal__foot">{footer}</div>}
        </Body>
      )}
    </dialog>
  );
}
