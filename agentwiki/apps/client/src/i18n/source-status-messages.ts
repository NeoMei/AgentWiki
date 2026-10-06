import type { Language } from './messages';

// Loaded with Page/Review routes so source details do not enlarge the initial shell.
const sourceStatusMessages: Record<Language, Record<string, string>> = {
  "en": {
    "sourceStatus.needs_review": "The source or page has changed and needs review. The current text retains its previous basis.",
    "sourceStatus.unknown": "Source review status is unknown. Check the evidence and its applicability.",
    "sourceStatus.unavailable": "The source is unavailable or inaccessible; alignment cannot be confirmed.",
    "sourceStatus.current": "The reviewed source matches this page’s record; this does not certify factual correctness.",
    "sourceStatus.candidateCurrent": "The candidate input matches the accepted source; human review is still required.",
    "sourceStatus.pageChanged": "The text was edited; the previous source review does not cover this change.",
    "sourceStatus.reviewed": "Page basis version",
    "sourceStatus.pinned": "Pinned candidate version",
    "sourceStatus.accepted": "Currently accepted version",
    "sourceStatus.generation": "generation",
    "sourceStatus.evidence.published_basis": "Basis for this publication",
    "sourceStatus.evidence.historical": "Historical evidence",
    "sourceStatus.evidence.unknown": "Unverified evidence association",
    "sourceStatus.noAccessibleEvidence": "No accessible extracted evidence; this does not establish a manual origin.",
  },
  "zh-CN": {
    "sourceStatus.needs_review": "来源或页面已变化，需要重新复核；当前正文仍保留原有依据。",
    "sourceStatus.unknown": "尚不能确认来源复核状态，请核对依据及适用范围。",
    "sourceStatus.unavailable": "来源当前不可用或无权访问，无法确认与当前来源一致。",
    "sourceStatus.current": "当前来源已复核并与页面记录一致；这不代表内容必然正确。",
    "sourceStatus.candidateCurrent": "候选输入与当前已接收来源一致；仍需人工审核。",
    "sourceStatus.pageChanged": "正文已编辑，原来源复核记录不能覆盖此次改动。",
    "sourceStatus.reviewed": "页面依据版本",
    "sourceStatus.pinned": "候选固定版本",
    "sourceStatus.accepted": "当前接收版本",
    "sourceStatus.generation": "代次",
    "sourceStatus.evidence.published_basis": "本次发布依据",
    "sourceStatus.evidence.historical": "历史依据",
    "sourceStatus.evidence.unknown": "未验证的依据关联",
    "sourceStatus.noAccessibleEvidence": "没有可访问的提取证据；不能据此推断为人工提案。",
  },
};

export function sourceStatusText(language: Language, key: string): string {
  return sourceStatusMessages[language][key] ?? sourceStatusMessages.en[key] ?? key;
}
