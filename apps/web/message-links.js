const linkPattern = /(?:https?:\/\/|www\.)[^\s<>"'«»“”‘’،؛؟\u061c\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069]+/gi;
const linkPrefix = /[\p{L}\p{N}\p{M}_/@:.=+\-\\]/u;
const trailingPunctuation = /[.,!?;:…]+$/u;
const openings = { ')': '(', ']': '[', '}': '{' };

function trimLink(candidate) {
  let value = candidate.replace(trailingPunctuation, '');
  while (Object.hasOwn(openings, value.at(-1))) {
    const closing = value.at(-1);
    if (value.split(closing).length <= value.split(openings[closing]).length) break;
    value = value.slice(0, -1).replace(trailingPunctuation, '');
  }
  return value;
}

export function messageLinks(text) {
  const links = [];
  for (const { 0: candidate, index: start } of text.matchAll(linkPattern)) {
    if (start > 0 && linkPrefix.test(text[start - 1])) continue;
    const value = trimLink(candidate);
    const address = /^www\./i.test(value) ? `https://${value}` : value;
    const authority = address.split('//', 2)[1]?.split(/[/?#]/, 1)[0];
    if (!authority || authority.includes('@') || value.includes('\\')) continue;
    try {
      const url = new URL(address);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        links.push({ start, end: start + value.length, value, href: url.href });
      }
    } catch { /* Invalid URLs stay as message text. */ }
  }
  return links;
}

export function createMessageLink({ value, href }, { inviteCode, openInvite }) {
  const code = inviteCode(href);
  const anchor = document.createElement('a');
  anchor.className = code ? 'message-link message-invite-link' : 'message-link';
  anchor.textContent = value;
  anchor.dir = 'ltr';
  if (code) {
    anchor.href = `/#join=${code}`;
    anchor.addEventListener('click', (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      event.preventDefault();
      openInvite(code);
    });
  } else {
    anchor.href = href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
  }
  return anchor;
}
