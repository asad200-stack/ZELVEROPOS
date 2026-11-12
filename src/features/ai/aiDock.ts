/**
 * Shell-level AI dock mode — panel stays mounted across route changes.
 * Closed unmounts; minimized keeps conversation + pending state alive.
 */

export type AiDockMode = 'closed' | 'open' | 'minimized';

export type AiDockAction = 'open' | 'close' | 'minimize' | 'restore';

export function nextAiDockMode(current: AiDockMode, action: AiDockAction): AiDockMode {
  switch (action) {
    case 'open':
    case 'restore':
      return 'open';
    case 'minimize':
      return current === 'closed' ? 'closed' : 'minimized';
    case 'close':
      return 'closed';
    default:
      return current;
  }
}

export function shouldMountAiPanel(mode: AiDockMode): boolean {
  return mode === 'open' || mode === 'minimized';
}

/** Classes for the app shell so the main workspace stays usable beside the dock. */
export function aiShellClassNames(mode: AiDockMode): string[] {
  if (mode === 'open') return ['app--ai-docked'];
  if (mode === 'minimized') return ['app--ai-minimized'];
  return [];
}

export function aiLayerClassNames(mode: AiDockMode, rtl: boolean): string[] {
  const classes = ['ai-layer'];
  if (mode === 'minimized') classes.push('ai-layer--minimized');
  else if (mode === 'open') classes.push('ai-layer--docked');
  if (rtl) classes.push('ai-layer--rtl');
  return classes;
}
