import { gitSourceError } from './git-source-error';

describe('Git source public failure diagnostics', () => {
  it.each([
    [{ code: 'ENOENT' }, 'clone', 'GIT_UNAVAILABLE'],
    [{ killed: true, signal: 'SIGTERM' }, 'clone', 'GIT_TIMEOUT'],
    [{ code: 'ETIMEDOUT' }, 'checkout', 'GIT_TIMEOUT'],
    [{ stderr: 'fatal: repository not found' }, 'clone', 'GIT_ACCESS_FAILED'],
    [{ stderr: 'Authentication failed for repository' }, 'clone', 'GIT_ACCESS_FAILED'],
    [{ stderr: 'fatal: The requested URL returned error: 403' }, 'clone', 'GIT_ACCESS_FAILED'],
    [{ stderr: 'Cloning into repo403\nfatal: Could not resolve host github.com' }, 'clone', 'GIT_FETCH_FAILED'],
    [{ stderr: 'connection reset by peer' }, 'clone', 'GIT_FETCH_FAILED'],
    [{ stderr: 'could not read object' }, 'checkout', 'GIT_CHECKOUT_FAILED'],
  ])('classifies failure without exposing command output', (error, phase, code) => {
    const diagnostic = gitSourceError(error, phase as 'clone' | 'checkout', 'https://github.com/example/repo?token=secret#private');
    expect(diagnostic.code).toBe(code);
    expect(diagnostic.stage).toBe('fetching');
    expect(diagnostic.repository).toBe('https://github.com/example/repo');
    expect(diagnostic.message).not.toMatch(/secret|private|connection reset|could not read/);
  });

  it('does not expose credentials, command strings or local paths', () => {
    const error = gitSourceError({ message: 'git /tmp/private-repo secret', stderr: 'secret' }, 'clone', 'https://user:secret@github.com/example/repo?auth=secret');
    expect(JSON.stringify(error)).not.toMatch(/secret|user:|private-repo|auth=/);
    expect(error.message).toBe('Git repository could not be fetched');
  });
});
