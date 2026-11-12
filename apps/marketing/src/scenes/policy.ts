export function shouldLoadHero3d(input: {
  reducedMotion: boolean;
  webgl: boolean;
  mobile: boolean;
  saveData: boolean;
  cores: number;
}): 'full' | 'simple' | 'off' {
  if (input.reducedMotion || !input.webgl) return 'off';
  if (input.saveData) return 'off';
  if (input.mobile || input.cores > 0 && input.cores <= 4) return 'simple';
  return 'full';
}

export function hero3dPaused(hidden: boolean, reducedMotion: boolean): boolean {
  return hidden || reducedMotion;
}

export function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
