import React from 'react';
import type { ValidationIssue } from '../types';

const MESSAGE_KEYS: Array<[RegExp, string]> = [
  [/contains a cycle/iu, 'Dependency cycle detected'],
  [/Unknown role slot/iu, 'A task references a missing role'],
  [/no entry|entry node/iu, 'The workflow needs an entry step'],
  [/terminal/iu, 'The workflow needs a valid terminal step'],
  [/unreachable/iu, 'A required step is unreachable'],
  [/revision/iu, 'A review has an invalid revision target'],
  [/output|jsonSchema/iu, 'A task has an invalid output contract'],
];

export function issueLabel(issue: ValidationIssue): string {
  const raw = issue.message || issue.code;
  return MESSAGE_KEYS.find(([pattern]) => pattern.test(raw))?.[1] ?? raw;
}

export const ValidationIssueList: React.FC<{
  issues: ValidationIssue[];
  title: string;
}> = ({ issues, title }) => {
  if (!issues.length) return null;
  return (
    <section aria-labelledby="template-issues-title" className="rounded-xl border border-red-200 bg-red-50 p-4">
      <h2 id="template-issues-title" className="font-medium text-red-800">{title}</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-700">
        {issues.map((issue, index) => <li key={`${issue.code}-${issue.path ?? ''}-${index}`}>{issueLabel(issue)}</li>)}
      </ul>
    </section>
  );
};

