import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LanguageProvider, useLanguage } from '../context/LanguageContext';
import type { Language } from './messages';

const pageTemplateZhCN = {
  'pageTemplate.blank.name': '空白页面',
  'pageTemplate.blank.description': '从一个完全空白的页面开始',
  'pageTemplate.filter.all': '全部',
  'pageTemplate.filter.system': '系统模板',
  'pageTemplate.filter.space': 'Space 模板',
  'pageTemplate.category': '分类',
  'pageTemplate.category.planning': '计划管理',
  'pageTemplate.category.reporting': '汇报总结',
  'pageTemplate.category.knowledge': '知识沉淀',
  'pageTemplate.category.other': '其他',
  'pageTemplate.step.choose': '选择模板',
  'pageTemplate.step.details': '填写页面信息',
  'pageTemplate.selected': '已选择',
  'pageTemplate.scope.system': '系统',
  'pageTemplate.scope.space': 'Space',
  'pageTemplate.loadFailed': '模板加载失败，仍可创建空白页面',
  'pageTemplate.createFailed': '创建模板失败',
  'pageTemplate.updateMetadataFailed': '模板信息更新失败',
  'pageTemplate.createVersionFailed': '模板新版本创建失败',
  'pageTemplate.archiveFailed': '模板归档失败',
  'pageTemplate.restoreFailed': '模板恢复失败',
  'pageTemplate.retry': '重试',
  'pageTemplate.back': '上一步',
  'pageTemplate.next': '下一步',
  'pageTemplate.manage': '管理模板',
  'pageTemplate.settingsTitle': 'Space 页面模板',
  'pageTemplate.settingsDescription': '管理团队可复用的页面结构',
  'pageTemplate.activeCount': '已启用 {count}/100',
  'pageTemplate.search': '搜索模板',
  'pageTemplate.showArchived': '显示已归档模板',
  'pageTemplate.saveAs': '保存为 Space 模板',
  'pageTemplate.saveTemplate': '保存模板',
  'pageTemplate.updateFromPage': '从页面更新内容',
  'pageTemplate.createVersion': '创建新版本',
  'pageTemplate.archive': '归档',
  'pageTemplate.restore': '恢复',
  'pageTemplate.name': '模板名称',
  'pageTemplate.description': '模板说明',
  'pageTemplate.defaultTitle': '默认页面标题',
  'pageTemplate.sourcePage': '源页面',
  'pageTemplate.savePageFirst': '请先保存当前页面再创建模板。',
  'pageTemplate.markdownOnly': '仅 Markdown 页面可保存为模板',
  'pageTemplate.created': '模板已创建',
  'pageTemplate.updated': '模板已更新',
  'pageTemplate.noChange': '页面内容未变化，未创建新版本',
  'pageTemplate.invalid': '页面模板输入无效',
  'pageTemplate.notFound': '模板不存在或无权访问',
  'pageTemplate.versionNotFound': '指定的模板版本不存在',
  'pageTemplate.archived': '该模板已归档，无法创建页面',
  'pageTemplate.sourceInvalid': '源页面不存在或不是 Markdown 页面',
  'pageTemplate.systemImmutable': '系统模板不可修改',
  'pageTemplate.agentUnsupported': 'Agent 不能使用页面模板来源字段',
  'pageTemplate.permissionDenied': '仅 Space 所有者或管理员可管理模板',
  'pageTemplate.nameConflict': '已有同名 Space 模板',
  'pageTemplate.versionConflict': '模板已被其他人更新，请刷新后重试',
  'pageTemplate.sourceStale': '源页面已变更，请重新打开后重试',
  'pageTemplate.quotaExceeded': 'Space 最多可启用 100 个自定义模板',
} as const;

