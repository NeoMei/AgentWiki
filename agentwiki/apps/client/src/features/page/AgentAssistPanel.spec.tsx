import {captureAssistTarget} from './assistTargets';
import {applyCandidateToDraft, type AssistCandidate} from './assistCandidate';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api/client';
import { useLanguage } from '../../context/LanguageContext';
import { AgentAssistPanel } from './AgentAssistPanel';

vi.mock('../../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
vi.mock('../../context/LanguageContext', () => ({ useLanguage: vi.fn() }));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1', name: 'QA' } }),
}));

const socketMock = vi.hoisted(() => {
  const handlers = new Map<string, (data: any) => void>();
  return {
    handlers,
    socket: {
      on: vi.fn((event: string, handler: (data: any) => void) => { handlers.set(event, handler); }),
      emit: vi.fn(),
      disconnect: vi.fn(),
    },
  };
});
vi.mock('socket.io-client', () => ({ io: () => socketMock.socket }));

const successfulTask = {
  id: 'task-done',
  intent: 'Improve this page',
  status: 'done',
  result: {
    changes: '# Improved',
    model: 'opencode/big-pickle',
    modelTier: 'free',
    attemptCount: 2,
    usage: { total: 8648 },
    cost: 0,
  },
};

const renderPanel = (props: { onApply?: (candidate: any) => boolean } = {}) => render(
  <AgentAssistPanel
    pageId="page-1"
    pageTitle="Page"
    spaceId="space-1"
    snapshot={() => ({ title: 'Page', content: 'Content' })}
    onApply={props.onApply}
  />,
);

