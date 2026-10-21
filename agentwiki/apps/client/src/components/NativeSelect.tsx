import { forwardRef, type SelectHTMLAttributes } from 'react';
import './NativeSelect.css';

/** Native form semantics with one shared visual style. Use className for layout only. */
export const NativeSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function NativeSelect({ className, multiple, size, ...props }, ref) {
    const listbox = multiple || (size !== undefined && size > 1);
    return (
      <select
        {...props}
        ref={ref}
        multiple={multiple}
        size={size}
        className={['aw-select', listbox && 'aw-select--listbox', className].filter(Boolean).join(' ')}
      />
    );
  },
);
