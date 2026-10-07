import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Dialog({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () =>
      Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          'input,button,select,textarea,[tabindex="0"]',
        ) ?? [],
      ).filter((element) => !element.hasAttribute('disabled'));
    const elements = focusable();
    (elements.find((element) => element.tagName !== 'BUTTON') ?? elements[0])?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const elements = focusable();
        const first = elements[0];
        const last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        className={`dialog ${wide ? 'dialog-wide' : ''}`}
      >
        <div className="dialog-heading">
          <h2 id="dialog-title">{title}</h2>
          <button className="icon-button" aria-label="Cerrar diálogo" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
