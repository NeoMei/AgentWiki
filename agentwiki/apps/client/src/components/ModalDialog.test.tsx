import React, { useRef, useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ModalDialog } from './ModalDialog';

const DetachedOpenerHarness: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [showOpener, setShowOpener] = useState(true);
  const [fallbackVersion, setFallbackVersion] = useState(0);
  const fallbackRef = useRef<HTMLHeadingElement>(null);

  const closeAfterReplacingFallback = () => {
    setFallbackVersion((current) => current + 1);
    setShowOpener(false);
    setOpen(false);
  };

  return <>
    <h2 key={fallbackVersion} ref={fallbackRef} tabIndex={-1}>Mapping</h2>
    {showOpener ? <button type="button" onClick={() => setOpen(true)}>Prepare first Agent</button> : null}
    {open ? (
      <ModalDialog
        labelledBy="dialog-title"
        fallbackFocusRef={fallbackRef}
        onRequestClose={closeAfterReplacingFallback}
      >
        <h3 id="dialog-title">Prepare Agent</h3>
        <button type="button" onClick={closeAfterReplacingFallback}>Complete preparation</button>
      </ModalDialog>
    ) : null}
  </>;
};

describe('ModalDialog', () => {
  it('returns focus to a logical fallback when the opener is removed with the dialog', async () => {
    render(<DetachedOpenerHarness />);
    const opener = screen.getByRole('button', { name: 'Prepare first Agent' });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole('button', { name: 'Complete preparation' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Complete preparation' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Mapping' })).toHaveFocus());
    expect(document.body).not.toHaveFocus();
  });
});
