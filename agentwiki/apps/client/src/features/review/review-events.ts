export const REVIEW_CHANGED_EVENT = 'agentwiki:review-changed';

export function announceReviewChanged() {
  window.dispatchEvent(new Event(REVIEW_CHANGED_EVENT));
}
