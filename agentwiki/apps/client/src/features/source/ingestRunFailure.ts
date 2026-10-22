import type { Translate } from '../../api/error-message';
import { bugOperationsMessages, bugOperationsText } from '../../i18n/bug-operations-messages';
import type { Language } from '../../i18n/messages';

const GIT_FAILURE_CODES = new Set(['GIT_UNAVAILABLE', 'GIT_TIMEOUT', 'GIT_ACCESS_FAILED', 'GIT_FETCH_FAILED', 'GIT_CHECKOUT_FAILED', 'GIT_SOURCE_EMPTY']);

// Keep the visible diagnosis and search terms on the same allowlisted fields.
// Historical raw errors can contain credentials and are not display/search text.
export function ingestRunFailure(run: any, language: Language, t: Translate) {
  const failure = run.result?.failure;
  if (!run.error && !failure && run.status !== 'failed') return null;
  const op = (key: string) => bugOperationsText(language, key);
  const code = typeof failure?.code === 'string' && /^[A-Z_]{1,80}$/.test(failure.code) ? failure.code : undefined;
  const stage = typeof failure?.stage === 'string' && ['fetching', 'extracting', 'compiling', 'indexing', 'publishing'].includes(failure.stage) ? failure.stage : undefined;
  const knownRemoteCode = code && bugOperationsMessages.en[`operations.failure.${code}`];
  const httpStatus = Number.isInteger(run.result?.sourceMetadata?.statusCode) ? run.result.sourceMetadata.statusCode : undefined;
  const httpReason = code === 'REMOTE_REQUEST_FAILED' && httpStatus
    ? [401, 403].includes(httpStatus) ? 'httpDenied' : httpStatus === 404 ? 'httpMissing' : httpStatus === 429 ? 'httpLimited' : httpStatus >= 500 ? 'httpServer' : undefined
    : undefined;
  const advice = code === 'REMOTE_URL_REJECTED' ? 'url' : code === 'REMOTE_REQUEST_FAILED' ? 'request'
    : code === 'REMOTE_BODY_TOO_LARGE' ? 'size' : code === 'REMOTE_ENCODING_INVALID' ? 'encoding'
      : code?.startsWith('REMOTE_REDIRECT') ? 'redirect' : ['REMOTE_CONTENT_TYPE_UNSUPPORTED', 'REMOTE_SOURCE_EMPTY'].includes(code || '') ? 'text' : 'unknown';
  return {
    code, stage,
    stageLabel: stage ? op(`operations.stage.${stage}`) : op('operations.stageUnknown'),
    reason: httpReason ? `${op(`operations.failure.${httpReason}`)}（HTTP ${httpStatus}）`
      : GIT_FAILURE_CODES.has(code || '') ? t(`run.failure.${code}`)
        : op(knownRemoteCode ? `operations.failure.${code}` : 'operations.failure.unknown'),
    advice: op(`operations.advice.${advice}`),
  };
}
