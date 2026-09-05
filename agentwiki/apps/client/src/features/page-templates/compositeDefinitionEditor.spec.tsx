import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../context/LanguageContext';
import { validDefinition } from '../collaboration/collaboration-test-fixtures';
import {
  CompositeDefinitionEditor,
  definitionReferenceIssues,
  removeCompositeNode,
} from './CompositeDefinitionEditor';
import type { CompositeTemplateDefinition } from './compositeTemplateTypes';

const definition: CompositeTemplateDefinition = {
  schemaVersion: 1,
  kind: 'page_group',
  nodes: [
    { nodeId: 'root', parentNodeId: null, kind: 'folder', order: 0, nameI18n: { en: 'Root', 'zh-CN': '根目录' } },
    { nodeId: 'nested', parentNodeId: 'root', kind: 'folder', order: 0, nameI18n: { en: 'Nested' } },
    { nodeId: 'page-a', parentNodeId: 'nested', kind: 'page', order: 0, titleI18n: { en: 'Draft', 'zh-CN': '草稿' }, contentI18n: { en: '# saved', 'zh-CN': '# 已保存' }, roleSlotKey: 'writer' },
  ],
  collaboration: { workflow: validDefinition, taskTargets: [{ taskNodeId: 'draft', pageNodeId: 'page-a' }] },
};

describe('CompositeDefinitionEditor', () => {
  it('preserves stable nested IDs, parents, order, and non-active locale while editing a Page', () => {
    const onChange = vi.fn();
    render(<LanguageProvider><CompositeDefinitionEditor definition={definition} locale="en" onChange={onChange} /></LanguageProvider>);
    fireEvent.click(screen.getByRole('button', { name: /Draft page-a/ }));
    fireEvent.change(screen.getByLabelText('Page title page-a'), { target: { value: 'Updated draft' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      nodes: expect.arrayContaining([
        expect.objectContaining({ nodeId: 'nested', parentNodeId: 'root', order: 0 }),
        expect.objectContaining({
          nodeId: 'page-a', parentNodeId: 'nested', order: 0,
          titleI18n: { en: 'Updated draft', 'zh-CN': '草稿' }, contentI18n: { en: '# saved', 'zh-CN': '# 已保存' },
        }),
      ]),
    }));
  });

  it('reports dangling task targets and workflow dependencies instead of deleting referenced workflow facts', () => {
    const removed = removeCompositeNode(definition, 'page-a');
    expect(removed.collaboration?.workflow).toEqual(validDefinition);
    expect(removed.collaboration?.taskTargets).toEqual([{ taskNodeId: 'draft', pageNodeId: 'page-a' }]);
    expect(definitionReferenceIssues(removed)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'TEMPLATE_PAGE_TARGET_MISSING', nodeId: 'draft' }),
    ]));

    const review = {
      kind: 'human_review' as const, id: 'human-gate', name: 'Human gate', artifactTaskId: 'draft',
      minimumRole: 'editor' as const, reviewerUserIds: [], approvalCriteria: ['Review'],
      revisionTaskId: 'draft', allowTerminate: true,
    };
    const brokenWorkflow: CompositeTemplateDefinition = {
      ...definition,
      collaboration: {
        ...definition.collaboration!,
        workflow: { ...validDefinition, nodes: [...validDefinition.nodes.filter((node) => node.id !== 'draft'), review] },
      },
    };
    expect(definitionReferenceIssues(brokenWorkflow).map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'WORKFLOW_DEPENDENCY_MISSING', 'WORKFLOW_REVIEW_REFERENCE_MISSING', 'TEMPLATE_TASK_TARGET_MISSING',
    ]));
  });

  it('edits explicit task targets with real stable Page node IDs', () => {
    const sourcePage = definition.nodes[2] as Extract<CompositeTemplateDefinition['nodes'][number], { kind: 'page' }>;
    const secondPage: CompositeTemplateDefinition = {
      ...definition,
      nodes: [...definition.nodes, { ...sourcePage, nodeId: 'page-b', titleI18n: { en: 'Review' }, order: 1 }],
    };
    const onChange = vi.fn();
    render(<LanguageProvider><CompositeDefinitionEditor definition={secondPage} locale="en" onChange={onChange} /></LanguageProvider>);
    fireEvent.change(screen.getByLabelText('Target page for Draft'), { target: { value: 'page-b' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ collaboration: expect.objectContaining({
      taskTargets: [{ taskNodeId: 'draft', pageNodeId: 'page-b' }],
    }) }));
  });

  it('uses the active locale for Page choices while preserving other locales', () => {
    localStorage.setItem('agentwiki.language.v1', 'zh-CN');
    render(<LanguageProvider><CompositeDefinitionEditor definition={definition} locale="zh-CN" onChange={() => undefined} /></LanguageProvider>);

    expect(screen.getAllByRole('option', { name: '草稿 (page-a)' })).toHaveLength(2);
  });
});
