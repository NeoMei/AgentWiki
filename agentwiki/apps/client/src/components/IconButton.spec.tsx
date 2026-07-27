import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IconButton } from './IconButton';

describe('IconButton', () => {
  afterEach(cleanup);

  it('renders an accessible icon button with a label', () => {
    render(<IconButton label="Save"><span>S</span></IconButton>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('fires onClick and respects disabled', () => {
    const onClick = vi.fn();
    const { rerender } = render(<IconButton label="Save" onClick={onClick}><span>S</span></IconButton>);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<IconButton label="Save" onClick={onClick} disabled><span>S</span></IconButton>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('applies primary styling when primary', () => {
    render(<IconButton label="Save" primary testId="save"><span>S</span></IconButton>);
    expect(screen.getByTestId('save').className).toContain('bg-blue-600');
  });
});
