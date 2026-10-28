import type { CanonicalSpaceApprovalPolicy } from '../../api/space-types';

const EVENT = 'agentwiki:space-review-policy-changed';
interface PolicyChange { spaceId: string; actorId?: string; approvalPolicy: CanonicalSpaceApprovalPolicy }
export function announceSpaceReviewPolicyChange(change: PolicyChange) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: change }));
}
export function listenSpaceReviewPolicyChanges(spaceId: string, actorId: string | undefined, onChange: (policy: CanonicalSpaceApprovalPolicy) => void) {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<PolicyChange>).detail;
    if (detail?.spaceId === spaceId && detail.actorId === actorId
      && (detail.approvalPolicy === 'no-review' || detail.approvalPolicy === 'always-review')) onChange(detail.approvalPolicy);
  };
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
