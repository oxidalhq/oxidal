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
    if (rect.left < -1 || rect.right > viewportWidth + 1)
      problems.push(`${name}: outside the horizontal viewport`);
    if (
      control.matches('[data-slot=segment]') &&
      control.scrollWidth > control.clientWidth + 1
    )
      problems.push(`${name}: segment label overflows`);
  }
  return problems;
}
