import { attachmentLimit, attachmentMimeAllowed, inferAttachmentMime, MIME_EXTENSIONS, normalizeAttachmentMime } from '../mobile/src/media/attachmentModel.ts';

const copy = {
  en: {
    attach: 'Attach', photos: 'Photos', camera: 'Camera', video: 'Video', file: 'File', location: 'Location',
    contact: 'Contact', poll: 'Poll', audio: 'Audio', gif: 'GIF', send: 'Send', retry: 'Retry',
    caption: 'Caption (optional)', progress: 'Uploading attachment', finishing: 'Sending attachment…',
    invalid: 'Choose a supported file that is not empty.', choosePhoto: 'Choose a photo',
    tooLarge: 'This file exceeds the size limit.', cameraStarting: 'Starting the camera…', capture: 'Take photo',
    cameraFailed: 'Camera unavailable. Check your camera permissions or choose a photo.',
    uploadFailed: 'Could not send the attachment. Try again.', denied: 'You no longer have permission to send in this chat.',
  },
  ar: {
    attach: 'إرفاق', photos: 'الصور', camera: 'الكاميرا', video: 'الفيديو', file: 'ملف', location: 'الموقع',
    contact: 'جهة اتصال', poll: 'استطلاع', audio: 'صوت', gif: 'GIF', send: 'إرسال', retry: 'إعادة المحاولة',
    caption: 'وصف المرفق (اختياري)', progress: 'جارٍ رفع المرفق', finishing: 'جارٍ إرسال المرفق…',
    invalid: 'اختر ملفًا مدعومًا وغير فارغ.', choosePhoto: 'اختر صورة',
    tooLarge: 'يتجاوز حجم الملف الحد المسموح به.', cameraStarting: 'جارٍ تشغيل الكاميرا…', capture: 'التقاط صورة',
    cameraFailed: 'الكاميرا غير متاحة. تحقّق من أذوناتها أو اختر صورة.',
    uploadFailed: 'تعذّر إرسال المرفق. حاول مرة أخرى.', denied: 'لم يعد لديك إذن بالإرسال في هذه المحادثة.',
  },
};

const options = [
  ['photos', 'M3 5h18v14H3Zm0 10 5-4 4 4 3-3 6 5M16 9h.01'],
  ['camera', 'M3 7h4l2-3h6l2 3h4v13H3Zm13 6a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z'],
  ['video', 'M3 6h12v12H3Zm12 4 6-4v12l-6-4'],
  ['file', 'M6 3h8l4 4v14H6Zm8 0v5h4M9 12h6m-6 4h6'],
  ['location', 'M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Zm-5 0a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z'],
  ['contact', 'M5 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z'],
  ['poll', 'M4 19h16M7 15v-4m5 4V5m5 10V8'],
  ['audio', 'M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm11-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z'],
  ['gif', 'M3 5h18v14H3Zm6 7H7v2h2v-4H7m5 0v4m3 0v-4h3m-3 2h2'],
];
const binaryTypes = { photos: 'image', camera: 'image', video: 'video', file: 'file', audio: 'audio', gif: 'gif' };

function node(tag, className, value = '') {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = value;
  return element;
}

function button(value, action, className = 'feature-button') {
  const element = node('button', className, value);
  element.type = 'button';
  element.addEventListener('click', action);
  return element;
}

function icon(path) {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const line = document.createElementNS(namespace, 'path');
  line.setAttribute('d', path);
  svg.append(line);
  return svg;
}

function showNotice(notice, message) {
  notice.textContent = message;
  notice.hidden = !message;
}

function clipboardImageMime(file) {
  return normalizeAttachmentMime(file.type) || inferAttachmentMime(file.name.replace(/\.jpeg$/i, '.jpg'));
}

export function getClipboardImage(clipboard) {
  const isImage = file => file && clipboardImageMime(file).startsWith('image/');
  for (const item of Array.from(clipboard?.items ?? [])) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (isImage(file)) return file;
  }
  return Array.from(clipboard?.files ?? []).find(isImage);
}

