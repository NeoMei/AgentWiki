import React from 'react';
import { useLanguage } from '../../context/LanguageContext';

const STYLES: Record<string, string> = {
  pending_review: 'bg-amber-100 text-amber-800 border border-amber-200',
  approved: 'bg-blue-100 text-blue-800 border border-blue-200',
  published: 'bg-green-100 text-green-800 border border-green-200',
  reverted: 'bg-gray-200 text-gray-700 border border-gray-300',
  rejected: 'bg-red-100 text-red-700 border border-red-200',
  draft: 'bg-gray-100 text-gray-600 border border-gray-200',
  publishing: 'bg-blue-50 text-blue-700 border border-blue-200',
  reverting: 'bg-gray-100 text-gray-600 border border-gray-200',
};

const ZH: Record<string, string> = {
  pending_review: '待审核',
  approved: '已批准',
  published: '已发布',
  reverted: '已回滚',
  rejected: '已拒绝',
  draft: '草稿',
  publishing: '发布中',
  reverting: '回滚中',
};

const EN: Record<string, string> = {
  pending_review: 'Pending review',
  approved: 'Approved',
  published: 'Published',
  reverted: 'Reverted',
  rejected: 'Rejected',
  draft: 'Draft',
  publishing: 'Publishing',
  reverting: 'Reverting',
};

export const ChangeSetStatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const { language } = useLanguage();
  const zh = language === 'zh-CN';
  const label = (zh ? ZH : EN)[status] || status;
  const style = STYLES[status] || STYLES.draft;
  return (
    <span data-testid={`status-badge-${status}`} className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>
      {label}
    </span>
  );
};
