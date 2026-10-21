import { createRef, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { NativeSelect } from './NativeSelect';

describe('NativeSelect', () => {
  afterEach(cleanup);

  it('keeps labelled form selection, change events and the forwarded focus target', () => {
    const ref = createRef<HTMLSelectElement>();
    function Form() {
      const [value, setValue] = useState('daily');
      return (
        <form aria-label="Create page">
          <label htmlFor="template">Template</label>
          <NativeSelect
            ref={ref}
            id="template"
            name="template"
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
            className="template-layout"
            data-source="user"
          >
            <option value="daily">Daily report</option>
            <option value="weekly">Weekly report</option>
          </NativeSelect>
        </form>
      );
    }
    render(<Form />);
    const select = screen.getByRole('combobox', { name: 'Template' });
    const form = screen.getByRole('form', { name: 'Create page' }) as HTMLFormElement;

    expect(select.parentElement).toBe(form);
    expect(select).toHaveClass('aw-select', 'template-layout');
    expect(select).toHaveAttribute('data-source', 'user');
    ref.current?.focus();
    expect(select).toHaveFocus();
    fireEvent.change(select, { target: { value: 'weekly' } });
    expect(select).toHaveValue('weekly');
    expect(new FormData(form).get('template')).toBe('weekly');
  });

  it('preserves native required validation and excludes disabled controls from submission', () => {
    const { rerender } = render(
      <form aria-label="Create page">
        <NativeSelect aria-label="Template" name="template" required defaultValue="">
          <option value="">Choose a template</option>
          <option value="daily">Daily report</option>
        </NativeSelect>
      </form>,
    );
    const form = screen.getByRole('form', { name: 'Create page' }) as HTMLFormElement;
    expect(form.checkValidity()).toBe(false);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'daily' } });
    expect(form.checkValidity()).toBe(true);

    rerender(
      <form aria-label="Create page">
        <NativeSelect aria-label="Template" name="template" disabled defaultValue="daily" aria-invalid="true">
          <option value="daily">Daily report</option>
        </NativeSelect>
      </form>,
    );
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-invalid', 'true');
    expect(new FormData(form).has('template')).toBe(false);
  });

  it('keeps multiple selection and size-based listboxes free of the single-select affordance', () => {
    const { rerender } = render(
      <form aria-label="Template choices">
        <NativeSelect aria-label="Templates" name="templates" multiple defaultValue={['daily', 'weekly']}>
          <option value="daily">Daily report</option>
          <option value="weekly">Weekly report</option>
        </NativeSelect>
      </form>,
    );
    expect(screen.getByRole('listbox')).toHaveClass('aw-select--listbox');
    expect(new FormData(screen.getByRole('form') as HTMLFormElement).getAll('templates')).toEqual(['daily', 'weekly']);

    rerender(<NativeSelect aria-label="Templates" size={3}><option>Daily report</option></NativeSelect>);
    expect(screen.getByRole('listbox')).toHaveClass('aw-select--listbox');
    rerender(<NativeSelect aria-label="Templates" size={1}><option>Daily report</option></NativeSelect>);
    expect(screen.getByLabelText('Templates')).not.toHaveClass('aw-select--listbox');
  });
});
