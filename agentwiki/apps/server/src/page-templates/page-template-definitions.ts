import { PageTemplateCategory } from '@prisma/client';
import { z } from 'zod';
import { deepFreeze, LocalizedValueSchema, systemLocalizedValue } from './page-template.types';

const BUILT_IN_PAGE_TEMPLATE_CATEGORY_VALUES = [
  PageTemplateCategory.planning,
  PageTemplateCategory.reporting,
  PageTemplateCategory.knowledge,
] as const satisfies readonly PageTemplateCategory[];

export const BuiltInPageTemplateCategorySchema = z.enum(BUILT_IN_PAGE_TEMPLATE_CATEGORY_VALUES);
export type BuiltInPageTemplateCategory = z.infer<typeof BuiltInPageTemplateCategorySchema>;

const SeedSchema = z.object({
  stableKey: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  category: BuiltInPageTemplateCategorySchema,
  displayOrder: z.number().int().min(1),
  seedVersion: z.number().int().min(1),
  name: LocalizedValueSchema,
  description: LocalizedValueSchema,
  defaultTitle: LocalizedValueSchema,
  content: LocalizedValueSchema,
}).strict();

export type BuiltInPageTemplate = Readonly<{
  stableKey: string;
  category: BuiltInPageTemplateCategory;
  displayOrder: number;
  seedVersion: number;
  name: Readonly<{ 'zh-CN': string; en: string }>;
  description: Readonly<{ 'zh-CN': string; en: string }>;
  defaultTitle: Readonly<{ 'zh-CN': string; en: string }>;
  content: Readonly<{ 'zh-CN': string; en: string }>;
}>;

const defineSeed = (input: unknown): BuiltInPageTemplate => {
  const parsed = SeedSchema.parse(structuredClone(input));
  return deepFreeze({
    ...parsed,
    name: systemLocalizedValue(parsed.name),
    description: systemLocalizedValue(parsed.description),
    defaultTitle: systemLocalizedValue(parsed.defaultTitle),
    content: systemLocalizedValue(parsed.content),
  });
};

