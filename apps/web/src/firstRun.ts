/** On a new browser's first visit, open the setup guide. Explicit links always win. */
export function openFirstRun() {
  if (location.hash || location.search) return;
  try {
    if (localStorage.getItem('oxidal.first-run') === 'seen') return;
    const returning = ['oxidal.display', 'oxidal.status'].some(
      (key) => localStorage.getItem(key) !== null,
    );
    localStorage.setItem('oxidal.first-run', 'seen');
    if (!returning)
      history.replaceState(history.state, '', '#settings/essentials/setup');
  } catch {
    // The guide remains available in Settings when this browser refuses storage.
  }
}