export function createChatAttachments({ locale, showDialog, closeDialog, openStructured, sendAttachment, isActive }) {
  const language = typeof locale === 'function' ? locale() : locale;
  const text = copy[language] ?? copy.en;
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  let view;
  let cleanup;
  let lifecycle;

  function close() {
    lifecycle?.disconnect();
    cleanup?.();
    view = cleanup = lifecycle = undefined;
  }

  function active(element) {
    return view === element && element.isConnected && isActive();
  }

  function show(title, element, onClose) {
    close();
    view = element;
    cleanup = onClose;
    showDialog(title, element);
    const modal = element.closest('dialog');
    if (!modal) return;
    lifecycle = new MutationObserver(() => {
      if (view === element && (!modal.open || !active(element))) close();
    });
    lifecycle.observe(modal, { attributes: true, attributeFilter: ['open'], subtree: true, childList: true });
  }

  function fileIssue(file, type, mime = inferAttachmentMime(file.name, file.type)) {
    const attachmentType = type === 'gif' ? 'image' : type;
    if (!file.size || !attachmentMimeAllowed(attachmentType, mime) || type === 'gif' && mime !== 'image/gif') return text.invalid;
    return file.size > attachmentLimit(attachmentType) ? text.tooLarge : '';
  }

  function chooseFile(option, container, notice) {
    if (!active(container)) return;
    container.querySelector('input[type="file"]')?.remove();
    const type = binaryTypes[option];
    const attachmentType = type === 'gif' ? 'image' : type;
    const input = node('input', '');
    input.type = 'file';
    input.hidden = true;
    input.accept = Object.entries(MIME_EXTENSIONS).filter(([mime]) =>
      type === 'gif' ? mime === 'image/gif' : attachmentMimeAllowed(attachmentType, mime),
    ).flatMap(([mime, extension]) => [mime, `.${extension}`]).join(',');
    if (attachmentType === 'image' && type !== 'gif') input.accept += ',.jpeg';
    if (option === 'camera') input.setAttribute('capture', 'environment');
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
      if (!file || !active(container)) return;
      const issue = fileIssue(file, type);
      if (issue) showNotice(notice, issue);
      else showReview(file, option);
    }, { once: true });
    container.append(input);
    input.click();
  }

  function showReview(file, option) {
    const type = binaryTypes[option];
    const form = node('form', 'feature-form chat-attachment-review');
    const image = type === 'image' || type === 'gif';
    const preview = image ? node('img', 'chat-attachment-preview')
      : type === 'video' || type === 'audio' ? node(type, 'chat-attachment-preview') : undefined;
    let url;
    if (preview && typeof URL.createObjectURL === 'function') {
      url = URL.createObjectURL(file);
      if (image) preview.alt = '';
      else { preview.controls = true; preview.preload = 'metadata'; }
      preview.src = url;
      form.append(preview);
    }
    const name = node('strong', 'chat-attachment-filename', file.name);
    name.dir = 'auto';
    form.append(name, node('small', 'chat-attachment-size', `${number.format(file.size / (1024 * 1024))} MiB`));
    const captionLabel = node('label', 'feature-field', text.caption);
    const caption = node('textarea', 'feature-input');
    caption.dir = 'auto';
    caption.maxLength = 1000;
    caption.rows = 2;
    captionLabel.append(caption);
    const progress = node('progress', 'chat-attachment-progress');
    progress.max = 1;
    progress.hidden = true;
    progress.setAttribute('aria-label', text.progress);
    const status = node('p', 'feature-note');
    status.setAttribute('role', 'status');
    status.hidden = true;
    const notice = node('p', 'chat-attachment-error');
    notice.setAttribute('role', 'alert');
    notice.hidden = true;
    const submit = node('button', 'feature-button feature-primary', text.send);
    submit.type = 'submit';
    form.append(captionLabel, progress, status, notice, submit);
    const localId = crypto.randomUUID();
    let request;
    let draft;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!active(form) || request) return;
      request = new AbortController();
      const { signal } = request;
      submit.disabled = true;
      caption.readOnly = true;
      progress.hidden = false;
      progress.value = 0;
      showNotice(status, text.progress);
      showNotice(notice, '');
      draft ??= {
        file, type, caption: caption.value.trim(), localId,
        width: image ? preview?.naturalWidth : preview?.videoWidth,
        height: image ? preview?.naturalHeight : preview?.videoHeight,
        durationMs: Number.isFinite(preview?.duration) ? Math.round(preview.duration * 1000) : undefined,
      };
      try {
        await sendAttachment({
          ...draft, signal,
          onProgress(value) {
            if (signal.aborted || !active(form) || !Number.isFinite(value)) return;
            progress.value = Math.max(0, Math.min(1, value));
            if (value >= .99 && status.textContent !== text.finishing) showNotice(status, text.finishing);
          },
        });
        if (!signal.aborted && active(form)) { close(); closeDialog(); }
      } catch (error) {
        if (signal.aborted || !active(form)) return;
        const denied = /(?:permission-denied|storage\/unauthorized)$/.test(error?.code);
        showNotice(notice, denied ? text.denied : text.uploadFailed);
        showNotice(status, '');
        progress.hidden = true;
        submit.textContent = text.retry;
      } finally {
        request = undefined;
        if (active(form)) submit.disabled = false;
      }
    });
    show(text[option], form, () => {
      request?.abort();
      if (preview?.pause && !preview.paused) preview.pause();
      if (url) URL.revokeObjectURL(url);
    });
  }

  function openCamera() {
    const panel = node('div', 'chat-attachment-camera');
    const video = node('video', 'chat-attachment-preview');
    video.hidden = true;
    video.autoplay = video.muted = video.playsInline = true;
    const notice = node('p', 'feature-note', text.cameraStarting);
    notice.setAttribute('role', 'status');
    let stream;
    const capture = button(text.capture, () => {
      if (!active(panel) || !video.videoWidth || !video.videoHeight) return;
      capture.disabled = true;
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1920 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      try {
        const context = canvas.getContext('2d');
        if (!context) throw new Error('camera-capture-unavailable');
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (!active(panel)) return;
          if (blob?.size && blob.size <= attachmentLimit('image') && blob.type === 'image/jpeg') {
            showReview(new File([blob], `photo-${Date.now()}.jpg`, { type: blob.type }), 'camera');
          } else {
            showNotice(notice, blob?.size > attachmentLimit('image') ? text.tooLarge : text.cameraFailed);
            capture.disabled = false;
          }
        }, 'image/jpeg', .86);
      } catch {
        showNotice(notice, text.cameraFailed);
        capture.disabled = false;
      }
    }, 'feature-button feature-primary');
    capture.dataset.attachmentCamera = 'capture';
    capture.hidden = capture.disabled = true;
    const fallback = button(text.choosePhoto, () => chooseFile('camera', panel, notice));
    fallback.dataset.attachmentCamera = 'file';
    const controls = node('div', 'chat-attachment-camera-actions');
    controls.append(capture, fallback);
    panel.append(video, notice, controls);
    video.addEventListener('loadedmetadata', () => {
      if (!active(panel) || !video.videoWidth || !video.videoHeight) return;
      capture.disabled = capture.hidden = false;
      showNotice(notice, '');
    });
    show(text.camera, panel, () => {
      for (const track of stream?.getTracks() ?? []) track.stop();
      video.srcObject = null;
    });
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.getUserMedia) { showNotice(notice, text.cameraFailed); return; }
    mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }).then((media) => {
      if (!active(panel)) { for (const track of media.getTracks()) track.stop(); return; }
      stream = media;
      video.srcObject = media;
      video.hidden = false;
    }).catch(() => { if (active(panel)) showNotice(notice, text.cameraFailed); });
  }

  function open(issue = '') {
    if (!isActive()) return;
    const menu = node('div', 'chat-attachment-menu');
    const notice = node('p', 'chat-attachment-error');
    notice.setAttribute('role', 'alert');
    showNotice(notice, issue);
    for (const [key, path] of options) {
      const choice = button('', () => {
        if (!active(menu)) return;
        if (key === 'camera') openCamera();
        else if (binaryTypes[key]) chooseFile(key, menu, notice);
        else { close(); openStructured(key); }
      }, 'chat-attachment-option');
      choice.dataset.attachment = key;
      const badge = node('span', 'chat-attachment-icon');
      badge.append(icon(path));
      choice.append(badge, node('span', '', text[key]));
      menu.append(choice);
    }
    menu.append(notice);
    show(text.attach, menu);
  }

  function openImage(file) {
    if (!isActive()) return;
    const issue = fileIssue(file, 'image', clipboardImageMime(file));
    if (issue) open(issue);
    else showReview(file, 'photos');
  }

  return { open, openImage, close };
}
