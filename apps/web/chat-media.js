import { isStickerImage } from '../mobile/src/media/stickerPresentation.ts';
import { validMediaDimensions } from '../mobile/src/media/mediaDimensions.ts';

const mediaTypes = new Set(['image', 'video', 'voice', 'audio', 'file', 'sticker']);
const copy = {
  ar: {
    image: 'فتح الصورة', sticker: 'فتح الملصق', download: 'تنزيل',
    downloading: 'جارٍ التنزيل…', downloadFailed: 'تعذّر التنزيل. حاول مرة أخرى.',
    waiting: 'بانتظار اكتمال رفع المرفق.', uploadFailed: 'تعذّر رفع المرفق.',
  },
  en: {
    image: 'Open image', sticker: 'Open sticker', download: 'Download',
    downloading: 'Downloading…', downloadFailed: 'Could not download. Try again.',
    waiting: 'Waiting for the attachment to finish uploading.', uploadFailed: 'The attachment could not be uploaded.',
  },
};

function element(tag, className = '', value = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value;
  return node;
}

function button(className, label, action) {
  const node = element('button', className, label);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}

function mediaNote(value) {
  const note = element('p', 'chat-media-note', value);
  note.setAttribute('role', 'status');
  return note;
}

function image(src, alt) {
  const node = element('img', 'chat-media-image');
  node.alt = alt;
  node.referrerPolicy = 'no-referrer';
  node.decoding = 'async';
  node.draggable = false;
  node.src = src;
  return node;
}

