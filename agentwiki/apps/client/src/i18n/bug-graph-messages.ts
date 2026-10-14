import type { Language } from './messages';

export const bugGraphMessages = {
  'zh-CN': {
    'graph.grouped': '文件夹分组',
    'graph.allPages': '全部页面节点',
    'graph.groupsHint': '按页面所在文件夹分组；数量为直接包含的页面。点击分组展开页面节点。',
    'graph.search': '搜索页面',
    'graph.searchPlaceholder': '搜索标题或页面路径',
    'graph.relationFilter': '筛选关系类型',
    'graph.allRelations': '全部关系类型',
    'graph.ungrouped': '未分组',
    'graph.folderUnavailable': '文件夹不可用',
    'graph.pageCount': '{count} 个页面',
    'graph.matchCount': '匹配 {count} / {total} 个页面',
    'graph.resultCount': '显示 {count} / {total} 个页面',
    'graph.emptyFolder': '此文件夹没有直接包含的页面。',
    'graph.noMatches': '没有匹配的页面。请调整搜索或关系类型。',
    'graph.clearFilters': '清除筛选',
    'graph.pageDetails': '页面详情',
    'graph.pagePath': '页面路径',
    'graph.pathUnavailable': '路径不可用',
    'graph.relatedPages': '关联页面',
    'graph.noRelations': '当前筛选下没有关联页面。',
    'graph.connectedCount': '{pages} 个关联页面 · {relations} 条关系',
    'graph.closeDetails': '关闭页面详情',
    'graph.selectHint': '选择页面节点查看路径与关联页面。',
  },
  en: {
    'graph.grouped': 'Folder groups',
    'graph.allPages': 'All page nodes',
    'graph.groupsHint': 'Grouped by each page’s folder. Counts include direct pages only. Select a group to expand its page nodes.',
    'graph.search': 'Search pages',
    'graph.searchPlaceholder': 'Search titles or page paths',
    'graph.relationFilter': 'Filter relation type',
    'graph.allRelations': 'All relation types',
    'graph.ungrouped': 'Ungrouped',
    'graph.folderUnavailable': 'Folder unavailable',
    'graph.pageCount': '{count} pages',
    'graph.matchCount': '{count} / {total} matching pages',
    'graph.resultCount': 'Showing {count} / {total} pages',
    'graph.emptyFolder': 'This folder contains no direct pages.',
    'graph.noMatches': 'No matching pages. Adjust the search or relation type.',
    'graph.clearFilters': 'Clear filters',
    'graph.pageDetails': 'Page details',
    'graph.pagePath': 'Page path',
    'graph.pathUnavailable': 'Path unavailable',
    'graph.relatedPages': 'Related pages',
    'graph.noRelations': 'No related pages under the current filters.',
    'graph.connectedCount': '{pages} related pages · {relations} relations',
    'graph.closeDetails': 'Close page details',
    'graph.selectHint': 'Select a page node to view its path and related pages.',
  },
} as const;

export function bugGraphText(language: Language, key: keyof typeof bugGraphMessages.en, params?: Record<string, string | number>): string {
  const template: string = bugGraphMessages[language][key];
  return Object.entries(params ?? {}).reduce((value, [name, replacement]) => value.split(`{${name}}`).join(String(replacement)), template);
}
