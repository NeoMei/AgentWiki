// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { isLoopbackHttpUrl, resolveE2ETarget } from './localTargets';

describe('local target validation', () => {
  it.each([
    'http://localhost:5173',
    'http://localhost.:5173',
    'http://127.0.0.1:5173',
    'http://127.0.0.2:5173',
    'https://127.255.255.254:7443',
    'http://2130706433:5173',
    'http://0x7f000001:5173',
    'http://[::1]:5173',
  ])('recognizes the parsed IPv4/IPv6 loopback target %s', (target) => {
    expect(isLoopbackHttpUrl(target)).toBe(true);
    expect(resolveE2ETarget({ fallback: target, label: 'test target' })).toBe(target);
  });

  it.each([
    'http://localhost.evil.test:5173',
    'http://127.0.0.1.evil.test:5173',
    'http://127.0.0.1@evil.test:5173',
    'http://[::ffff:127.0.0.1]:5173',
    'http://0.0.0.0:5173',
    'ftp://127.0.0.1/resource',
  ])('rejects hostname/protocol bypass %s without remote opt-in', (target) => {
    expect(isLoopbackHttpUrl(target)).toBe(false);
    expect(() => resolveE2ETarget({ fallback: target, label: 'test target' })).toThrow();
  });

  it('requires HTTPS, exact lowercase opt-in, and an exact host confirmation for remote targets', () => {
    const remote = 'https://qa.example.test:7443';
    expect(() => resolveE2ETarget({ fallback: remote, allowRemote: 'TRUE', label: 'test target' }))
      .toThrow(/ALLOW_REMOTE_E2E=true/);
    expect(() => resolveE2ETarget({
      fallback: remote,
      allowRemote: 'true',
      label: 'test target',
    })).toThrow(/CONFIRM_REMOTE_E2E_HOST/);
    expect(() => resolveE2ETarget({
      fallback: remote,
      allowRemote: 'true',
      confirmRemoteHost: 'other.example.test',
      label: 'test target',
    })).toThrow(/confirmed host/);
    expect(() => resolveE2ETarget({
      fallback: 'http://qa.example.test:7443',
      allowRemote: 'true',
      confirmRemoteHost: 'qa.example.test',
      label: 'test target',
    })).toThrow(/HTTPS/);
    expect(resolveE2ETarget({
      fallback: remote,
      allowRemote: 'true',
      confirmRemoteHost: 'QA.EXAMPLE.TEST',
      label: 'test target',
    })).toBe(remote);
    expect(() => resolveE2ETarget({
      fallback: 'https://operator:secret@qa.example.test:7443',
      allowRemote: 'true',
      confirmRemoteHost: 'qa.example.test',
      label: 'test target',
    })).toThrowError(expect.not.stringMatching(/operator|secret|qa\.example/));
  });
});
