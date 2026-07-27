import React from 'react';

// A compact icon-only button in the same family as the mode toggle, so
// workspace actions (save, history, mode) sit in one clean, consistent row.
export const IconButton: React.FC<{
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  primary?: boolean;
  danger?: boolean;
  testId?: string;
  children: React.ReactNode;
}> = ({ label, onClick, disabled, active, primary, danger, testId, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    aria-pressed={active}
    title={label}
    data-testid={testId}
    className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-40 ${
      primary
        ? 'bg-blue-600 text-white hover:bg-blue-700'
        : danger
          ? 'text-gray-400 hover:bg-red-50 hover:text-red-600'
          : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'
    }`}
  >
    {children}
  </button>
);
