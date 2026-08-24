import React from 'react';
import type { ValidationIssue } from '../types';

const MESSAGE_KEYS: Array<[RegExp, string]> = [
  [/duplicate dependency/iu, 'DEPENDENCY_DUPLICATE'],
  [/duplicate/iu, 'KEY_DUPLICATE'],
  [/cannot depend on itself|contains a cycle/iu, 'DEPENDENCY_CYCLE'],
  [/unknown node|dependency references/iu, 'DEPENDENCY_NODE_MISSING'],
  [/modes cannot mix/iu, 'DEPENDENCY_MODE_CONFLICT'],
  [/Unknown role slot/iu, 'ROLE_SLOT_MISSING'],
  [/Unknown input key/iu, 'INPUT_KEY_MISSING'],
  [/required Todo/iu, 'REQUIRED_TODO_MISSING'],
  [/no entry|entry node/iu, 'ENTRY_NODE_MISSING'],
  [/unknown terminal/iu, 'TERMINAL_NODE_MISSING'],
  [/terminal node has outgoing/iu, 'TERMINAL_NODE_INVALID'],
  [/cannot reach a terminal|unreachable/iu, 'REQUIRED_NODE_UNREACHABLE'],
  [/required artifact.*not guaranteed|any dependency/iu, 'ANY_REQUIRED_ARTIFACT_UNSAFE'],
  [/upstream artifact/iu, 'UPSTREAM_ARTIFACT_UNREACHABLE'],
  [/source task cannot be skippable/iu, 'REVIEW_SOURCE_TASK_SKIPPABLE'],
  [/source must be an Agent task/iu, 'REVIEW_SOURCE_TASK_INVALID'],
  [/direct source edge/iu, 'REVIEW_SOURCE_EDGE_MISSING'],
  [/revision target/iu, 'REVISION_TARGET_INVALID'],
  [/output|jsonSchema/iu, 'OUTPUT_CONTRACT_INVALID'],
];

export function issueLabel(issue: ValidationIssue, t?: (key: string) => string): string {
  const raw = issue.message || issue.code;
  const code = issue.code !== 'custom' ? issue.code : MESSAGE_KEYS.find(([pattern]) => pattern.test(raw))?.[1] ?? 'SCHEMA_INVALID';
  if (code && t) {
    const key = `collaboration.validation.${code}`;
    const translated = t(key);
    if (translated !== key) return translated;
  }
  return raw;
}

export const ValidationIssueList: React.FC<{
  issues: ValidationIssue[];
  title: string;
  t?: (key: string) => string;
}> = ({ issues, title, t }) => {
  if (!issues.length) return null;
  return (
    <section aria-labelledby="template-issues-title" className="rounded-xl border border-red-200 bg-red-50 p-4">
      <h2 id="template-issues-title" className="font-medium text-red-800">{title}</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-700">
        {issues.map((issue, index) => <li key={`${issue.code}-${issue.path ?? ''}-${index}`}>{issueLabel(issue, t)}</li>)}
      </ul>
    </section>
  );
};
