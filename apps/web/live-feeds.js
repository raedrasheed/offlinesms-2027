const copy = {
  ar: {
    status: 'الحالات', clips: 'المقاطع', loading: 'جارٍ التحميل…', refresh: 'تحديث', retry: 'أعد المحاولة',
    unavailable: 'تعذر تحميل هذا المحتوى.', statusEmpty: 'لا توجد حالات متاحة حاليًا.',
    clipsEmpty: 'لا توجد مقاطع متاحة حاليًا.', clipsDisabled: 'المقاطع متوقفة حاليًا.',
    statusExpired: 'انتهت هذه الحالة أو لم تعد متاحة.', chooseStatus: 'اختر حالة لعرضها.',
    newStatus: 'التحديثات الأخيرة', viewedStatus: 'التحديثات المشاهدة', account: 'مستخدم OfflineSMS',
    previous: 'السابق', next: 'التالي', back: 'العودة للحالات', clipFeed: 'قائمة المقاطع العمودية',
    forYou: 'لك', following: 'أتابعهم', loadMore: 'عرض المزيد', swipe: 'اسحب للأعلى أو مرّر للانتقال إلى المقطع التالي.',
    clipUnavailable: 'تعذر تشغيل هذا المقطع.', mediaUnavailable: 'تعذر عرض الوسائط.',
    clipExpired: 'انتهت صلاحية رابط التشغيل.', video: 'فيديو', image: 'صورة الحالة',
  },
  en: {
    status: 'Status', clips: 'Clips', loading: 'Loading…', refresh: 'Refresh', retry: 'Try again',
    unavailable: 'Could not load this content.', statusEmpty: 'No statuses are available right now.',
    clipsEmpty: 'No clips are available right now.', clipsDisabled: 'Clips are currently disabled.',
    statusExpired: 'This status has expired or is no longer available.', chooseStatus: 'Choose a status to view.',
    newStatus: 'Recent updates', viewedStatus: 'Viewed updates', account: 'OfflineSMS user',
    previous: 'Previous', next: 'Next', back: 'Back to statuses', clipFeed: 'Vertical clips feed',
    forYou: 'For you', following: 'Following', loadMore: 'Load more', swipe: 'Swipe up or scroll for the next clip.',
    clipUnavailable: 'Could not play this clip.', mediaUnavailable: 'Could not display this media.',
    clipExpired: 'The playback link expired.', video: 'Video', image: 'Status image',
  },
};

function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function button(label, onClick, className = 'feature-button') {
  const node = element('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function publicUrl(value) {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? value : '';
  } catch { return ''; }
}

function avatar(name, photoURL, ring) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map(part => [...part][0]).join('');
  const face = element('span', 'feature-avatar', initials);
  face.setAttribute('aria-hidden', 'true');
  const url = publicUrl(photoURL);
  if (url) {
    const photo = element('img', 'feature-status-avatar-photo');
    photo.alt = '';
    photo.loading = 'lazy';
    photo.referrerPolicy = 'no-referrer';
    face.replaceChildren(photo);
    photo.addEventListener('error', () => { face.textContent = initials; }, { once: true });
    photo.src = url;
  }
  if (ring === undefined) return face;
  const wrapper = element('span', 'feature-status-ring');
  wrapper.dataset.active = String(ring);
  wrapper.append(face);
  return wrapper;
}

function stopMedia(root) {
  for (const video of root.querySelectorAll('video')) {
    video.pause();
    video.removeAttribute('src');
    video.removeAttribute('poster');
    video.load();
  }
  for (const image of root.querySelectorAll('img')) image.removeAttribute('src');
}

function notice(message, retryLabel, retry) {
  const wrap = element('div', 'live-feed-notice');
  wrap.append(element('p', 'feature-note', message));
  if (retry) wrap.append(button(retryLabel, retry));
  wrap.setAttribute('role', 'status');
  return wrap;
}

