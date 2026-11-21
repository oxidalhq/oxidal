/** Shared browser-side assertion for the product and rotating-edit checks. */
export function horizontalProblems() {
  const problems: string[] = [];
  const viewportWidth = Math.min(
    innerWidth,
    document.documentElement.clientWidth,
  );
  if (document.documentElement.scrollWidth > viewportWidth + 1)
    problems.push('Page has horizontal overflow');

  for (const control of document.querySelectorAll<HTMLElement>(
    'button, input, select, textarea, summary, [role=slider], .chain-tile',
  )) {
    if (!control.checkVisibility()) continue;
    const rect = control.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const name = (
      control.getAttribute('aria-label') ||
      control.textContent ||
      control.tagName
    ).trim();
    const rail = control.closest<HTMLElement>('[data-horizontal-scroll]');
    if (rail) {
      const { left } = rail.getBoundingClientRect();
      const right = left + rail.clientWidth;
      const first = rect.left - left + rail.scrollLeft;
      const last = first + rect.width;
      // Every tab must fit when scrolled into place. The selected tab must
      // already be visible, including after deep links and viewport changes.
      if (
        left < -1 ||
        right > viewportWidth + 1 ||
        first < -1 ||
        last > rail.scrollWidth + 1 ||
        rect.width > rail.clientWidth + 1 ||
        ((rect.left < left - 1 || rect.right > right + 1) &&
          (!['auto', 'scroll'].includes(getComputedStyle(rail).overflowX) ||
            rail.scrollWidth <= rail.clientWidth ||
            control.getAttribute('aria-selected') === 'true'))
      )
        problems.push(`${name}: unreachable within the scrolling tab bar`);
    } else if (rect.left < -1 || rect.right > viewportWidth + 1) {
      problems.push(`${name}: outside the horizontal viewport`);
    }
    if (
      control.matches('[data-slot=segment]') &&
      control.scrollWidth > control.clientWidth + 1
    )
      problems.push(`${name}: segment label overflows`);
  }
  return problems;
}
