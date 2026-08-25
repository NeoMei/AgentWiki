import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { SavePageAsTemplateDialog } from './SavePageAsTemplateDialog';
import type { PageTemplateDetail } from './pageTemplateTypes';

const mocks = vi.hoisted(() => ({
  createPageTemplate: vi.fn(),
}));

vi.mock('./pageTemplateApi', () => ({
  createPageTemplate: mocks.createPageTemplate,
}));

const templateDetail: PageTemplateDetail = {
  id: 'template-1',
  scope: 'space',
  stableKey: 'team-weekly',
  category: 'reporting',
  name: '团队周报',
  description: '统一团队格式',
  defaultTitle: 'Weekly source',
  sourceLocale: 'zh-CN',
  currentVersion: 1,
  archivedAt: null,
  updatedAt: '2026-08-25T10:01:00.000Z',
  content: '# Weekly source',
  contentLocale: 'zh-CN',
  sourcePageId: 'page-1',
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const renderDialog = (overrides: Partial<React.ComponentProps<typeof SavePageAsTemplateDialog>> = {}) => {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(
    <LanguageProvider>
      <SavePageAsTemplateDialog
        spaceId="space-1"
        pageId="page-1"
        pageTitle="Weekly source"
        pageUpdatedAt="2026-08-25T10:00:00.000Z"
        returnFocusTo={null}
        onClose={onClose}
        onSaved={onSaved}
        {...overrides}
      />
    </LanguageProvider>,
  );
  return { onClose, onSaved };
};

describe('SavePageAsTemplateDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
  });

  it('saves the exact persisted page timestamp and source locale', async () => {
    mocks.createPageTemplate.mockResolvedValue(templateDetail);
    const { onSaved } = renderDialog();

    fireEvent.change(screen.getByLabelText('模板名称'), { target: { value: '团队周报' } });
    fireEvent.change(screen.getByLabelText('模板说明'), { target: { value: '统一团队格式' } });
    fireEvent.change(screen.getByLabelText('分类'), { target: { value: 'reporting' } });
    fireEvent.click(screen.getByRole('button', { name: '保存模板' }));

    await waitFor(() => expect(mocks.createPageTemplate).toHaveBeenCalledWith('space-1', {
      name: '团队周报',
      description: '统一团队格式',
      category: 'reporting',
      defaultTitle: 'Weekly source',
      locale: 'zh-CN',
      sourcePageId: 'page-1',
      expectedSourceUpdatedAt: '2026-08-25T10:00:00.000Z',
    }));
    expect(onSaved).toHaveBeenCalledWith(templateDetail);
  });

  it('keeps entered metadata after a conflict', async () => {
    mocks.createPageTemplate.mockRejectedValue({ response: { data: { code: 'PAGE_TEMPLATE_SOURCE_STALE' } } });
    renderDialog();

    fireEvent.change(screen.getByLabelText('模板名称'), { target: { value: 'My format' } });
    fireEvent.click(screen.getByRole('button', { name: '保存模板' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('源页面已变更，请重新打开后重试');
    expect(screen.getByLabelText('模板名称')).toHaveValue('My format');
  });

  it('locks closing and duplicate submissions while the create request is pending', async () => {
    const pending = deferred<PageTemplateDetail>();
    mocks.createPageTemplate.mockImplementation(() => pending.promise);
    const { onClose, onSaved } = renderDialog();
    const form = screen.getByLabelText('模板名称').closest('form')!;

    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(mocks.createPageTemplate).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存模板' })).toBeDisabled();

    await act(async () => pending.resolve(templateDetail));
    expect(onSaved).toHaveBeenCalledWith(templateDetail);
  });

  it('completes an asynchronous create during StrictMode effect remount checks', async () => {
    const onClose = vi.fn();
    const onSaved = vi.fn();
    mocks.createPageTemplate.mockResolvedValue(templateDetail);
    render(
      <StrictMode>
        <LanguageProvider>
          <SavePageAsTemplateDialog
            spaceId="space-1"
            pageId="page-1"
            pageTitle="Weekly source"
            pageUpdatedAt="2026-08-25T10:00:00.000Z"
            onClose={onClose}
            onSaved={onSaved}
          />
        </LanguageProvider>
      </StrictMode>,
    );

    fireEvent.click(screen.getByRole('button', { name: '保存模板' }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(templateDetail));
  });

  it.each([80, 81, 199, 200, 201])(
    'prefills a %i-character page title within the 80/200 UI limits',
    async (length) => {
      const pageTitle = 'x'.repeat(length);
      mocks.createPageTemplate.mockResolvedValue(templateDetail);
      renderDialog({ pageTitle });

      expect(screen.getByLabelText('模板名称')).toHaveValue('x'.repeat(Math.min(length, 80)));
      expect(screen.getByLabelText('默认页面标题')).toHaveValue('x'.repeat(Math.min(length, 200)));
      fireEvent.click(screen.getByRole('button', { name: '保存模板' }));

      await waitFor(() => expect(mocks.createPageTemplate).toHaveBeenCalledWith(
        'space-1',
        expect.objectContaining({
          name: 'x'.repeat(Math.min(length, 80)),
          defaultTitle: 'x'.repeat(Math.min(length, 200)),
        }),
      ));
    },
  );

  it('truncates Unicode text without splitting surrogate pairs and never submits over-limit metadata', async () => {
    const pageTitle = '😀'.repeat(201);
    mocks.createPageTemplate.mockResolvedValue(templateDetail);
    renderDialog({ pageTitle });
    const name = screen.getByLabelText('模板名称');
    const defaultTitle = screen.getByLabelText('默认页面标题');

    expect(Array.from((name as HTMLInputElement).value)).toHaveLength(80);
    expect(Array.from((defaultTitle as HTMLInputElement).value)).toHaveLength(200);
    expect((name as HTMLInputElement).value.endsWith('😀')).toBe(true);
    expect((defaultTitle as HTMLInputElement).value.endsWith('😀')).toBe(true);

    fireEvent.change(name, { target: { value: '界'.repeat(81) } });
    fireEvent.change(defaultTitle, { target: { value: '😀'.repeat(201) } });
    fireEvent.click(screen.getByRole('button', { name: '保存模板' }));

    await waitFor(() => expect(mocks.createPageTemplate).toHaveBeenCalledTimes(1));
    const input = mocks.createPageTemplate.mock.calls[0][1];
    expect(Array.from(input.name)).toHaveLength(80);
    expect(Array.from(input.defaultTitle)).toHaveLength(200);
    expect(input.defaultTitle.endsWith('😀')).toBe(true);
  });

  it('matches server length semantics for variation selectors on prefill and pasted input', async () => {
    const plane = '✈️';
    const pageTitle = `a${plane.repeat(200)}`;
    mocks.createPageTemplate.mockResolvedValue(templateDetail);
    renderDialog({ pageTitle });
    const name = screen.getByLabelText('模板名称');
    const defaultTitle = screen.getByLabelText('默认页面标题');

    expect(name).toHaveValue(`a${plane.repeat(79)}`);
    expect(defaultTitle).toHaveValue(`a${plane.repeat(199)}`);
    expect((name as HTMLInputElement).value.endsWith(plane)).toBe(true);
    expect((defaultTitle as HTMLInputElement).value.endsWith(plane)).toBe(true);
    expect(name).not.toHaveAttribute('maxlength');
    expect(defaultTitle).not.toHaveAttribute('maxlength');

    const pastedName = `b${plane.repeat(80)}`;
    fireEvent.paste(name, { clipboardData: { getData: () => pastedName } });
    fireEvent.input(name, { target: { value: pastedName } });
    expect(name).toHaveValue(`b${plane.repeat(79)}`);

    fireEvent.click(screen.getByRole('button', { name: '保存模板' }));
    await waitFor(() => expect(mocks.createPageTemplate).toHaveBeenCalledTimes(1));
    const input = mocks.createPageTemplate.mock.calls[0][1];
    expect(input.name).toBe(`b${plane.repeat(79)}`);
    expect(input.defaultTitle).toBe(`a${plane.repeat(199)}`);
  });

  it('counts consecutive variation selectors separately like validator.js', async () => {
    const selector = '\uFE0F';
    const pageTitle = `a${selector.repeat(81)}`;
    mocks.createPageTemplate.mockResolvedValue(templateDetail);
    renderDialog({ pageTitle });
    const name = screen.getByLabelText('模板名称');

    expect(name).toHaveValue(`a${selector.repeat(80)}`);
    fireEvent.click(screen.getByRole('button', { name: '保存模板' }));

    await waitFor(() => expect(mocks.createPageTemplate).toHaveBeenCalledTimes(1));
    expect(mocks.createPageTemplate.mock.calls[0][1].name).toBe(`a${selector.repeat(80)}`);
  });
});
