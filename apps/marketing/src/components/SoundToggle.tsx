import { useState } from 'react';
import { playSound, setSoundEnabled, soundEnabled } from '../sound/engine';

export function SoundToggle() {
  const [on, setOn] = useState(soundEnabled);
  return (
    <button
      type="button"
      className="zw-sound"
      aria-pressed={on}
      aria-label={on ? 'Sound on' : 'Sound off'}
      title={on ? 'Sound on' : 'Sound off'}
      onClick={() => {
        const next = !on;
        setSoundEnabled(next);
        setOn(next);
        if (next) playSound('toggle');
      }}
    >
      <span aria-hidden>{on ? '🔊' : '🔇'}</span>
    </button>
  );
}
