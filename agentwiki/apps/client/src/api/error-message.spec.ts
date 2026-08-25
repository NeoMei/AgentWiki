import { describe, expect, it } from 'vitest';
import { messages } from '../i18n/messages';
import { apiErrorMessage } from './error-message';

const t = (key: string) => ({
  'error.authInvalidCredentials': '邮箱或密码错误',
  'error.rateLimited': '请求过于频繁，请稍后再试',
  'error.changeSetConflict': '该来源页面已存在或内容已变化，请刷新后重试',
  'error.resourceConflict': '该项目与已有资源冲突',
  'auth.loginFailed': '登录失败',
}[key] || key);

describe('apiErrorMessage', () => {
  it('uses stable business codes instead of an English server message', () => {
    expect(apiErrorMessage({ response: { status: 401, data: {
      code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid credentials',
    } } }, t, 'auth.loginFailed')).toBe('邮箱或密码错误');
  });

  it('maps 429 without exposing its English payload', () => {
    expect(apiErrorMessage({ response: { status: 429, data: {
      message: 'Too many requests',
    } } }, t, 'auth.loginFailed')).toBe('请求过于频繁，请稍后再试');
  });

  it('maps a publishing conflict without exposing a database error', () => {
    expect(apiErrorMessage({ response: { status: 409, data: {
      code: 'CHANGESET_CONFLICT', message: 'Unique constraint failed',
    } } }, t, 'auth.loginFailed')).toBe('该来源页面已存在或内容已变化，请刷新后重试');
  });

  it('maps RESOURCE_CONFLICT without exposing the server message', () => {
    expect(apiErrorMessage({ response: { status: 409, data: {
      code: 'RESOURCE_CONFLICT', message: 'Onboarding resource recovery state is invalid',
    } } }, t, 'auth.loginFailed')).toBe('该项目与已有资源冲突');
  });

  it.each([
    ['PAGE_TEMPLATE_INVALID', 'pageTemplate.invalid', '页面模板输入无效'],
    ['PAGE_TEMPLATE_NOT_FOUND', 'pageTemplate.notFound', '模板不存在或无权访问'],
    ['PAGE_TEMPLATE_VERSION_NOT_FOUND', 'pageTemplate.versionNotFound', '指定的模板版本不存在'],
    ['PAGE_TEMPLATE_ARCHIVED', 'pageTemplate.archived', '该模板已归档，无法创建页面'],
    ['PAGE_TEMPLATE_SOURCE_INVALID', 'pageTemplate.sourceInvalid', '源页面不存在或不是 Markdown 页面'],
    ['PAGE_TEMPLATE_SYSTEM_IMMUTABLE', 'pageTemplate.systemImmutable', '系统模板不可修改'],
    ['PAGE_TEMPLATE_AGENT_UNSUPPORTED', 'pageTemplate.agentUnsupported', 'Agent 不能使用页面模板来源字段'],
    ['PAGE_TEMPLATE_PERMISSION_DENIED', 'pageTemplate.permissionDenied', '仅 Space 所有者或管理员可管理模板'],
    ['PAGE_TEMPLATE_NAME_CONFLICT', 'pageTemplate.nameConflict', '已有同名 Space 模板'],
    ['PAGE_TEMPLATE_VERSION_CONFLICT', 'pageTemplate.versionConflict', '模板已被其他人更新，请刷新后重试'],
    ['PAGE_TEMPLATE_SOURCE_STALE', 'pageTemplate.sourceStale', '源页面已变更，请重新打开后重试'],
    ['PAGE_TEMPLATE_QUOTA_EXCEEDED', 'pageTemplate.quotaExceeded', 'Space 最多可启用 100 个自定义模板'],
  ])('maps %s to translated copy', (code, key, expected) => {
    const translate = (messageKey: string) => messages['zh-CN'][messageKey] ?? messageKey;

    expect(apiErrorMessage({ response: { status: 400, data: { code } } }, translate, 'auth.loginFailed'))
      .toBe(expected);
    expect(translate(key)).toBe(expected);
  });
});
