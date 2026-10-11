// "Simsim" — the OfflineSMS starter sticker pack. Original artwork authored for
// this project as code (SVG), dedicated to the public domain (CC0 1.0); see
// assets/stickers/simsim/LICENSE.md. Each sticker is a small composition of the
// mascot (a round speech-bubble character) plus an expression / prop.

const BODY = '#2E9BD6';
const BODY_DARK = '#1F7BA8';
const INK = '#16324A';
const CHEEK = '#FF8FA3';

const W = 512;

// Die-cut sticker look: white outline + soft shadow around everything drawn.
const defs = `
<defs>
  <filter id="cut" x="-20%" y="-20%" width="140%" height="140%">
    <feMorphology in="SourceAlpha" operator="dilate" radius="14" result="grown"/>
    <feFlood flood-color="#ffffff"/>
    <feComposite in2="grown" operator="in" result="outline"/>
    <feGaussianBlur in="grown" stdDeviation="6" result="blur"/>
    <feOffset in="blur" dy="6" result="sh"/>
    <feFlood flood-color="#0b2233" flood-opacity="0.28"/>
    <feComposite in2="sh" operator="in" result="shadow"/>
    <feMerge><feMergeNode in="shadow"/><feMergeNode in="outline"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <radialGradient id="shine" cx="35%" cy="30%" r="70%">
    <stop offset="0" stop-color="#ffffff" stop-opacity="0.35"/>
    <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
  </radialGradient>
</defs>`;

function body(color = BODY) {
  // Round bubble with a little tail bottom-left.
  return `
  <path d="M256 70c-106 0-186 72-186 166 0 52 24 97 64 128l-22 62c-3 9 6 17 15 12l74-38c17 4 36 6 55 6 106 0 186-72 186-170S362 70 256 70z" fill="${color}"/>
  <path d="M256 70c-106 0-186 72-186 166 0 52 24 97 64 128l-22 62c-3 9 6 17 15 12l74-38c17 4 36 6 55 6 106 0 186-72 186-170S362 70 256 70z" fill="url(#shine)"/>`;
}
const cheeks = `<ellipse cx="170" cy="262" rx="22" ry="13" fill="${CHEEK}" opacity="0.8"/><ellipse cx="342" cy="262" rx="22" ry="13" fill="${CHEEK}" opacity="0.8"/>`;
const eyesOpen = `<ellipse cx="200" cy="215" rx="17" ry="24" fill="${INK}"/><ellipse cx="312" cy="215" rx="17" ry="24" fill="${INK}"/><circle cx="206" cy="205" r="6" fill="#fff"/><circle cx="318" cy="205" r="6" fill="#fff"/>`;
const eyesHappy = `<path d="M180 222q20-26 40 0" stroke="${INK}" stroke-width="12" fill="none" stroke-linecap="round"/><path d="M292 222q20-26 40 0" stroke="${INK}" stroke-width="12" fill="none" stroke-linecap="round"/>`;
const smile = `<path d="M222 268q34 34 68 0" stroke="${INK}" stroke-width="12" fill="none" stroke-linecap="round"/>`;
const bigMouth = `<path d="M206 262h100q-4 62-50 62t-50-62z" fill="${INK}"/><path d="M226 300q30 20 60 0q-6 22-30 22t-30-22z" fill="#FF6B81"/>`;
const heart = (x, y, s = 1, c = '#FF4D6D') =>
  `<path transform="translate(${x} ${y}) scale(${s})" d="M0 -14c-10-22-46-18-46 10 0 24 30 40 46 54 16-14 46-30 46-54 0-28-36-32-46-10z" fill="${c}"/>`;
const hand = (x, y, rot = 0) =>
  `<g transform="translate(${x} ${y}) rotate(${rot})"><rect x="-26" y="-34" width="52" height="64" rx="26" fill="${BODY_DARK}"/><rect x="-24" y="-60" width="14" height="34" rx="7" fill="${BODY_DARK}"/><rect x="-8" y="-66" width="14" height="40" rx="7" fill="${BODY_DARK}"/><rect x="8" y="-62" width="14" height="36" rx="7" fill="${BODY_DARK}"/></g>`;

