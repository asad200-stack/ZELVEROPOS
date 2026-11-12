export function nextMenuOpen(open: boolean, action: 'toggle' | 'close' | 'escape' | 'navigate'): boolean {
  if (action === 'toggle') return !open;
  return false;
}

export function menuAria(open: boolean): { expanded: boolean; label: string } {
  return { expanded: open, label: open ? 'Close menu' : 'Open menu' };
}
