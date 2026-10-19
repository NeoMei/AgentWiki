export const agentDirectoryMessages = {
  'zh-CN': {
    'agent.directoryHint': '当前目录及子目录可自动读取，无需逐篇 @ 引用。',
    'agent.directoryStart': '围绕当前目录开始对话。',
    'agent.directoryPlaceholder': '询问、汇总目录文档，或要求创建新文档',
    'agent.directoryRead': '目录读取范围',
    'agent.directoryUnavailable': '目录过大，本轮未加载目录正文；可继续询问当前文章，或选择较小的目录。',
    'agent.subfolders': '含子目录',
  },
  en: {
    'agent.directoryHint': 'The current directory and subfolders are available automatically; no need to @ each page.',
    'agent.directoryStart': 'Start a conversation about this directory.',
    'agent.directoryPlaceholder': 'Ask about this directory, summarize it, or request a new document',
    'agent.directoryRead': 'Directory read scope',
    'agent.directoryUnavailable': 'Directory content was not loaded because this directory is too large. Ask about the current page or choose a smaller directory.',
    'agent.subfolders': 'including subfolders',
  },
} as const;
