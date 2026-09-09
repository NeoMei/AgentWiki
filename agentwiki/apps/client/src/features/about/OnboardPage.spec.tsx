import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider, useLanguage } from '../../context/LanguageContext';
import { OnboardPage } from './OnboardPage';

function renderPage(language: 'zh-CN'|'en') {
  localStorage.setItem('agentwiki.language.v1',language);
  return render(<MemoryRouter><LanguageProvider><OnboardPage /></LanguageProvider></MemoryRouter>);
}
describe('Agent connection steps guide',()=>{
  beforeEach(()=>{localStorage.clear();Object.assign(navigator,{clipboard:{writeText:vi.fn().mockResolvedValue(undefined)}});});
  it.each(['zh-CN','en'] as const)('copies the selected client and complete bounded JSON protocol in %s',async language=>{
    renderPage(language);
    const zh=language==='zh-CN';
    for(const [label,client] of [['Codex','codex'],['Claude Code','claude'],['OpenCode','opencode']]) {
      fireEvent.click(screen.getByRole('button',{name:label}));
      fireEvent.click(screen.getByRole('button',{name:zh?'复制提示词':'Copy prompt'}));
      await waitFor(()=>expect(navigator.clipboard.writeText).toHaveBeenCalled());
      const prompt=vi.mocked(navigator.clipboard.writeText).mock.calls.slice(-1)[0][0];
      expect(prompt).toContain(`@neomei/agentwiki-local-sync@0.10.0 onboard start --server '${window.location.origin}/api' --client ${client} --protocol json`);
      expect(prompt).toContain('onboard status --session');expect(prompt).toContain('onboard continue --session');
      expect(prompt).toContain('--reply-file');expect(prompt).toContain('0600');
      expect(prompt).toContain('authorizationUrl');expect(prompt).toContain('retryAfterMs');
      expect(prompt).toContain('requestId');expect(prompt).toContain('planHash');expect(prompt).toContain('confirmed');
      expect(prompt).toContain('spaceId');expect(prompt).toContain('connectionStatus');expect(prompt).toContain('hostVerification');
      expect(prompt).not.toContain('sourcePaths');expect(prompt).not.toContain('NDJSON');expect(prompt).not.toContain('stdin');
      expect(prompt).not.toContain('onboard resume');
    }
  });
  it.each(['zh-CN','en'] as const)('renews an expired session before reading the fresh authorization URL in %s', async language => {
    renderPage(language);
    fireEvent.click(screen.getByRole('button', {name: language === 'zh-CN' ? '复制提示词' : 'Copy prompt'}));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    const prompt = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0];
    const renewal = prompt.split('\n').find(line => line.startsWith('3.'))!;
    expect(renewal).toMatch(language === 'zh-CN'
      ? /authorization_expired.*不带 --reply-file.*continue.*authorization_required.*authorizationUrl/
      : /authorization_expired.*continue.*without --reply-file.*authorization_required.*authorizationUrl/);
  });
  it('does not claim the translated prompt was copied when only the prior locale reached the clipboard', async () => {
    localStorage.setItem('agentwiki.language.v1','zh-CN');
    const Switch = () => { const {toggleLanguage} = useLanguage(); return <button onClick={toggleLanguage}>Switch locale</button>; };
    render(<MemoryRouter><LanguageProvider><OnboardPage/><Switch/></LanguageProvider></MemoryRouter>);
    fireEvent.click(screen.getByRole('button',{name:'复制提示词'}));
    expect(await screen.findByRole('status')).toHaveTextContent('已复制');
    fireEvent.click(screen.getByRole('button',{name:'Switch locale'}));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Copy prompt'}));
    expect(await screen.findByRole('status')).toHaveTextContent('Copied');
    expect(vi.mocked(navigator.clipboard.writeText).mock.calls.slice(-1)[0][0]).toMatch(/^Connect this client/);
  });
  it('keeps source import optional and actual host reading separate from configuration',()=>{
    renderPage('zh-CN');
    expect(screen.getByText('知识导入可以稍后进行')).toBeInTheDocument();
    expect(screen.getByText('实际读取验证')).toBeInTheDocument();
    expect(screen.queryByText(/确认 Agent、Space、权限和本地扫描计划/)).not.toBeInTheDocument();
  });
  it('shows a copy failure with the full text available for manual selection',async()=>{
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('denied'));
    renderPage('zh-CN');fireEvent.click(screen.getByRole('button',{name:'复制提示词'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('手动复制');
  });
});
