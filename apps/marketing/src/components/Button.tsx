import { type ButtonHTMLAttributes, type ReactNode } from 'react';
import { haptic } from '../haptics';
import { playSound } from '../sound/engine';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'md' | 'sm';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  sound?: boolean;
  children: ReactNode;
}

export function Button({ variant = 'primary', size = 'md', sound = false, children, onClick, className = '', ...rest }: Props) {
  return (
    <button
      className={`zw-btn zw-btn--${variant} zw-btn--${size} ${className}`}
      onClick={(e) => {
        if (sound) {
          playSound('primary');
          haptic(12);
        }
        onClick?.(e);
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
