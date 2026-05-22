'use client';

import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';

export default function ThemeToggle() {
  const [light, setLight] = useState(false);

  useEffect(() => {
    if (localStorage.getItem('theme') === 'light') setLight(true);
  }, []);

  function toggle() {
    const next = !light;
    setLight(next);
    if (next) {
      document.documentElement.classList.add('light');
      localStorage.setItem('theme', 'light');
    } else {
      document.documentElement.classList.remove('light');
      localStorage.setItem('theme', 'dark');
    }
  }

  return (
    <button
      onClick={toggle}
      aria-label={light ? 'Switch to dark mode' : 'Switch to light mode'}
      className="w-9 h-9 rounded-lg grid place-items-center transition shrink-0 hover:opacity-80"
      style={{ background: 'var(--c-card)', color: 'var(--c-text-3)', border: '1px solid var(--c-border)' }}
    >
      {light ? <Moon size={15} /> : <Sun size={15} />}
    </button>
  );
}