export function createChatMedia({ t, locale, showDialog, getMedia, getDownloadInfo, downloadMedia, isActive, stickerSource }) {
  const labels = () => copy[locale?.()] ?? copy.en;
  const isSticker = (item) => item.type === 'sticker' || isStickerImage(item);
  const handles = (item) => mediaTypes.has(item.type);
  const pending = new Map();
  const players = new Set();
  const downloads = new Set();
  let playing;
  const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      const load = pending.get(entry.target);
      pending.delete(entry.target);
      load?.();
    }
  }, { rootMargin: '160px 0px' }) : null;

  function mediaPlayer(kind, data, active, onDimensions) {
    const node = element(kind === 'video' ? 'video' : 'audio', `chat-media-player chat-media-${kind}`);
    node.controls = true;
    node.setAttribute('controlslist', 'nodownload');
    node.preload = kind === 'video' ? 'metadata' : 'none';
    node.setAttribute('aria-label', t(kind));
    if (kind === 'video') {
      node.playsInline = true;
      const updateDimensions = () => {
        if (active()) onDimensions(validMediaDimensions(node.videoWidth, node.videoHeight));
      };
      node.addEventListener('loadedmetadata', updateDimensions);
      node.addEventListener('resize', updateDimensions);
      if (data.poster) node.poster = data.poster;
      else if (data.posterPromise) {
        data.posterPromise.then((poster) => {
          if (poster && active() && node.paused && node.currentTime === 0) node.poster = poster;
        }).catch(() => {});
      }
    }
    node.addEventListener('play', () => {
      if (playing && playing !== node && !playing.paused) playing.pause();
      playing = node;
    });
    node.src = data.src;
    return node;
  }

  function stopPlayer(node) {
    if (!node.paused) node.pause();
    if (playing === node) playing = undefined;
  }

  function canDownload(item) {
    if (!item || !handles(item) || item.deletedForEveryone || item.retentionDeleting) return false;
    if (isSticker(item) && stickerSource?.(item.sticker)?.src) return true;
    const media = item.media;
    return Boolean((media?.storagePath || media?.downloadURL)
      && (media.uploadStatus == null || media.uploadStatus === 'uploaded'));
  }

  async function download(item) {
    if (!item || !isActive(item)) return;
    if (!canDownload(item)) throw new Error('media-unavailable');
    const request = new AbortController();
    downloads.add(request);
    try {
      const local = isSticker(item) && stickerSource?.(item.sticker);
      const data = local?.src ? local : getDownloadInfo(item);
      return await downloadMedia(item, data, { signal: request.signal, isActive: () => isActive(item) });
    } catch (error) {
      if (!request.signal.aborted && isActive(item)) throw error;
    } finally {
      downloads.delete(request);
    }
  }

  function createViewerDownload(item, data, active, controllers) {
    const note = mediaNote('');
    note.hidden = true;
    let controller;
    const action = button('feature-button chat-media-download', labels().download, async () => {
      if (!active() || controller) return;
      const request = new AbortController();
      controller = request;
      controllers.add(request);
      action.disabled = true;
      action.textContent = labels().downloading;
      note.hidden = true;
      try {
        await downloadMedia(item, data, { signal: request.signal, isActive: active });
      } catch {
        if (active() && !request.signal.aborted) {
          note.textContent = labels().downloadFailed;
          note.hidden = false;
        }
      } finally {
        controllers.delete(request);
        controller = undefined;
        if (active()) {
          action.disabled = false;
          action.textContent = labels().download;
        }
      }
    });
    return { action, note };
  }

  function showViewer(item, kind, data, alt) {
    if (!isActive(item)) return;
    if (playing) stopPlayer(playing);
    const viewer = element('div', `chat-media-viewer${kind === 'sticker' ? ' chat-media-viewer--sticker' : ''}`);
    const controls = element('div', 'chat-media-actions');
    const controllers = new Set();
    const active = () => viewer.isConnected && viewer.closest('dialog')?.open === true && isActive(item);
    const download = createViewerDownload(item, data, active, controllers);
    controls.append(download.action);
    const node = image(data.src, alt);
    node.addEventListener('error', () => {
      if (!active()) return;
      node.replaceWith(mediaNote(t('mediaUnavailable')));
    }, { once: true });
    viewer.append(node, controls, download.note);
    showDialog(t(kind), viewer, item);
    const dialog = viewer.closest('dialog');
    const parent = viewer.parentNode;
    if (!dialog || !parent) return;
    const detached = new MutationObserver(() => { if (!active()) dispose(); });
    function dispose() {
      for (const controller of controllers) controller.abort();
      controllers.clear();
      dialog.removeEventListener('close', dispose);
      detached.disconnect();
    }
    dialog.addEventListener('close', dispose, { once: true });
    detached.observe(parent, { childList: true });
    download.action.focus();
  }

  function render(item) {
    const kind = isSticker(item) ? 'sticker' : item.type;
    const container = element('div', `chat-media chat-media--${kind}`);
    container.dataset.mediaKind = kind;
    const active = () => container.isConnected && isActive(item);
    function setDimensions(dimensions, sourceWidth = dimensions?.width) {
      if (!dimensions) return;
      const { width, height } = dimensions;
      container.style.setProperty('--chat-media-aspect', `${width} / ${height}`);
      if (kind === 'image' || kind === 'video') {
        container.style.setProperty('--chat-visual-ratio', String(width / height));
        container.style.setProperty('--chat-visual-width', `${sourceWidth}px`);
      }
    }
    const dimensions = validMediaDimensions(item.media?.width, item.media?.height);
    setDimensions(dimensions);

    let busy = false;
    const missing = () => {
      const retry = button('feature-button', t('retry'), () => load(true));
      container.replaceChildren(mediaNote(t('mediaUnavailable')), retry);
    };

    function stickerFallback() {
      container.replaceChildren(element('span', 'chat-media-sticker-fallback', item.sticker?.alt || item.text || '🙂'));
    }

    function show(data) {
      const content = element('div', 'chat-media-content');
      const actions = element('div', 'chat-media-actions');
      const alt = data.alt || item.sticker?.alt || t(kind);
      if (kind === 'image' || kind === 'sticker') {
        const preview = button('chat-media-preview', '', () => {
          if (active()) showViewer(item, kind, data, alt);
        });
        preview.setAttribute('aria-label', labels()[kind]);
        const node = image(data.preview || data.src, alt);
        let triedOriginal = !data.preview || data.preview === data.src;
        if (kind === 'image') node.addEventListener('load', () => {
          if (active()) setDimensions(validMediaDimensions(node.naturalWidth, node.naturalHeight),
            triedOriginal ? node.naturalWidth : dimensions?.width ?? node.naturalWidth);
        });
        node.addEventListener('error', () => {
          if (!active()) return;
          if (!triedOriginal) { triedOriginal = true; node.src = data.src; return; }
          if (kind === 'sticker' && item.type === 'sticker' && !item.media) stickerFallback();
          else preview.replaceWith(mediaNote(t('mediaUnavailable')), button('feature-button', t('retry'), () => load(true)));
        });
        preview.append(node);
        content.append(preview);
      } else if (kind === 'video' || kind === 'voice' || kind === 'audio') {
        const node = mediaPlayer(kind, data, active, setDimensions);
        players.add(node);
        node.addEventListener('error', () => {
          if (!active()) return;
          node.replaceWith(mediaNote(t('mediaUnavailable')));
        }, { once: true });
        content.append(node);
      } else {
        const file = element('p', 'chat-media-file', data.fileName || item.media?.fileName || t('file'));
        file.dir = 'auto';
        content.append(file);
        const open = element('a', 'feature-button chat-media-open', t('mediaLoad'));
        open.href = data.src;
        open.target = '_blank';
        open.rel = 'noopener noreferrer';
        open.addEventListener('click', (event) => { if (!active()) event.preventDefault(); });
        actions.append(open);
      }
      container.replaceChildren(content);
      if (actions.childElementCount) container.append(actions);
    }

    async function load(refresh = false) {
      if (!active() || busy) return;
      busy = true;
      container.setAttribute('aria-busy', 'true');
      container.replaceChildren(mediaNote(t('loading')));
      try {
        const data = await getMedia(item, { refresh });
        if (!active()) return;
        if (!data?.src) throw new Error('media-unavailable');
        show(data);
      } catch {
        if (active()) missing();
      } finally {
        busy = false;
        container.removeAttribute('aria-busy');
      }
    }

    const status = item.media?.uploadStatus;
    const local = kind === 'sticker' && stickerSource?.(item.sticker);
    if (local?.src) show(local);
    else if (kind === 'sticker' && item.type === 'sticker' && !item.media) stickerFallback();
    else if (status === 'pending' || status === 'uploading') container.append(mediaNote(labels().waiting));
    else if (status === 'failed') container.append(mediaNote(labels().uploadFailed));
    else {
      container.append(mediaNote(t('loading')));
      if (observer) { pending.set(container, load); observer.observe(container); }
      else queueMicrotask(load);
    }
    return container;
  }

  function reset() {
    observer?.disconnect();
    pending.clear();
    for (const node of players) stopPlayer(node);
    players.clear();
    for (const controller of downloads) controller.abort();
    downloads.clear();
  }

  function prune() {
    for (const target of pending.keys()) {
      if (target.isConnected) continue;
      observer?.unobserve(target);
      pending.delete(target);
    }
    for (const player of players) {
      if (player.isConnected) continue;
      stopPlayer(player);
      players.delete(player);
    }
  }

  return { render, isSticker, handles, canDownload, download, reset, prune };
}
