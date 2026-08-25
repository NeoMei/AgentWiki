import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface ModalDialogProps {
  labelledBy: string;
  onRequestClose: () => void;
  closeDisabled?: boolean;
  returnFocusTo?: HTMLElement | null;
  fallbackFocusTo?: HTMLElement | null;
  className?: string;
  children: React.ReactNode;
}

export const ModalDialog: React.FC<ModalDialogProps> = ({
  labelledBy,
  onRequestClose,
  closeDisabled = false,
  returnFocusTo,
  fallbackFocusTo,
  className = '',
  children,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [portalNode] = useState(() => document.createElement('div'));
  const [returnFocus] = useState(() => document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null);

  useLayoutEffect(() => {
    portalNode.dataset.modalPortal = 'true';
    document.body.appendChild(portalNode);
    const background = Array.from(document.body.children)
      .filter((element) => element !== portalNode)
      .map((element) => ({
        element,
        inert: element.getAttribute('inert'),
      }));
    for (const { element } of background) {
      element.setAttribute('inert', '');
    }

    const initialFocus = dialogRef.current?.querySelector<HTMLElement>('[data-modal-autofocus]')
      ?? dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    initialFocus?.focus();

    return () => {
      for (const { element, inert } of background) {
        if (inert === null) element.removeAttribute('inert');
        else element.setAttribute('inert', inert);
      }
      portalNode.remove();
      const preferredReturnTarget = returnFocusTo ?? returnFocus;
      if (preferredReturnTarget?.isConnected) preferredReturnTarget.focus();
      else if (fallbackFocusTo?.isConnected) fallbackFocusTo.focus();
    };
  }, [fallbackFocusTo, portalNode, returnFocus, returnFocusTo]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (!closeDisabled) onRequestClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (!focusable.length) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !closeDisabled) onRequestClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={className}
        onKeyDown={handleKeyDown}
      >
        {children}
      </div>
    </div>,
    portalNode,
  );
};
