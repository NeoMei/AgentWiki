// Operator-owned synthetic inputs. Never import this module into the consumer facade.
import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
const values = { v1: [24, 7], v2: [48, 14], v3: [72, 21] };
export function fixtureEnvelope(version, sourceKey = 'freshness-main') {
  if (!Object.hasOwn(values, version)) throw new Error('Fixture version must be v1, v2 or v3');
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(sourceKey)) throw new Error('Invalid synthetic source key');
  const [hours, days] = values[version];
  const doc = (path, title, quote, sourcePath) => {
    const content = `# ${title}\n\n${quote}\n`;
    return { path, content, contentHash: hash(content), evidence: [{ sourcePath, sourceHash: hash(quote), quote }] };
  };
  return {
    okfVersion: '0.1', sourceKey, name: 'Synthetic source review', kind: 'documents',
    producer: { name: 'source-freshness-acceptance', version: '1' },
    documents: [
      doc('guide/dispatch.md', '分派规范', `复核窗口为 ${hours} 小时。`, 'input/dispatch.txt'),
      doc('guide/retention.md', '保留规范', `记录保留 ${days} 天。`, 'input/retention.txt'),
    ],
  };
}
export const fixtureHash = (version, sourceKey) => hash(JSON.stringify(fixtureEnvelope(version, sourceKey)));
export const unrelatedPage = {
  title: '独立手工文档',
  content: '# 独立手工文档\n\n这篇页面不绑定待同步来源。\n\n## 布局检查\n\n| 项目 | 说明 | 备注 | 检查依据 | 预期 | 结果 |\n| --- | --- | --- | --- | --- | --- |\n| 窄屏与宽表 | 保持正文可读 | 仅为布局夹具 | 实际浏览器观察 | 表格可横向滚动 | 待验收 |\n',
};