function wrap(inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">${defs}<g filter="url(#cut)">${inner}</g></svg>`;
}

function textSticker(label, rtl, fill) {
  const font = `font-family="DejaVu Sans, Noto Sans Arabic, sans-serif" font-weight="bold"`;
  return wrap(`
    ${body(fill)}
    <text x="256" y="262" text-anchor="middle" ${font} font-size="${rtl ? 92 : (label.length > 5 ? 66 : 84)}" ${rtl ? 'direction="rtl"' : ''} fill="#fff" stroke="${INK}" stroke-width="5" paint-order="stroke">${label}</text>
    ${heart(390, 120, 0.7)}`);
}

/** id, emoji alt (used for previews / older clients), English + Arabic names, SVG */
export const STICKERS = [
  { id: 'hi', alt: '👋', en: 'Hi', ar: 'مرحبا', svg: wrap(`${body()}${eyesOpen}${cheeks}${smile}${hand(392, 210, 18)}`) },
  { id: 'love', alt: '😍', en: 'Love', ar: 'حب', svg: wrap(`${body()}${heart(200, 218, 0.62)}${heart(312, 218, 0.62)}${cheeks}${smile}`) },
  { id: 'laugh', alt: '😂', en: 'Laughing', ar: 'ضحك', svg: wrap(`${body()}${eyesHappy}${bigMouth}<path d="M160 236q-14 30 4 44q18-14 4-44z" fill="#7FD3FF"/><path d="M352 236q-14 30 4 44q18-14 4-44z" fill="#7FD3FF"/>`) },
  { id: 'thumbs', alt: '👍', en: 'Thumbs up', ar: 'ممتاز', svg: wrap(`${body()}${eyesHappy}${cheeks}${smile}<g transform="translate(396 250)"><rect x="-30" y="-20" width="60" height="62" rx="18" fill="${BODY_DARK}"/><rect x="-14" y="-74" width="26" height="64" rx="13" fill="${BODY_DARK}"/></g>`) },
  { id: 'sad', alt: '😢', en: 'Sad', ar: 'حزين', svg: wrap(`${body('#5B8DB8')}${eyesOpen}<path d="M222 300q34-30 68 0" stroke="${INK}" stroke-width="12" fill="none" stroke-linecap="round"/><path d="M196 246q-14 34 4 48q18-14 4-48z" fill="#7FD3FF"/>`) },
  { id: 'angry', alt: '😠', en: 'Angry', ar: 'غاضب', svg: wrap(`${body('#E4572E')}<path d="M172 180l52 22" stroke="${INK}" stroke-width="12" stroke-linecap="round"/><path d="M340 180l-52 22" stroke="${INK}" stroke-width="12" stroke-linecap="round"/>${eyesOpen}<path d="M222 304q34-26 68 0" stroke="${INK}" stroke-width="12" fill="none" stroke-linecap="round"/>`) },
  { id: 'sleepy', alt: '😴', en: 'Sleepy', ar: 'نعسان', svg: wrap(`${body('#7B79C9')}<path d="M180 222q20 18 40 0" stroke="${INK}" stroke-width="12" fill="none" stroke-linecap="round"/><path d="M292 222q20 18 40 0" stroke="${INK}" stroke-width="12" fill="none" stroke-linecap="round"/><ellipse cx="256" cy="290" rx="16" ry="12" fill="${INK}"/><text x="360" y="150" font-family="DejaVu Sans" font-weight="bold" font-size="84" fill="#fff" stroke="${INK}" stroke-width="4" paint-order="stroke">z</text><text x="420" y="92" font-family="DejaVu Sans" font-weight="bold" font-size="60" fill="#fff" stroke="${INK}" stroke-width="4" paint-order="stroke">z</text>`) },
  { id: 'party', alt: '🥳', en: 'Party', ar: 'احتفال', svg: wrap(`${body()}${eyesHappy}${cheeks}${bigMouth}<path d="M200 96l56-80 56 80z" fill="#FFC93C"/><circle cx="256" cy="16" r="14" fill="#FF4D6D"/><circle cx="110" cy="120" r="10" fill="#FFC93C"/><rect x="400" y="110" width="18" height="18" fill="#4CD3A5" transform="rotate(30 409 119)"/><circle cx="430" cy="300" r="9" fill="#FF4D6D"/>`) },
  { id: 'thinking', alt: '🤔', en: 'Thinking', ar: 'أفكر', svg: wrap(`${body()}${eyesOpen}<path d="M226 292h60" stroke="${INK}" stroke-width="12" stroke-linecap="round"/><g transform="translate(300 330)"><rect x="-28" y="-18" width="56" height="44" rx="18" fill="${BODY_DARK}"/><rect x="-24" y="-56" width="20" height="44" rx="10" fill="${BODY_DARK}"/></g><text x="380" y="130" font-family="DejaVu Sans" font-weight="bold" font-size="96" fill="#FFC93C" stroke="${INK}" stroke-width="5" paint-order="stroke">?</text>`) },
  { id: 'wow', alt: '😮', en: 'Wow', ar: 'واو', svg: wrap(`${body()}${eyesOpen}${cheeks}<ellipse cx="256" cy="296" rx="26" ry="32" fill="${INK}"/>`) },
  { id: 'coffee', alt: '☕', en: 'Coffee', ar: 'قهوة', svg: wrap(`${body()}${eyesHappy}${cheeks}${smile}<g transform="translate(386 300)"><rect x="-44" y="-40" width="76" height="80" rx="14" fill="#fff" stroke="${INK}" stroke-width="8"/><path d="M32 -20q34 0 34 22t-34 22" stroke="${INK}" stroke-width="8" fill="none"/><rect x="-36" y="-30" width="60" height="18" fill="#8B5A3C"/><path d="M-20 -60q-8-14 0-26M4 -60q-8-14 0-26" stroke="#9AA9B6" stroke-width="6" fill="none" stroke-linecap="round"/></g>`) },
  { id: 'heart', alt: '❤️', en: 'Heart', ar: 'قلب', svg: wrap(`${body()}${eyesHappy}${cheeks}${smile}${heart(392, 300, 1.4)}`) },
  { id: 'thanks_ar', alt: '🙏', en: 'Thank you (Arabic)', ar: 'شكراً', svg: textSticker('شكراً', true, '#2BAE66') },
  { id: 'hello_ar', alt: '👋', en: 'Hello (Arabic)', ar: 'مرحبا', svg: textSticker('مرحبا', true, '#F28C28') },
  { id: 'thanks_en', alt: '🙏', en: 'Thanks', ar: 'شكراً (إنجليزي)', svg: textSticker('Thanks!', false, '#2BAE66') },
  { id: 'ok_en', alt: '👌', en: 'OK', ar: 'تمام (إنجليزي)', svg: textSticker('OK!', false, '#F28C28') },
];
