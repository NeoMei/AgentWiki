import type { Language } from '../../i18n/messages';

const messages: Record<Language, Record<string, string>> = {
  en: {
    'collaboration.wizard.runNameRequired': 'Enter a run name.',
    'collaboration.wizard.newRun': 'Start a new run',
    'collaboration.wizard.newRunHelp': 'Your existing run remains available in Active runs or History.',
    'collaboration.wizard.currentStatus': 'Current status: {status}',
    'collaboration.wizard.restoreFailed': 'Could not load your saved run. Retry, or start a new run. Your existing draft is preserved.',
    'collaboration.wizard.retrySavedRun': 'Retry saved run',
  },
  'zh-CN': {
    'collaboration.wizard.runNameRequired': '请填写运行名称。',
    'collaboration.wizard.newRun': '开始新运行',
    'collaboration.wizard.newRunHelp': '现有运行仍可在进行中的协作或历史记录中查看。',
    'collaboration.wizard.currentStatus': '当前状态：{status}',
    'collaboration.wizard.restoreFailed': '无法加载已保存的运行。请重试或开始新运行，原草稿仍保留。',
    'collaboration.wizard.retrySavedRun': '重试已保存的运行',
  },
};

export function runStartText(language: Language, key: string, params?: Record<string, string | number>): string | undefined {
  const template = messages[language][key] ?? messages.en[key];
  if (template === undefined) return undefined;
  return Object.entries(params ?? {}).reduce(
    (value, [name, replacement]) => value.split(`{${name}}`).join(String(replacement)),
    template,
  );
}
