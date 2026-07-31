/**
 * Sensitive data scanner and redaction helpers.
 *
 * This is a deterministic rule-based layer. It does not understand semantics;
 * it classifies obvious secrets and marks content that should not be shared.
 */

export const SECRET_PATTERNS = [
  { name: 'agentwiki-key', pattern: /\b(?:agk|awk)_[A-Za-z0-9_-]{16,}\b/g },
  { name: 'openai-api-key', pattern: /\b(?:sk-[a-zA-Z0-9]{20,}|sk-proj-[a-zA-Z0-9_-]{20,})\b/g },
  { name: 'aws-key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'generic-secret', pattern: /\b(?:api[_-]?key|apikey|token|secret|password)\s*[:=]\s*['"`]?[A-Za-z0-9!@#$%^&*()_+\-=]{8,}['"`]?/gi },
];

export interface RedactionResult {
  text: string;
  findings: Array<{ name: string; match: string }>;
  hasSecret: boolean;
}

export function redactSecrets(text: string): RedactionResult {
  const findings: Array<{ name: string; match: string }> = [];
  let redacted = text;
  for (const { name, pattern } of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, (match) => {
      findings.push({ name, match });
      return `[REDACTED:${name}]`;
    });
  }
  return { text: redacted, findings, hasSecret: findings.length > 0 };
}

export function classifySensitivity(text: string): 'shareable' | 'review-required' | 'local-only' {
  const { hasSecret } = redactSecrets(text);
  if (hasSecret) return 'local-only';
  // Placeholder: future rules can detect private paths, personal identifiers, etc.
  return 'shareable';
}

export function isUploadable(sensitivity: 'shareable' | 'review-required' | 'local-only'): boolean {
  return sensitivity === 'shareable' || sensitivity === 'review-required';
}