const pageTemplateEn = {
  'pageTemplate.blank.name': 'Blank page',
  'pageTemplate.blank.description': 'Start with a completely blank page',
  'pageTemplate.filter.all': 'All',
  'pageTemplate.filter.system': 'System templates',
  'pageTemplate.filter.space': 'Space templates',
  'pageTemplate.category': 'Category',
  'pageTemplate.category.planning': 'Planning',
  'pageTemplate.category.reporting': 'Reporting',
  'pageTemplate.category.knowledge': 'Knowledge',
  'pageTemplate.category.other': 'Other',
  'pageTemplate.step.choose': 'Choose a template',
  'pageTemplate.step.details': 'Page details',
  'pageTemplate.selected': 'Selected',
  'pageTemplate.scope.system': 'System',
  'pageTemplate.scope.space': 'Space',
  'pageTemplate.loadFailed': 'Templates could not be loaded. You can still create a blank page.',
  'pageTemplate.createFailed': 'Could not create the template',
  'pageTemplate.updateMetadataFailed': 'Could not update the template details',
  'pageTemplate.createVersionFailed': 'Could not create a new template version',
  'pageTemplate.archiveFailed': 'Could not archive the template',
  'pageTemplate.restoreFailed': 'Could not restore the template',
  'pageTemplate.retry': 'Retry',
  'pageTemplate.back': 'Back',
  'pageTemplate.next': 'Next',
  'pageTemplate.manage': 'Manage templates',
  'pageTemplate.settingsTitle': 'Space page templates',
  'pageTemplate.settingsDescription': 'Manage reusable page structures for your team',
  'pageTemplate.activeCount': '{count}/100 active',
  'pageTemplate.search': 'Search templates',
  'pageTemplate.showArchived': 'Show archived templates',
  'pageTemplate.saveAs': 'Save as Space template',
  'pageTemplate.saveTemplate': 'Save template',
  'pageTemplate.updateFromPage': 'Update content from page',
  'pageTemplate.createVersion': 'Create new version',
  'pageTemplate.archive': 'Archive',
  'pageTemplate.restore': 'Restore',
  'pageTemplate.name': 'Template name',
  'pageTemplate.description': 'Template description',
  'pageTemplate.defaultTitle': 'Default page title',
  'pageTemplate.sourcePage': 'Source page',
  'pageTemplate.savePageFirst': 'Save the page before creating a template.',
  'pageTemplate.markdownOnly': 'Only Markdown pages can be saved as templates',
  'pageTemplate.created': 'Template created',
  'pageTemplate.updated': 'Template updated',
  'pageTemplate.noChange': 'The page content is unchanged; no new version was created',
  'pageTemplate.invalid': 'The page template input is invalid',
  'pageTemplate.notFound': 'The template does not exist or is not accessible',
  'pageTemplate.versionNotFound': 'The requested template version does not exist',
  'pageTemplate.archived': 'This template is archived and cannot create pages',
  'pageTemplate.sourceInvalid': 'The source page does not exist or is not a Markdown page',
  'pageTemplate.systemImmutable': 'System templates cannot be changed',
  'pageTemplate.agentUnsupported': 'Agents cannot use page template source fields',
  'pageTemplate.permissionDenied': 'Only Space owners and admins can manage templates',
  'pageTemplate.nameConflict': 'A Space template already uses this name',
  'pageTemplate.versionConflict': 'This template changed. Reload and try again.',
  'pageTemplate.sourceStale': 'The source page changed. Reopen it and try again.',
  'pageTemplate.quotaExceeded': 'A Space can have at most 100 active custom templates',
} as const;

const copyCases = (Object.entries({ 'zh-CN': pageTemplateZhCN, en: pageTemplateEn }) as Array<[
  Language,
  Record<string, string>,
]>).flatMap(([language, copy]) => Object.entries(copy).map(([key, value]) => ({
  language,
  key,
  value,
})));

const Translation = ({ messageKey }: { messageKey: string }) => {
  const { t } = useLanguage();
  return <span data-testid="translation">{t(messageKey)}</span>;
};

describe('page-template bilingual copy contract', () => {
  it('contains exactly 57 contract keys per locale', () => {
    expect(Object.keys(pageTemplateZhCN)).toHaveLength(57);
    expect(Object.keys(pageTemplateEn)).toHaveLength(57);
    expect(Object.keys(pageTemplateZhCN)).toEqual(Object.keys(pageTemplateEn));
  });

  it.each(copyCases)('translates $language $key exactly', ({ language, key, value }) => {
    localStorage.setItem('agentwiki.language.v1', language);

    const result = render(
      <LanguageProvider><Translation messageKey={key} /></LanguageProvider>,
    );

    expect(result.getByTestId('translation').textContent).toBe(value);
  });
});
