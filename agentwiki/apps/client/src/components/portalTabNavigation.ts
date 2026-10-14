/** Resume tab navigation at the popup trigger's position, rather than the body portal. */
export function focusBesidePortalTrigger(trigger: HTMLElement | null, backwards: boolean, popup: HTMLElement | null) {
  if (!trigger) return;
  const candidates = [...trigger.ownerDocument.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, summary, [tabindex]')]
    .filter((node) => {
      if (popup?.contains(node) || node.tabIndex < 0 || node.matches(':disabled') || node.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
      for (let ancestor: HTMLElement | null = node; ancestor; ancestor = ancestor.parentElement) {
        const style = window.getComputedStyle(ancestor);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (ancestor instanceof HTMLDetailsElement && !ancestor.open && !ancestor.querySelector('summary')?.contains(node)) return false;
      }
      return true;
    })
    .sort((a, b) => (a.tabIndex > 0 ? a.tabIndex : Infinity) - (b.tabIndex > 0 ? b.tabIndex : Infinity));
  const index = candidates.indexOf(trigger);
  const target = index >= 0 ? candidates[index + (backwards ? -1 : 1)] : null;
  (target ?? trigger).focus({ preventScroll: true });
}