describe('AgentAssistPanel routing metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    socketMock.handlers.clear();
    vi.mocked(api.get).mockImplementation((url) => {
      if (url === '/assist/tasks') return Promise.resolve({ data: [successfulTask] });
      if (url === '/review') return Promise.resolve({ data: [] });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });
  });

  afterEach(cleanup);

  it('hides the provider model name and shows a friendly completion label in English', async () => {
    vi.mocked(useLanguage).mockReturnValue({ language: 'en' } as ReturnType<typeof useLanguage>);

    renderPanel();

    expect(await screen.findByText('Generated')).toBeInTheDocument();
    // The raw provider model name must never be visible to the user.
    expect(screen.queryByText(/opencode|big-pickle|free|paid|tokens|\$\d/u))
      .not.toBeInTheDocument();
  });

  it('shows historical completed tasks without applying them', async () => {
    vi.mocked(useLanguage).mockReturnValue({ language: 'en' } as ReturnType<typeof useLanguage>);
    const onApply = vi.fn();
    renderPanel({ onApply });
    expect(await screen.findByText('Generated')).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('stages completion until explicit acceptance and applies only once', async () => {
    vi.mocked(useLanguage).mockReturnValue({ language: 'en' } as ReturnType<typeof useLanguage>);
    const onApply = vi.fn(() => true);
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'task-new', status: 'queued' } });
    vi.mocked(api.get).mockImplementation((url) => Promise.resolve({
      data: url === '/assist/tasks' ? [{ ...successfulTask, id: 'task-new' }] : [],
    }));
    renderPanel({ onApply });
    await screen.findByText('Generated');
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('assist-intent'), { target: { value: 'Rewrite' } });
    fireEvent.click(screen.getByTestId('assist-submit'));
    const accept = await screen.findByRole('button', { name: 'Accept to draft' });
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(accept);
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ content: '# Improved', baseContent: 'Content', pageId: 'page-1', spaceId: 'space-1', taskId: 'task-new' }));
    fireEvent.click(screen.getByLabelText('refresh'));
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
  });

  it('does not stream historical or collaborator tasks into the editor', async () => {
    vi.mocked(useLanguage).mockReturnValue({ language: 'en' } as ReturnType<typeof useLanguage>);
    const onApply = vi.fn(() => true);
    render(<AgentAssistPanel
      pageId="page-1"
      pageTitle="Page"
      spaceId="space-1"
      snapshot={() => ({ title: 'Page', content: 'Content' })}
      onApply={onApply}
    />);
    await screen.findByText('Generated');

    act(() => socketMock.handlers.get('assistStream')?.({
      taskId: 'task-done',
      chunk: '📝 生成: {"changes":"# Stale collaborator content"}',
    }));

    expect(onApply).not.toHaveBeenCalled();
  });

  it('keeps submitted streams and failures in the panel without applying a partial draft', async () => {
    vi.mocked(useLanguage).mockReturnValue({ language: 'en' } as ReturnType<typeof useLanguage>);
    const onApply = vi.fn(() => true);
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'task-new' } });
    vi.mocked(api.get).mockImplementation((url) => Promise.resolve({ data: url === '/assist/tasks' ? [{ id: 'task-new', status: 'running', intent: 'Rewrite' }] : [] }));
    renderPanel({ onApply });
    fireEvent.change(screen.getByTestId('assist-intent'), { target: { value: 'Rewrite' } });
    fireEvent.click(screen.getByTestId('assist-submit'));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('assist-submit')).toHaveTextContent('Run task'));
    act(() => socketMock.handlers.get('assistStream')?.({ taskId: 'task-new', chunk: '📝 生成: {"changes":"# Partial"}' }));
    expect(screen.getByText('# Partial')).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
    act(() => socketMock.handlers.get('assistError')?.({ taskId: 'task-new', error: 'provider authentication detail' }));
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Accept to draft' })).not.toBeInTheDocument();
    expect(screen.queryByText(/provider authentication/)).not.toBeInTheDocument();
  });

  it('captures the submitted snapshot and refuses acceptance after concurrent typing', async () => {
    vi.mocked(useLanguage).mockReturnValue({ language: 'en' } as ReturnType<typeof useLanguage>);
    let draft = 'Content';
    const onApply = vi.fn(() => true);
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'task-new' } });
    vi.mocked(api.get).mockImplementation((url) => Promise.resolve({ data: url === '/assist/tasks' ? [{ ...successfulTask, id: 'task-new' }] : [] }));
    render(<AgentAssistPanel pageId="page-1" pageTitle="Page" spaceId="space-1" snapshot={() => ({ title: 'Page', content: draft, updatedAt: 'v1' })} onApply={onApply} />);
    fireEvent.change(screen.getByTestId('assist-intent'), { target: { value: 'Rewrite' } });
    fireEvent.click(screen.getByTestId('assist-submit'));
    const accept = await screen.findByRole('button', { name: 'Accept to draft' });
    draft = 'Human draft';
    fireEvent.click(accept);
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/changed.*regenerate/i);
    expect(draft).toBe('Human draft');
    expect(api.post).toHaveBeenCalledWith('/assist/tasks', expect.objectContaining({ snapshot: { title: 'Page', content: 'Content', updatedAt: 'v1' } }));
  });

  it('discards a candidate permanently across repeated completion events', async () => {
    vi.mocked(useLanguage).mockReturnValue({ language: 'en' } as ReturnType<typeof useLanguage>);
    const onApply = vi.fn(() => true);
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'task-new' } });
    vi.mocked(api.get).mockImplementation((url) => Promise.resolve({ data: url === '/assist/tasks' ? [{ ...successfulTask, id: 'task-new' }] : [] }));
    renderPanel({ onApply });
    fireEvent.change(screen.getByTestId('assist-intent'), { target: { value: 'Rewrite' } });
    fireEvent.click(screen.getByTestId('assist-submit'));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    act(() => socketMock.handlers.get('assistComplete')?.({ taskId: 'task-new' }));
    await screen.findByText('Discarded');
    expect(screen.queryByRole('button', { name: 'Accept to draft' })).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('invalidates a candidate permanently after permission loss even when access returns', async () => {
    vi.mocked(useLanguage).mockReturnValue({ language: 'en' } as ReturnType<typeof useLanguage>);
    const onApply = vi.fn(() => true);
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'task-new' } });
    vi.mocked(api.get).mockImplementation((url) => Promise.resolve({ data: url === '/assist/tasks' ? [{ ...successfulTask, id: 'task-new' }] : [] }));
    const props = { pageId: 'page-1', pageTitle: 'Page', spaceId: 'space-1', snapshot: () => ({ title: 'Page', content: 'Content', updatedAt: 'v1' }), onApply };
    const view = render(<AgentAssistPanel {...props} canEdit />);
    fireEvent.change(screen.getByTestId('assist-intent'), { target: { value: 'Rewrite' } });
    fireEvent.click(screen.getByTestId('assist-submit'));
    await screen.findByRole('button', { name: 'Accept to draft' });
    view.rerender(<AgentAssistPanel {...props} canEdit={false} />);
    view.rerender(<AgentAssistPanel {...props} canEdit />);
    expect(screen.getByRole('button', { name: 'Accept to draft' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/permissions.*regenerate/i);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('does not attach a delayed submission to another page or a returned visit', async () => {
    vi.mocked(useLanguage).mockReturnValue({ language: 'en' } as ReturnType<typeof useLanguage>);
    let resolve!: (value: any) => void;
    vi.mocked(api.post).mockReturnValue(new Promise((done) => { resolve = done; }));
    vi.mocked(api.get).mockImplementation(() => Promise.resolve({ data: [] }));
    const onApply = vi.fn(() => true);
    const props = { pageTitle: 'Page', spaceId: 'space-1', snapshot: () => ({ title: 'Page', content: 'Content' }), onApply };
    const view = render(<AgentAssistPanel {...props} pageId="page-1" />);
    fireEvent.change(screen.getByTestId('assist-intent'), { target: { value: 'Rewrite' } });
    fireEvent.click(screen.getByTestId('assist-submit'));
    view.rerender(<AgentAssistPanel {...props} pageId="page-2" />);
    view.rerender(<AgentAssistPanel {...props} pageId="page-1" />);
    vi.mocked(api.get).mockImplementation((url) => Promise.resolve({ data: url === '/assist/tasks' ? [{ ...successfulTask, id: 'task-new' }] : [] }));
    await act(async () => resolve({ data: { id: 'task-new' } }));
    fireEvent.click(screen.getByLabelText('refresh'));
    await screen.findByText('Generated');
    expect(screen.queryByRole('button', { name: 'Accept to draft' })).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('can start a fresh task after a submission is invalidated by permission loss', async () => {
    vi.mocked(useLanguage).mockReturnValue({ language: 'en' } as ReturnType<typeof useLanguage>);
    let resolve!: (value: any) => void;
    vi.mocked(api.post).mockReturnValue(new Promise((done) => { resolve = done; }));
    vi.mocked(api.get).mockImplementation(() => Promise.resolve({ data: [] }));
    const props = { pageId: 'page-1', pageTitle: 'Page', spaceId: 'space-1', snapshot: () => ({ title: 'Page', content: 'Content' }), onApply: vi.fn(() => true) };
    const view = render(<AgentAssistPanel {...props} canEdit />);
    fireEvent.change(screen.getByTestId('assist-intent'), { target: { value: 'Rewrite' } });
    fireEvent.click(screen.getByTestId('assist-submit'));
    view.rerender(<AgentAssistPanel {...props} canEdit={false} />);
    view.rerender(<AgentAssistPanel {...props} canEdit />);
    await act(async () => resolve({ data: { id: 'stale' } }));
    expect(screen.getByTestId('assist-submit')).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Accept to draft' })).not.toBeInTheDocument();
  });

  it.each([
    ['en', 'Could not submit the task. Your draft is unchanged. Please retry.'],
    ['zh-CN', '任务提交失败，草稿未改动。请重试。'],
  ])('shows sanitized submission feedback in %s and retains intent for a successful retry', async (language, message) => {
    vi.mocked(useLanguage).mockReturnValue({ language } as ReturnType<typeof useLanguage>);
    vi.mocked(api.get).mockImplementation(() => Promise.resolve({ data: [] }));
    vi.mocked(api.post).mockRejectedValueOnce({ response: { data: { message: 'provider token sk-fake-secret' } } })
      .mockResolvedValueOnce({ data: { id: 'retry-task' } });
    const onApply = vi.fn(() => true);
    renderPanel({ onApply });
    fireEvent.change(screen.getByTestId('assist-intent'), { target: { value: 'Rewrite this draft' } });
    fireEvent.click(screen.getByTestId('assist-submit'));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByText(/sk-fake-secret|provider token/)).not.toBeInTheDocument();
    expect(screen.getByTestId('assist-intent')).toHaveValue('Rewrite this draft');
    expect(screen.getByTestId('assist-submit')).toBeEnabled();
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('assist-submit'));
    await waitFor(() => expect(screen.getByTestId('assist-intent')).toHaveValue(''));
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it.each(['navigation', 'permission'] as const)('does not surface delayed submission failures from an old %s generation', async (transition) => {
    vi.mocked(useLanguage).mockReturnValue({ language: 'en' } as ReturnType<typeof useLanguage>);
    vi.mocked(api.get).mockImplementation(() => Promise.resolve({ data: [] }));
    let reject!: (reason: unknown) => void;
    vi.mocked(api.post).mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
    const props = { pageTitle: 'Page', spaceId: 'space-1', snapshot: () => ({ title: 'Page', content: 'Content' }), onApply: vi.fn(() => true) };
    const view = render(<AgentAssistPanel {...props} pageId="page-1" canEdit />);
    fireEvent.change(screen.getByTestId('assist-intent'), { target: { value: 'Rewrite' } });
    fireEvent.click(screen.getByTestId('assist-submit'));
    if (transition === 'navigation') {
      view.rerender(<AgentAssistPanel {...props} pageId="page-2" canEdit />);
      view.rerender(<AgentAssistPanel {...props} pageId="page-1" canEdit />);
    } else {
      view.rerender(<AgentAssistPanel {...props} pageId="page-1" canEdit={false} />);
      view.rerender(<AgentAssistPanel {...props} pageId="page-1" canEdit />);
    }
    await act(async () => reject(new Error('provider token sk-fake-secret')));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(props.onApply).not.toHaveBeenCalled();
  });

  it.each(['navigation', 'permission'] as const)('clears an existing submission error on a %s generation change', async (transition) => {
    vi.mocked(useLanguage).mockReturnValue({ language: 'en' } as ReturnType<typeof useLanguage>);
    vi.mocked(api.get).mockImplementation(() => Promise.resolve({ data: [] }));
    vi.mocked(api.post).mockRejectedValue(new Error('request failed'));
    const props = { pageTitle: 'Page', spaceId: 'space-1', snapshot: () => ({ title: 'Page', content: 'Content' }) };
    const view = render(<AgentAssistPanel {...props} pageId="page-1" canEdit />);
    fireEvent.change(screen.getByTestId('assist-intent'), { target: { value: 'Rewrite' } });
    fireEvent.click(screen.getByTestId('assist-submit'));
    await screen.findByRole('alert');
    view.rerender(<AgentAssistPanel {...props} pageId={transition === 'navigation' ? 'page-2' : 'page-1'} canEdit={transition !== 'permission'} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    view.rerender(<AgentAssistPanel {...props} pageId="page-1" canEdit />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('never accepts an empty completion', async () => {
    vi.mocked(useLanguage).mockReturnValue({ language: 'en' } as ReturnType<typeof useLanguage>);
    const onApply = vi.fn(() => true);
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'task-new' } });
    vi.mocked(api.get).mockImplementation((url) => Promise.resolve({ data: url === '/assist/tasks' ? [{ ...successfulTask, id: 'task-new', result: { changes: '' } }] : [] }));
    renderPanel({ onApply });
    fireEvent.change(screen.getByTestId('assist-intent'), { target: { value: 'Rewrite' } });
    fireEvent.click(screen.getByTestId('assist-submit'));
    expect(await screen.findByRole('alert')).toHaveTextContent('no usable content');
    expect(screen.queryByRole('button', { name: 'Accept to draft' })).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it.each([{ spaceId: 'space-2', pageId: 'page-1' }, { spaceId: 'space-1', pageId: 'page-2' }])('invalidates candidate when scoped identity changes to %j', async (identity) => {
    vi.mocked(useLanguage).mockReturnValue({ language: 'en' } as ReturnType<typeof useLanguage>);
    const onApply = vi.fn(() => true);
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'task-new' } });
    vi.mocked(api.get).mockImplementation((url) => Promise.resolve({ data: url === '/assist/tasks' ? [{ ...successfulTask, id: 'task-new' }] : [] }));
    const props = { pageTitle: 'Page', snapshot: () => ({ title: 'Page', content: 'Content' }), onApply };
    const view = render(<AgentAssistPanel {...props} pageId="page-1" spaceId="space-1" />);
    fireEvent.change(screen.getByTestId('assist-intent'), { target: { value: 'Rewrite' } });
    fireEvent.click(screen.getByTestId('assist-submit'));
    await screen.findByRole('button', { name: 'Accept to draft' });
    view.rerender(<AgentAssistPanel {...props} {...identity} />);
    expect(screen.queryByRole('button', { name: 'Accept to draft' })).not.toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('hides the provider model name and shows a friendly completion label in Chinese', async () => {
    vi.mocked(useLanguage).mockReturnValue({ language: 'zh-CN' } as ReturnType<typeof useLanguage>);

    renderPanel();

    expect(await screen.findByText('已生成')).toBeInTheDocument();
    expect(screen.queryByText(/opencode|big-pickle|免费|付费|tokens/u))
      .not.toBeInTheDocument();
  });

  it('shows a friendly error message without raw provider details or codes', async () => {
    vi.mocked(useLanguage).mockReturnValue({ language: 'en' } as ReturnType<typeof useLanguage>);
    vi.mocked(api.get).mockImplementation((url) => {
      if (url === '/assist/tasks') return Promise.resolve({ data: [{
        id: 'task-failed',
        intent: 'Improve this page',
        status: 'failed',
        error: 'provider response with sk-fake-secret',
        result: {
          model: 'provider/paid-model',
          modelTier: 'paid',
          attemptCount: 1,
          usage: { total: 12 },
          cost: 0.5,
          attempts: [{ errorCode: 'binary_unavailable' }],
          raw: 'raw authentication detail',
        },
      }] });
      if (url === '/review') return Promise.resolve({ data: [] });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    });

    renderPanel();

    // A friendly message is shown instead of the raw error code.
    expect(await screen.findByText('Assistant temporarily unavailable, please retry'))
      .toBeInTheDocument();
    // Raw provider details, model names, costs, and error codes are never exposed.
    expect(screen.queryByText(/provider|paid-model|Paid|tokens|\$0\.5|binary_unavailable|auth_failed|raw authentication/u))
      .not.toBeInTheDocument();
  });
});

describe('scoped panel contracts', () => {
  beforeEach(() => { vi.clearAllMocks(); socketMock.handlers.clear(); vi.mocked(useLanguage).mockReturnValue({language:'en'} as ReturnType<typeof useLanguage>); });
  afterEach(cleanup);
  const version='2026-10-06T00:00:00Z', base='one\nkeep\ntwo\n';
  it('transmits the exact target and note linkage, emits readiness without resolving, and accepts hunks once', async () => {
    let draft=base; const events=vi.fn();
    vi.mocked(api.post).mockResolvedValue({data:{id:'scoped'}});
    vi.mocked(api.get).mockImplementation(async(url)=>({data:url==='/assist/tasks'?[{...successfulTask,id:'scoped',result:{...successfulTask.result,changes:'ONE\nkeep\nTWO\n'}}]:[]}));
    const target=captureAssistTarget(base,'document',0,0,version)!;
    const onApply=vi.fn((candidate: AssistCandidate, editId?: string)=>{const result=applyCandidateToDraft(candidate,{pageId:'page-1',spaceId:'space-1',userId:'user-1',canEdit:true,title:'Page',content:draft,updatedAt:version},editId);if(result.status!=='applied')return false;draft=result.content;return true;});
    render(<AgentAssistPanel pageId="page-1" pageTitle="Page" spaceId="space-1" snapshot={()=>({title:'Page',content:draft,updatedAt:version})} supportsScopedApply onApply={onApply} assistRequest={{id:'notes-1',intent:'Please fix both',assistTarget:target,noteIds:['note-1']}} onNotesEvent={events} />);
    fireEvent.click(screen.getByTestId('assist-submit'));
    await screen.findByRole('button',{name:'Accept change 1'});
    expect(api.post).toHaveBeenCalledWith('/assist/tasks',expect.objectContaining({snapshot:{title:'Page',content:base,updatedAt:version,assistTarget:target}}));
    expect(events).toHaveBeenCalledWith(expect.objectContaining({event:'dispatch',taskId:'scoped',noteIds:['note-1']}));
    expect(events).toHaveBeenCalledWith(expect.objectContaining({event:'ready',taskId:'scoped'}));
    expect(events.mock.calls.some(([e])=>e.event==='accept')).toBe(false); expect(draft).toBe(base);
    fireEvent.click(screen.getByRole('button',{name:'Accept change 1'})); expect(draft).toBe('ONE\nkeep\ntwo\n');
    fireEvent.click(screen.getByRole('button',{name:'Accept change 1'})); expect(onApply).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button',{name:'Accept change 2'})); expect(draft).toBe('ONE\nkeep\nTWO\n');
    expect(events).toHaveBeenCalledWith(expect.objectContaining({event:'accept',editId:'edit-2',acceptedEditIds:['edit-1','edit-2']}));
  });
  it('never invokes old parent for a scoped candidate, or submits a stale target', async () => {
    const target=captureAssistTarget(base,'selection',0,3,version)!;const onApply=vi.fn(()=>true);
    vi.mocked(api.post).mockResolvedValue({data:{id:'scoped'}});vi.mocked(api.get).mockImplementation(async(url)=>({data:url==='/assist/tasks'?[{...successfulTask,id:'scoped',result:{...successfulTask.result,changes:'ONE\nkeep\ntwo\n'}}]:[]}));
    render(<AgentAssistPanel pageId="page-1" pageTitle="Page" spaceId="space-1" snapshot={()=>({title:'Page',content:base,updatedAt:version})} onApply={onApply} assistRequest={{id:'scope',intent:'Fix',assistTarget:target}} />);
    fireEvent.click(screen.getByTestId('assist-submit'));
    expect(await screen.findByRole('button',{name:'Accept to draft'})).toBeDisabled();expect(onApply).not.toHaveBeenCalled();
  });
  it('retains notes on failed send and emits fail/discard for matching tasks only', async () => {
    const events=vi.fn();vi.mocked(api.post).mockRejectedValue(new Error('failed'));vi.mocked(api.get).mockResolvedValue({data:[]});
    render(<AgentAssistPanel pageId="page-1" pageTitle="Page" spaceId="space-1" snapshot={()=>({title:'Page',content:base,updatedAt:version})} assistRequest={{id:'n',intent:'Fix',noteIds:['n']}} onNotesEvent={events} />);
    fireEvent.click(screen.getByTestId('assist-submit'));await screen.findByRole('alert');expect(events).not.toHaveBeenCalled();expect(screen.getByTestId('assist-intent')).toHaveValue('Fix');
  });
});

describe('scoped panel refusal and note recovery', () => {
  const version='2026-10-06T00:00:00Z', base='before\nquote\nafter';
  beforeEach(()=>{vi.clearAllMocks();socketMock.handlers.clear();vi.mocked(useLanguage).mockReturnValue({language:'en'} as ReturnType<typeof useLanguage>);});
  afterEach(cleanup);
  it('refuses a stale selected quote before sending and retains its note request', async () => {
    const handled=vi.fn();vi.mocked(api.get).mockResolvedValue({data:[]});
    render(<AgentAssistPanel pageId="page-1" pageTitle="Page" spaceId="space-1" snapshot={()=>({title:'Page',content:'changed',updatedAt:version})} assistRequest={{id:'n',intent:'Fix',assistTarget:captureAssistTarget(base,'selection',7,12,version)!,noteIds:['n']}} onRequestHandled={handled} />);
    fireEvent.click(screen.getByTestId('assist-submit'));await screen.findByRole('alert');expect(api.post).not.toHaveBeenCalled();expect(handled).not.toHaveBeenCalled();
  });
  it.each(['discard','fail'] as const)('reopens linked notes on %s without applying source', async(event)=>{
    const events=vi.fn(),onApply=vi.fn(()=>true);vi.mocked(api.post).mockResolvedValue({data:{id:'scoped'}});
    vi.mocked(api.get).mockImplementation(async(url)=>({data:url==='/assist/tasks'?[{...successfulTask,id:'scoped',result:{...successfulTask.result,changes:'before\nnew\nafter'}}]:[]}));
    render(<AgentAssistPanel pageId="page-1" pageTitle="Page" spaceId="space-1" supportsScopedApply snapshot={()=>({title:'Page',content:base,updatedAt:version})} onApply={onApply} assistRequest={{id:'n',intent:'Fix',assistTarget:captureAssistTarget(base,'selection',7,12,version)!,noteIds:['n']}} onNotesEvent={events} />);
    fireEvent.click(screen.getByTestId('assist-submit'));await screen.findByRole('button',{name:'Accept to draft'});
    if(event==='discard')fireEvent.click(screen.getByRole('button',{name:'Discard'}));
    else {onApply.mockReturnValue(false);fireEvent.click(screen.getByRole('button',{name:'Accept to draft'}));}
    expect(events).toHaveBeenCalledWith(expect.objectContaining({event,taskId:'scoped',noteIds:['n']}));
    expect(events.mock.calls.some(([e])=>e.event==='accept')).toBe(false);
    act(()=>socketMock.handlers.get('assistComplete')?.({taskId:'scoped'}));
    expect(screen.queryByRole('button',{name:'Accept change 1'})).toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Accept change 1'})).toBeDisabled();
  });
  it('fails a candidate changing outside the target without accepting linked notes',async()=>{
    const events=vi.fn(),onApply=vi.fn(()=>true);vi.mocked(api.post).mockResolvedValue({data:{id:'scoped'}});
    vi.mocked(api.get).mockImplementation(async(url)=>({data:url==='/assist/tasks'?[{...successfulTask,id:'scoped',result:{...successfulTask.result,changes:'OUTSIDE\nnew\nafter'}}]:[]}));
    render(<AgentAssistPanel pageId="page-1" pageTitle="Page" spaceId="space-1" supportsScopedApply snapshot={()=>({title:'Page',content:base,updatedAt:version})} onApply={onApply} assistRequest={{id:'n',intent:'Fix',assistTarget:captureAssistTarget(base,'selection',7,12,version)!,noteIds:['n']}} onNotesEvent={events} />);
    fireEvent.click(screen.getByTestId('assist-submit'));await screen.findByRole('alert');expect(onApply).not.toHaveBeenCalled();expect(events).toHaveBeenCalledWith(expect.objectContaining({event:'fail'}));
  });
});