function header(title, controls) {
  const node = element('header', 'feature-header live-feed-header');
  node.append(element('h1', '', title));
  if (controls) node.append(controls);
  return node;
}

function activeStatuses(result) {
  const items = Array.isArray(result?.items) ? result.items : [];
  return items.filter(item => typeof item?.statusId === 'string' && item.statusId
    && typeof item.authorId === 'string' && item.authorId && item.expiresAtMs > Date.now())
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
}

export function createLiveFeeds({ panel, getLanguage, call, formatTime }) {
  let current;
  const t = key => (copy[getLanguage()] ?? copy.en)[key];
  const active = session => current === session;
  const invoke = async (name, args = {}) => {
    const result = await call(name, args);
    return result?.data ?? result;
  };
  const time = value => Number.isFinite(value) && value > 0 ? formatTime(value) : '';
  const name = value => typeof value === 'string' && value.trim() ? value : t('account');

  function stop() {
    if (!current) return;
    const { elements, dispose } = current;
    current = undefined;
    dispose?.();
    for (const node of elements) {
      stopMedia(node);
      node.remove();
    }
  }

  function mount(session, ...elements) {
    if (!active(session)) return;
    session.elements = elements;
    panel.replaceChildren(...elements);
    panel.scrollTop = 0;
  }

  function statusFeed(session) {
    const bar = header(t('status'), button(t('refresh'), () => render('status')));
    const layout = element('div', 'feature-split feature-status-layout');
    layout.dataset.view = 'feed';
    const feed = element('div', 'feature-status-feed');
    const list = element('div', 'feature-status-list live-status-list');
    const detail = element('div', 'feature-detail');
    layout.append(feed, detail);
    feed.append(list);
    mount(session, bar, layout);
    list.append(notice(t('loading')));
    detail.append(element('p', 'feature-status-empty', t('chooseStatus')));
    let request = 0;
    let expiry;
    let selectedButton;
    const resetDetails = () => {
      ++request;
      clearTimeout(expiry);
      stopMedia(detail);
      detail.replaceChildren(element('p', 'feature-status-empty', t('chooseStatus')));
    };
    session.dispose = resetDetails;

    async function open(items, index, trigger) {
      resetDetails();
      const revision = request;
      selectedButton?.setAttribute('aria-pressed', 'false');
      trigger.setAttribute('aria-pressed', 'true');
      selectedButton = trigger;
      layout.dataset.view = 'detail';
      const heading = element('div', 'feature-detail-heading');
      const back = button(t('back'), () => {
        resetDetails();
        layout.dataset.view = 'feed';
        trigger.setAttribute('aria-pressed', 'false');
        trigger.focus();
      });
      heading.append(back);
      const viewer = element('article', 'feature-card feature-status-viewer');
      const body = notice(t('loading'));
      viewer.append(heading, body);
      detail.replaceChildren(viewer);
      back.focus({ preventScroll: true });
      const item = items[index];
      try {
        const result = await invoke('getStatus', { statusId: item.statusId });
        if (!active(session) || revision !== request) return;
        const row = result?.item;
        if (row?.statusId !== item.statusId || !(row.expiresAtMs > Date.now())) {
          body.replaceChildren(element('p', 'feature-note', t('statusExpired')));
          return;
        }
        const author = name(row.authorName);
        const authorText = element('span', 'feature-list-copy');
        authorText.append(element('strong', '', author), element('small', '', time(row.createdAtMs)));
        heading.prepend(avatar(author, row.authorPhotoURL), authorText);
        const story = element('div', 'feature-story live-status-story');
        if (typeof row.backgroundColor === 'string' && /^#[0-9a-f]{6}$/i.test(row.backgroundColor)) {
          viewer.style.backgroundColor = row.backgroundColor;
        }
        const url = publicUrl(row.mediaUrl);
        if (row.type === 'video' || row.type === 'image') {
          if (!url) story.append(element('p', '', t('mediaUnavailable')));
          else {
            const image = row.type === 'image';
            const media = element(image ? 'img' : 'video', 'feature-media');
            if (image) {
              media.alt = t('image');
              media.referrerPolicy = 'no-referrer';
            } else {
              media.controls = true;
              media.playsInline = true;
              media.preload = 'metadata';
              media.setAttribute('aria-label', t('video'));
            }
            media.addEventListener('error', () => {
              if (media.parentNode === story) media.replaceWith(element('p', '', t('mediaUnavailable')));
            }, { once: true });
            media.src = url;
            story.append(media);
          }
        }
        if (typeof row.body === 'string' && row.body) story.append(element('p', '', row.body));
        body.replaceWith(story);
        if (items.length > 1) {
          const navigation = element('div', 'feature-toolbar feature-status-pager');
          const previous = button(t('previous'), () => open(items, index - 1, trigger));
          const next = button(t('next'), () => open(items, index + 1, trigger));
          previous.disabled = index === 0;
          next.disabled = index === items.length - 1;
          navigation.append(previous, element('span', '', `${index + 1} / ${items.length}`), next);
          viewer.append(navigation);
        }
        expiry = setTimeout(() => {
          if (!active(session) || revision !== request) return;
          stopMedia(story);
          story.replaceChildren(element('p', '', t('statusExpired')));
        }, Math.min(row.expiresAtMs - Date.now(), 2_147_483_647));
      } catch (error) {
        if (!active(session) || revision !== request) return;
        const code = typeof error?.code === 'string' ? error.code.split('/').pop() : '';
        const unavailable = ['permission-denied', 'not-found', 'failed-precondition'].includes(code);
        body.replaceWith(notice(t(unavailable ? 'statusExpired' : 'unavailable'), t('retry'), unavailable ? null : () => open(items, index, trigger)));
      }
    }

    void invoke('getStatusFeed').then(result => {
      if (!active(session)) return;
      const items = activeStatuses(result);
      if (!items.length) {
        list.replaceChildren(notice(t('statusEmpty')));
        return;
      }
      const groups = new Map();
      for (const item of items) {
        if (!groups.has(item.authorId)) groups.set(item.authorId, []);
        groups.get(item.authorId).push(item);
      }
      list.replaceChildren();
      for (const viewed of [false, true]) {
        const section = element('section', 'feature-status-group');
        section.append(element('h2', 'feature-status-label', t(viewed ? 'viewedStatus' : 'newStatus')));
        for (const updates of groups.values()) {
          if (updates.every(item => item.viewedByMe) !== viewed) continue;
          const newest = updates[0];
          const oldestFirst = [...updates].reverse();
          const firstUnviewed = oldestFirst.findIndex(item => !item.viewedByMe);
          const trigger = button('', () => open(oldestFirst, Math.max(0, firstUnviewed), trigger), 'feature-list-button');
          trigger.setAttribute('aria-pressed', 'false');
          const author = name(newest.authorName);
          const label = element('span', 'feature-list-copy');
          label.append(element('strong', '', author), element('small', '', time(newest.createdAtMs)));
          trigger.append(avatar(author, newest.authorPhotoURL, !viewed), label);
          section.append(trigger);
        }
        if (section.children.length > 1) list.append(section);
      }
    }).catch(() => {
      if (active(session)) list.replaceChildren(notice(t('unavailable'), t('retry'), () => render('status')));
    });
  }

  function clipsFeed(session, mode) {
    const controls = element('div', 'feature-clips-tabs');
    for (const [value, label] of [['forYou', 'forYou'], ['following', 'following']]) {
      const tab = button(t(label), () => render('clips', value), 'feature-clip-tab');
      tab.setAttribute('aria-pressed', String(mode === value));
      controls.append(tab);
    }
    const layout = element('div', 'feature-clips-layout');
    mount(session, header(t('clips'), controls), layout);
    const deck = element('div', 'feature-clip-deck');
    deck.tabIndex = 0;
    deck.setAttribute('role', 'region');
    deck.setAttribute('aria-label', t('clipFeed'));
    const navigation = element('div', 'feature-clip-navigator');
    const previous = button('↑', () => moveTo(index - 1), 'feature-icon-button');
    const next = button('↓', () => moveTo(index + 1), 'feature-icon-button');
    previous.setAttribute('aria-label', t('previous'));
    next.setAttribute('aria-label', t('next'));
    const position = element('span', 'feature-clip-position');
    position.setAttribute('aria-live', 'polite');
    navigation.append(previous, position, next);
    const feedback = element('div', 'live-clip-feedback');
    layout.append(deck, navigation, element('p', 'feature-clip-hint', t('swipe')), feedback);
    const subscriptions = new AbortController();
    const signal = subscriptions.signal;
    const cards = [];
    const ids = new Set();
    const numbers = new Intl.NumberFormat(getLanguage());
    let cursor;
    let index = -1;
    let loading = false;
    let revision = 0;
    let playing;
    let expires;
    let settle;

    function clearVideo() {
      clearTimeout(expires);
      if (!playing) return;
      playing.pause();
      playing.removeAttribute('src');
      playing.removeAttribute('poster');
      playing.load();
      playing.remove();
      playing = undefined;
    }

    async function play(card) {
      clearVideo();
      const attempt = ++revision;
      card.media.replaceChildren(notice(t('loading')));
      try {
        const result = await invoke('getClipPlayback', { clipId: card.id });
        if (!active(session) || attempt !== revision) return;
        const url = publicUrl(result?.url);
        if (!url || !(result.expiresAtMs > Date.now())) throw new Error('playback-unavailable');
        const video = element('video', 'feature-media');
        video.controls = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.muted = true;
        video.loop = true;
        video.setAttribute('controlslist', 'nodownload noremoteplayback');
        video.disablePictureInPicture = true;
        video.setAttribute('aria-label', t('video'));
        const poster = publicUrl(result.thumbnailUrl);
        if (poster) video.poster = poster;
        const playbackFailure = key => {
          if (playing !== video || attempt !== revision || !active(session)) return;
          clearVideo();
          card.media.replaceChildren(notice(t(key), t('retry'), () => play(card)));
        };
        video.addEventListener('error', () => playbackFailure('clipUnavailable'), { once: true });
        playing = video;
        card.media.replaceChildren(video);
        video.src = url;
        expires = setTimeout(() => playbackFailure('clipExpired'), Math.min(result.expiresAtMs - Date.now(), 2_147_483_647));
        if (!document.hidden && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          void video.play().catch(() => { /* Native controls are available. */ });
        }
      } catch {
        if (active(session) && attempt === revision) card.media.replaceChildren(notice(t('clipUnavailable'), t('retry'), () => play(card)));
      }
    }

    function updateNavigation() {
      navigation.hidden = !cards.length;
      previous.disabled = index <= 0;
      next.disabled = index >= cards.length - 1 && !cursor;
      position.textContent = cards.length ? `${numbers.format(index + 1)} / ${numbers.format(cards.length)}` : '';
    }

    function activate(value) {
      if (value === index || !cards[value]) return;
      if (cards[index]?.slide.contains(document.activeElement)) deck.focus({ preventScroll: true });
      cards[index]?.media.replaceChildren();
      index = value;
      for (const [positionIndex, card] of cards.entries()) card.slide.toggleAttribute('inert', positionIndex !== value);
      updateNavigation();
      void play(cards[index]);
    }

    function moveTo(value) {
      if (value < 0) return;
      if (value >= cards.length) {
        if (cursor) void loadPage(true);
        return;
      }
      deck.scrollTop = deck.clientHeight * value;
      activate(value);
    }

    function appendCards(items) {
      for (const clip of items) {
        if (typeof clip?.id !== 'string' || !clip.id || ids.has(clip.id)) continue;
        ids.add(clip.id);
        const author = name(clip.author?.displayName || clip.author?.username);
        const slide = element('section', 'feature-clip-slide');
        slide.setAttribute('aria-label', author);
        slide.setAttribute('inert', '');
        const frame = element('div', 'feature-clip');
        const media = element('div', 'live-clip-media');
        const caption = element('div', 'feature-clip-caption');
        caption.append(element('h2', '', author));
        if (typeof clip.caption === 'string' && clip.caption) caption.append(element('p', '', clip.caption));
        const profile = element('div', 'feature-clip-rail');
        profile.append(avatar(author, clip.author?.photoURL));
        frame.append(media, caption, profile);
        slide.append(frame);
        cards.push({ id: clip.id, slide, media });
        deck.append(slide);
      }
    }

    async function loadPage(advance = false) {
      if (!active(session) || loading) return;
      const start = cards.length;
      const previousCursor = cursor;
      loading = true;
      feedback.replaceChildren(notice(t('loading')));
      try {
        const result = await invoke('getClipsFeed', { mode, limit: 12, ...(previousCursor ? { cursor: previousCursor } : {}) });
        if (!active(session)) return;
        cursor = typeof result?.nextCursor === 'string' && result.nextCursor !== previousCursor ? result.nextCursor : null;
        appendCards(Array.isArray(result?.items) ? result.items : []);
        feedback.replaceChildren();
        if (cards.length && (index === -1 || (advance && cards.length > start))) moveTo(index === -1 ? 0 : start);
        if (cursor && cards.length === start) feedback.append(button(t('loadMore'), () => loadPage(true)));
        if (!cursor && !cards.length) feedback.append(notice(t('clipsEmpty')));
        updateNavigation();
      } catch {
        if (active(session)) feedback.replaceChildren(notice(t('unavailable'), t('retry'), () => loadPage(advance)));
      } finally {
        loading = false;
      }
    }

    updateNavigation();
    deck.addEventListener('scroll', () => {
      clearTimeout(settle);
      settle = setTimeout(() => {
        if (!active(session) || !cards.length || !deck.clientHeight) return;
        const value = Math.max(0, Math.min(cards.length - 1, Math.round(deck.scrollTop / deck.clientHeight)));
        activate(value);
        if (cursor && value === cards.length - 1) void loadPage();
      }, 90);
    }, { passive: true, signal });
    deck.addEventListener('keydown', event => {
      if (event.target !== deck) return;
      const offsets = { ArrowUp: -1, PageUp: -1, ArrowDown: 1, PageDown: 1 };
      const offset = offsets[event.key];
      if (typeof offset !== 'number') return;
      event.preventDefault();
      moveTo(index + offset);
    }, { signal });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) playing?.pause();
    }, { signal });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      if (index >= 0) deck.scrollTop = deck.clientHeight * index;
    }) : null;
    observer?.observe(deck);
    session.dispose = () => {
      subscriptions.abort();
      observer?.disconnect();
      clearTimeout(settle);
      ++revision;
      clearVideo();
    };
    feedback.append(notice(t('loading')));
    void invoke('getClipsConfig').then(result => {
      if (!active(session)) return;
      if (result?.config?.enabled !== true) feedback.replaceChildren(notice(t('clipsDisabled')));
      else void loadPage();
    }).catch(() => {
      if (active(session)) feedback.replaceChildren(notice(t('unavailable'), t('retry'), () => render('clips', mode)));
    });
  }

  function render(section, mode = 'forYou') {
    stop();
    if (section !== 'status' && section !== 'clips') return;
    const session = { elements: [] };
    current = session;
    if (section === 'status') statusFeed(session);
    else clipsFeed(session, mode);
  }

  return { render, stop };
}