export const BUILT_IN_PAGE_TEMPLATES = deepFreeze([
  defineSeed({
    stableKey: 'task-list', category: PageTemplateCategory.planning, displayOrder: 1, seedVersion: 1,
    name: { 'zh-CN': '任务清单', en: 'Task list' },
    description: { 'zh-CN': '按优先级组织待办、阻塞与已完成事项', en: 'Organize priorities, open tasks, blockers, and completed work' },
    defaultTitle: { 'zh-CN': '任务清单', en: 'Task list' },
    content: {
      'zh-CN': '# 任务清单\n\n## 工作目标\n- \n\n## 最高优先级\n- [ ] \n\n## 待办任务\n- [ ] \n\n## 等待 / 阻塞\n- \n\n## 已完成\n- [x] ',
      en: '# Task list\n\n## Objective\n- \n\n## Top priority\n- [ ] \n\n## Open tasks\n- [ ] \n\n## Waiting / blocked\n- \n\n## Completed\n- [x] ',
    },
  }),
  defineSeed({
    stableKey: 'project-management', category: PageTemplateCategory.planning, displayOrder: 2, seedVersion: 1,
    name: { 'zh-CN': '项目管理', en: 'Project management' },
    description: { 'zh-CN': '汇总项目目标、里程碑、任务、风险与决策', en: 'Track goals, milestones, tasks, risks, and decisions' },
    defaultTitle: { 'zh-CN': '项目名称', en: 'Project name' },
    content: {
      'zh-CN': '# 项目名称\n\n## 项目概况\n\n| 项目状态 | 负责人 | 开始日期 | 目标日期 |\n|---|---|---|---|\n| 规划中 | 待填写 | YYYY-MM-DD | YYYY-MM-DD |\n\n## 目标\n- \n\n## 不做\n- \n\n## 里程碑\n\n| 里程碑 | 负责人 | 截止日期 | 状态 |\n|---|---|---|---|\n|  |  |  | 未开始 |\n\n## 当前任务\n- [ ] \n\n## 风险与阻塞\n- \n\n## 关键决策\n- \n\n## 进展记录\n- YYYY-MM-DD：',
      en: '# Project name\n\n## Overview\n\n| Status | Owner | Start date | Target date |\n|---|---|---|---|\n| Planning | To assign | YYYY-MM-DD | YYYY-MM-DD |\n\n## Goals\n- \n\n## Non-goals\n- \n\n## Milestones\n\n| Milestone | Owner | Due date | Status |\n|---|---|---|---|\n|  |  |  | Not started |\n\n## Current tasks\n- [ ] \n\n## Risks and blockers\n- \n\n## Key decisions\n- \n\n## Progress log\n- YYYY-MM-DD:',
    },
  }),
  defineSeed({
    stableKey: 'daily-report', category: PageTemplateCategory.reporting, displayOrder: 3, seedVersion: 1,
    name: { 'zh-CN': '日报', en: 'Daily report' },
    description: { 'zh-CN': '记录当天成果、阻塞与明日计划', en: 'Record daily outcomes, blockers, and tomorrow plan' },
    defaultTitle: { 'zh-CN': '日报 {date}', en: 'Daily report {date}' },
    content: {
      'zh-CN': '# 日报\n\n## 今日完成\n- \n\n## 正在进行\n- \n\n## 问题与阻塞\n- \n\n## 明日计划\n- [ ] \n\n## 需要协助\n- ',
      en: '# Daily report\n\n## Completed today\n- \n\n## In progress\n- \n\n## Issues and blockers\n- \n\n## Tomorrow\'s plan\n- [ ] \n\n## Help needed\n- ',
    },
  }),
  defineSeed({
    stableKey: 'weekly-report', category: PageTemplateCategory.reporting, displayOrder: 4, seedVersion: 1,
    name: { 'zh-CN': '周报', en: 'Weekly report' },
    description: { 'zh-CN': '汇总本周进展、成果、风险和下周计划', en: 'Summarize progress, outcomes, risks, and next-week plans' },
    defaultTitle: { 'zh-CN': '周报 {year}年第{week}周', en: 'Weekly report {year}-W{week}' },
    content: {
      'zh-CN': '# 周报\n\n## 本周摘要\n- \n\n## 目标进展\n\n| 目标 | 本周进展 | 状态 |\n|---|---|---|\n|  |  | 进行中 |\n\n## 主要成果\n- \n\n## 问题与风险\n- \n\n## 下周计划\n- [ ] \n\n## 需要协调\n- ',
      en: '# Weekly report\n\n## Weekly summary\n- \n\n## Goal progress\n\n| Goal | Progress this week | Status |\n|---|---|---|\n|  |  | In progress |\n\n## Key outcomes\n- \n\n## Issues and risks\n- \n\n## Next-week plan\n- [ ] \n\n## Coordination needed\n- ',
    },
  }),
  defineSeed({
    stableKey: 'meeting-notes', category: PageTemplateCategory.reporting, displayOrder: 5, seedVersion: 1,
    name: { 'zh-CN': '会议纪要', en: 'Meeting notes' },
    description: { 'zh-CN': '沉淀议程、讨论、决定与行动项', en: 'Capture agenda, discussion, decisions, and action items' },
    defaultTitle: { 'zh-CN': '会议纪要 {date}', en: 'Meeting notes {date}' },
    content: {
      'zh-CN': '# 会议纪要\n\n## 会议信息\n\n| 日期 | 参与人 | 记录人 |\n|---|---|---|\n| YYYY-MM-DD |  |  |\n\n## 会议目标\n- \n\n## 议程\n1. \n\n## 讨论记录\n- \n\n## 已做决定\n- \n\n## 行动项\n\n| 行动项 | 负责人 | 截止日期 |\n|---|---|---|\n|  |  |  |\n\n## 待议事项\n- ',
      en: '# Meeting notes\n\n## Meeting details\n\n| Date | Attendees | Note taker |\n|---|---|---|\n| YYYY-MM-DD |  |  |\n\n## Objective\n- \n\n## Agenda\n1. \n\n## Discussion\n- \n\n## Decisions\n- \n\n## Action items\n\n| Action | Owner | Due date |\n|---|---|---|\n|  |  |  |\n\n## Parking lot\n- ',
    },
  }),
  defineSeed({
    stableKey: 'decision-record', category: PageTemplateCategory.knowledge, displayOrder: 6, seedVersion: 1,
    name: { 'zh-CN': '决策记录', en: 'Decision record' },
    description: { 'zh-CN': '记录背景、备选方案、最终决定与影响', en: 'Record context, options, the final decision, and impact' },
    defaultTitle: { 'zh-CN': '决策：主题', en: 'Decision: topic' },
    content: {
      'zh-CN': '# 决策：主题\n\n## 决策状态\n- 状态：提议中\n- 日期：YYYY-MM-DD\n- 决策人：\n\n## 背景\n- \n\n## 备选方案\n\n| 方案 | 优点 | 代价 / 风险 |\n|---|---|---|\n|  |  |  |\n\n## 最终决定\n- \n\n## 决定依据\n- \n\n## 影响\n- \n\n## 后续动作\n- [ ] ',
      en: '# Decision: topic\n\n## Decision status\n- Status: Proposed\n- Date: YYYY-MM-DD\n- Decision maker:\n\n## Context\n- \n\n## Options\n\n| Option | Benefits | Costs / risks |\n|---|---|---|\n|  |  |  |\n\n## Final decision\n- \n\n## Rationale\n- \n\n## Impact\n- \n\n## Follow-up actions\n- [ ] ',
    },
  }),
  defineSeed({
    stableKey: 'retrospective', category: PageTemplateCategory.knowledge, displayOrder: 7, seedVersion: 1,
    name: { 'zh-CN': '复盘总结', en: 'Retrospective' },
    description: { 'zh-CN': '比较目标与结果，把经验转成后续行动', en: 'Compare goals and outcomes, then turn learning into actions' },
    defaultTitle: { 'zh-CN': '复盘：主题', en: 'Retrospective: topic' },
    content: {
      'zh-CN': '# 复盘：主题\n\n## 目标与结果\n- 目标：\n- 结果：\n\n## 做得好的\n- \n\n## 可以改进的\n- \n\n## 原因与洞察\n- \n\n## 行动项\n\n| 行动项 | 负责人 | 截止日期 |\n|---|---|---|\n|  |  |  |\n\n## 后续检查日期\n- YYYY-MM-DD',
      en: '# Retrospective: topic\n\n## Goals and outcomes\n- Goal:\n- Outcome:\n\n## What went well\n- \n\n## What could improve\n- \n\n## Causes and insights\n- \n\n## Action items\n\n| Action | Owner | Due date |\n|---|---|---|\n|  |  |  |\n\n## Follow-up date\n- YYYY-MM-DD',
    },
  }),
]);
