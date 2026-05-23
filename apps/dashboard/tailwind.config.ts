import type { Config } from 'tailwindcss';
import preset from '@offlinesms/design-tokens/tailwind';

const config: Config = {
  darkMode: 'class',
  presets: [preset as any],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
};
export default config;
