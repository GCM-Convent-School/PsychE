import React from 'react';
import { initials, toneOf } from '../utils/initials';
import type { NeedLevel } from '../types';

// A person, shown the way the reference shows people: a soft circle with a
// white ring. A need-level bubble sits on the corner when the student has an
// open case; it can carry a short count (days late).
export const Avatar: React.FC<{ name: string | null | undefined; need?: NeedLevel | null; badge?: string; size?: 'md' | 'lg' }> = ({ name, need, badge, size = 'md' }) => (
  <span className={`avatar${size === 'lg' ? ' avatar--lg' : ''}`} data-tone={toneOf(name)} aria-hidden="true">
    {initials(name)}
    {need && <span className={`avatar-badge avatar-badge--${need}`}>{badge ?? ''}</span>}
  </span>
);
