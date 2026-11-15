import {
  common as enCommon, signInMethods as enMethods, emailChange as enEmail, phoneLink as enPhone,
  phoneAuth as enPhoneAuth, settings as enSettings,
} from '../mobile/src/i18n/en.json';
import {
  common as arCommon, signInMethods as arMethods, emailChange as arEmail, phoneLink as arPhone,
  phoneAuth as arPhoneAuth, settings as arSettings,
} from '../mobile/src/i18n/ar.json';
import { availableCountries, flagEmoji } from '../mobile/src/lib/countries.ts';
import { emailChangeErrorInfo, formatOwnPhone, isPlausibleEmail } from '../mobile/src/lib/signInMethods.helpers.ts';
import { formatCountdown, phoneLinkErrorInfo, secondsLeft, toE164 } from '../mobile/src/lib/phoneLink.helpers.ts';
import { phoneAuthErrorInfo } from '../mobile/src/lib/phoneAuth.flow.ts';

const copy = {
  en: { common: enCommon, signInMethods: enMethods, emailChange: enEmail, phoneLink: enPhone, phoneAuth: enPhoneAuth, settings: enSettings },
  ar: { common: arCommon, signInMethods: arMethods, emailChange: arEmail, phoneLink: arPhone, phoneAuth: arPhoneAuth, settings: arSettings },
};
const extra = {
  en: {
    loading: 'Loading…',
    country: 'Country code', countryEmpty: 'SMS verification is unavailable for all countries right now.',
    pinHelp: 'Use a six-digit PIN to confirm your identity when re-registering on another device.',
    pin: 'New PIN', confirmPin: 'Confirm PIN', pinInvalid: 'Enter a six-digit PIN.',
    pinMismatch: 'The PINs do not match.', pinSaved: 'Security PIN saved.',
    pinFailed: 'The PIN could not be saved. Try again.',
    pinSecure: 'Open OfflineSMS over HTTPS to change your PIN.',
  },
  ar: {
    loading: 'جارٍ التحميل…',
    country: 'رمز الدولة', countryEmpty: 'التحقق عبر الرسائل النصية غير متاح لأي دولة حاليًا.',
    pinHelp: 'استخدم رمزًا من ستة أرقام لتأكيد هويتك عند إعادة التسجيل على جهاز آخر.',
    pin: 'رمز PIN الجديد', confirmPin: 'تأكيد رمز PIN', pinInvalid: 'أدخل رمز PIN من ستة أرقام.',
    pinMismatch: 'الرمزان غير متطابقين.', pinSaved: 'تم حفظ رمز PIN للأمان.',
    pinFailed: 'تعذّر حفظ رمز PIN. حاول مرة أخرى.',
    pinSecure: 'افتح OfflineSMS عبر HTTPS لتغيير رمز PIN.',
  },
};

function translate(locale, key, params = {}) {
  const path = key.split('.');
  const source = copy[locale] ?? copy.en;
  const template = path.reduce((value, piece) => value?.[piece], source) ?? extra[locale]?.[key] ?? extra.en[key] ?? '';
  return template.replace(/{{(\w+)}}/g, (_, name) => String(params[name] ?? ''));
}

function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content) element.textContent = content;
  return element;
}

function primary(label) {
  const button = node('button', 'feature-button feature-primary', label);
  button.type = 'submit';
  return button;
}

function action(label, run) {
  const button = node('button', 'feature-button', label);
  button.type = 'button';
  button.addEventListener('click', run);
  return button;
}

function labelled(label, input) {
  const wrapper = node('label', 'feature-field');
  wrapper.append(node('span', '', label), input);
  return wrapper;
}

function checkbox(label, checked, change) {
  const input = node('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => change(input.checked));
  const wrapper = node('label');
  wrapper.append(input, document.createTextNode(` ${label}`));
  return { input, wrapper };
}

function digits(value) {
  return value.replace(/[٠-٩۰-۹]/g, character => String(character.codePointAt(0) & 15)).replace(/\D/g, '');
}

function codeInput({ privateValue = false } = {}) {
  const input = node('input', 'feature-input');
  input.type = privateValue ? 'password' : 'text';
  input.inputMode = 'numeric';
  input.autocomplete = privateValue ? 'off' : 'one-time-code';
  input.maxLength = 6;
  input.dir = 'ltr';
  input.required = true;
  input.addEventListener('input', () => { input.value = digits(input.value).slice(0, 6); });
  return input;
}

function createPanel({ title, showDialog, isActive }) {
  const root = node('div', 'feature-form');
  const body = node('div', 'feature-form');
  const status = node('p', 'dialog-note');
  status.setAttribute('role', 'status');
  root.append(body, status);
  showDialog(title, root);
  const controller = new AbortController();
  const dialog = root.closest('dialog');
  dialog?.addEventListener('close', () => controller.abort(), { once: true });
  let busy = false;
  let error = '';
  const active = () => !controller.signal.aborted && isActive() && root.isConnected && (!dialog || dialog.open);

  function renderStatus() {
    status.textContent = error;
    status.hidden = !error;
  }

  function setBody(...children) {
    if (!active()) return;
    body.replaceChildren(...children);
    body.querySelector('input, select, button')?.focus({ preventScroll: true });
    renderStatus();
  }

  async function run(operation, onError) {
    if (busy || !active()) return;
    busy = true;
    error = '';
    renderStatus();
    const controls = [...body.querySelectorAll('button, input, select')].filter(control => !control.disabled);
    for (const control of controls) control.disabled = true;
    root.setAttribute('aria-busy', 'true');
    try {
      await operation();
    } catch (e) {
      if (active()) {
        error = onError(e);
        renderStatus();
      }
    } finally {
      busy = false;
      if (active()) {
        for (const control of controls) control.disabled = false;
        root.removeAttribute('aria-busy');
      }
    }
  }

  return { active, setBody, run, signal: controller.signal };
}

function codeForm({
  panel, t, label, prompt, expiresAt, resendAt, onConfirm, onResend, onBack, backLabel,
}) {
  const form = node('form', 'feature-form');
  const input = codeInput();
  const submit = primary(t('phoneLink.reauthConfirm'));
  const expiry = node('p', 'dialog-note');
  const resend = action(t('signInMethods.reauthResend'), onResend);
  form.append(node('p', 'dialog-note', prompt), labelled(label, input), submit, expiry, resend);
  if (onBack) form.append(action(backLabel || t('common.back'), onBack));
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (input.value.length !== 6) return;
    const code = input.value;
    input.value = '';
    onConfirm(code);
  });

  function update() {
    const now = Date.now();
    const remaining = secondsLeft(expiresAt, now);
    const cooldown = secondsLeft(resendAt(), now);
    expiry.textContent = expiresAt ? (remaining
      ? t('phoneLink.codeExpiresIn', { time: formatCountdown(remaining) })
      : t('phoneLink.errors.codeExpired')) : '';
    expiry.hidden = !expiry.textContent;
    const busy = Boolean(form.closest('[aria-busy="true"]'));
    if (!busy) {
      submit.disabled = Boolean(expiresAt && !remaining);
      resend.disabled = cooldown > 0;
    }
    resend.textContent = cooldown
      ? t('phoneLink.resendIn', { time: formatCountdown(cooldown) })
      : t('signInMethods.reauthResend');
    if (form.isConnected && panel.active() && (remaining || cooldown || !expiresAt || busy)) setTimeout(update, 1000);
  }
  panel.setBody(form);
  update();
}

function labelDescription(t, value, recovery) {
  const description = node('span');
  if (recovery) {
    description.textContent = recovery;
    return description;
  }
  const formatted = node('bdi', '', value || t('signInMethods.notAdded'));
  description.append(formatted, document.createTextNode(` · ${t(value ? 'signInMethods.edit' : 'signInMethods.add')}`));
  return description;
}

export function createSettingsAccountSecurity({
  locale, client, user, row, showDialog, closeDialog, isActive, announce, onAccountRefreshed,
}) {
  const t = (key, params) => translate(locale, key, params);
  const emailLabel = t('signInMethods.email');
  const phoneLabel = t('phoneLink.settingsRow');
  const pinLabel = t('settings.securityPin');
  let methods = { email: user.email ?? null, phone: user.phoneNumber ?? null };
  const email = row({ label: emailLabel, icon: 'email',
    description: labelDescription(t, methods.email), onClick: () => openMethod('email') });
  const phone = row({ label: phoneLabel, icon: 'phone',
    description: labelDescription(t, formatOwnPhone(methods.phone)), onClick: () => openMethod('phone') });
  const pin = row({ label: pinLabel, icon: 'securityPin', onClick: openPin });

  function publishMethods(next) {
    if (!isActive() || !next) return;
    methods = next;
    const pending = next.emailChange?.pendingRecovery ? t('emailChange.settingsRowRecover') : '';
    email.querySelector('.settings-row-description')?.replaceChildren(labelDescription(t, methods.email, pending));
    phone.querySelector('.settings-row-description')?.replaceChildren(labelDescription(t, formatOwnPhone(methods.phone)));
    onAccountRefreshed?.({ email: methods.email, phone: methods.phone });
  }

  Promise.resolve().then(() => isActive() && client.settingsAccountSecurity(user.uid).getMethods())
    .then(publishMethods).catch(() => {});

  function openPin() {
    if (!isActive()) return;
    const panel = createPanel({ title: pinLabel, showDialog, isActive });
    const form = node('form', 'feature-form');
    const first = codeInput({ privateValue: true });
    const second = codeInput({ privateValue: true });
    form.append(node('p', 'dialog-note', t('pinHelp')), labelled(t('pin'), first),
      labelled(t('confirmPin'), second), primary(t('common.save')));
    form.addEventListener('submit', event => {
      event.preventDefault();
      const chosen = first.value;
      const confirmed = second.value;
      first.value = second.value = '';
      void panel.run(async () => {
        if (chosen.length !== 6 || confirmed.length !== 6) throw new Error('pinInvalid');
        if (chosen !== confirmed) throw new Error('pinMismatch');
        await client.settingsAccountSecurity(user.uid).setPin(chosen);
        if (panel.active()) {
          closeDialog();
          announce(t('pinSaved'));
        }
      }, error => t(error?.message === 'pin-requires-secure-context' ? 'pinSecure'
        : ['pinInvalid', 'pinMismatch'].includes(error?.message) ? error.message : 'pinFailed'));
    });
    panel.setBody(form);
  }

  function openMethod(kind) {
    if (!isActive()) return;
    const isPhone = kind === 'phone';
    const ns = isPhone ? 'phoneLink' : 'emailChange';
    const editing = Boolean(methods[kind]);
    const panel = createPanel({
      title: t(isPhone ? (editing ? 'phoneLink.titleChange' : 'phoneLink.title')
        : (editing ? 'emailChange.titleChange' : 'emailChange.titleAdd')),
      showDialog, isActive,
    });
    let security;
    let phoneStatus;
    let emailChallengeId;
    let destination = '';
    let countryCode = '';
    let owned = false;
    let consenting = false;
    let challenge;
    let resendAt = 0;
    let confirmationAt = 0;
    let confirmationResume;

    function message(key) { return node('p', 'dialog-note', t(key)); }

    function mapError(info) {
      return t(info.key, { time: formatCountdown(info.retryAfterSec ?? 0), count: info.attemptsLeft ?? 0 })
        || t(`${ns}.errors.generic`);
    }

    function errorMessage(error) {
      const info = isPhone ? phoneLinkErrorInfo(error) : emailChangeErrorInfo(error);
      if (info.retryAfterSec) resendAt = Date.now() + info.retryAfterSec * 1000;
      if (info.needsReauth) showConfirmation(load);
      if (info.canResume) showRecovery();
      return mapError(info);
    }

    async function load() {
      security ??= client.settingsAccountSecurity(user.uid);
      const next = await security.getMethods();
      if (!panel.active()) return;
      publishMethods(next);
      if (!isPhone) {
        const state = next.emailChange;
        emailChallengeId = state?.pendingChallengeId ?? emailChallengeId;
        if (state?.pendingRecovery && (!emailChallengeId || state.reauthRequired)) showConfirmation(load);
        else if (state?.pendingRecovery) showRecovery();
        else if (!state?.available) panel.setBody(message('emailChange.errors.unavailable'));
        else if (state.reauthRequired) showConfirmation(load);
        else showEntry();
        return;
      }
      const state = await security.getPhoneLinkStatus();
      if (!panel.active()) return;
      phoneStatus = state;
      if (!state?.available) panel.setBody(message('phoneLink.errors.unavailable'));
      else if (state.pendingRecovery) showRecovery();
      else if (!state.eligible) panel.setBody(message('phoneLink.notEligible'));
      else if (state.sendingPaused) panel.setBody(message('phoneLink.errors.servicePaused'));
      else if (state.reauthRequired) showConfirmation(load);
      else showEntry();
    }

    function showConfirmation(afterwards) {
      confirmationResume = afterwards;
      const methodsAvailable = ['email', 'phone'].filter(method => methods[method]);
      if (!methodsAvailable.length) {
        panel.setBody(message('signInMethods.reauthNoMethod'));
        return;
      }
      const method = node('select', 'feature-input');
      for (const candidate of methodsAvailable) {
        const label = t(candidate === 'phone' ? 'signInMethods.viaPhone' : 'signInMethods.viaEmail');
        const option = node('option', '', label);
        option.value = candidate;
        method.append(option);
      }
      const form = node('form', 'feature-form');
      const prompt = node('p', 'dialog-note');
      const update = () => {
        const selected = method.value;
        prompt.textContent = t(selected === 'phone' ? 'signInMethods.reauthBodyPhone' : 'signInMethods.reauthBodyEmail',
          { target: selected === 'phone' ? formatOwnPhone(methods.phone) : methods.email });
      };
      method.addEventListener('change', update);
      form.append(prompt, labelled(t('phoneLink.reauthConfirm'), method), primary(t('signInMethods.reauthSend')));
      form.addEventListener('submit', event => {
        event.preventDefault();
        sendConfirmationCode(method.value);
      });
      update();
      panel.setBody(form);
    }

    function sendConfirmationCode(method) {
      if (confirmationAt > Date.now()) return;
      const target = methods[method];
      const confirmationError = error => {
        const info = method === 'phone' ? phoneAuthErrorInfo(error) : emailChangeErrorInfo(error);
        if (info.retryAfterSec) confirmationAt = Date.now() + info.retryAfterSec * 1000;
        if (info.key.endsWith('.sessionExpired')) showConfirmation(confirmationResume);
        return mapError(info);
      };
      void panel.run(async () => {
        const confirmation = await security.sendConfirmation(method, target, panel.signal);
        confirmationAt = Date.now() + (confirmation?.resendAfterSec || 0) * 1000;
        codeForm({
          panel, t, label: t('signInMethods.reauthCodeLabel'),
          prompt: t(method === 'phone' ? 'phoneLink.codeBody' : 'emailChange.codeBody', {
            phone: confirmation?.maskedPhone || formatOwnPhone(target), email: target,
          }),
          expiresAt: confirmation?.expiresAtMs, resendAt: () => confirmationAt,
          onConfirm: code => panel.run(async () => {
            await security.verifyConfirmation(code, panel.signal);
            if (panel.active()) await confirmationResume();
          }, confirmationError),
          onResend: () => sendConfirmationCode(method),
          onBack: () => { confirmationAt = 0; showConfirmation(confirmationResume); },
        });
      }, confirmationError);
    }

    function showEntry() {
      const form = node('form', 'feature-form');
      const input = node('input', 'feature-input');
      input.dir = 'ltr';
      input.required = true;
      input.value = destination;
      input.addEventListener('input', () => { destination = input.value; });
      let send;
      if (isPhone) {
        const countries = availableCountries(Array.isArray(phoneStatus?.countries) ? phoneStatus.countries : []);
        if (!countries.length) { panel.setBody(message('countryEmpty')); return; }
        form.append(message(editing ? 'phoneLink.numberBodyChange' : 'phoneLink.numberBody'));
        const country = node('select', 'feature-input');
        country.dir = 'ltr';
        for (const item of countries) {
          const option = node('option', '', `${flagEmoji(item.code)} ${item.name} (${item.dial})`);
          option.value = item.code;
          country.append(option);
        }
        if (countries.some(item => item.code === countryCode)) country.value = countryCode;
        country.addEventListener('change', () => { countryCode = country.value; });
        input.type = 'tel';
        input.autocomplete = 'tel-national';
        input.maxLength = 24;
        const ownership = checkbox(t('phoneLink.ownershipConfirm'), owned, value => { owned = value; });
        const consent = checkbox(t('phoneLink.smsConsent'), consenting, value => { consenting = value; });
        ownership.input.required = consent.input.required = true;
        form.append(labelled(t('country'), country), labelled(t('phoneLink.numberLabel'), input), ownership.wrapper, consent.wrapper);
        send = () => {
          const selected = countries.find(item => item.code === country.value);
          const phoneE164 = selected ? toE164(selected.dial, digits(input.value)) : '';
          requestCode(() => {
            if (!/^\+[1-9][0-9]{6,14}$/.test(phoneE164)) throw new Error('number-not-supported');
            if (!ownership.input.checked || !consent.input.checked) throw new Error('consent-required');
            countryCode = selected.code;
            return security.requestPhone(phoneE164, phoneStatus.consentVersion);
          });
        };
      } else {
        if (methods.email) form.append(node('p', 'dialog-note', t('emailChange.current', { email: methods.email })));
        form.append(message(editing ? 'emailChange.bodyChange' : 'emailChange.bodyAdd'));
        input.type = 'email';
        input.autocomplete = 'email';
        input.spellcheck = false;
        input.maxLength = 254;
        form.append(labelled(t('emailChange.label'), input));
        send = () => {
          const address = input.value.trim();
          requestCode(() => {
            if (!isPlausibleEmail(address)) throw new Error('email-invalid');
            return security.requestEmail(address);
          });
        };
      }
      form.append(primary(t(`${ns}.sendCode`)));
      form.addEventListener('submit', event => { event.preventDefault(); send(); });
      panel.setBody(form);
    }

    function requestCode(send) {
      if (resendAt > Date.now()) return;
      void panel.run(async () => {
        challenge = await send();
        resendAt = Date.now() + (challenge.resendAfterSec || 0) * 1000;
        if (!isPhone) emailChallengeId = challenge.challengeId;
        codeForm({
          panel, t, label: t(`${ns}.codeLabel`),
          prompt: t(`${ns}.codeBody`, { phone: challenge.maskedPhone, email: challenge.maskedEmail }),
          expiresAt: challenge.expiresAtMs, resendAt: () => resendAt,
          onConfirm: code => panel.run(async () => {
            const result = await (isPhone ? security.verifyPhone(challenge.challengeId, code)
              : security.verifyEmail(challenge.challengeId, code));
            showDone(result);
          }, errorMessage),
          onResend: () => requestCode(send),
          onBack: showEntry,
          backLabel: t(isPhone ? 'phoneLink.changeNumber' : 'emailChange.useDifferent'),
        });
      }, errorMessage);
    }

    function showRecovery() {
      panel.setBody(message(`${ns}.recoverBody`),
        action(t(`${ns}.recoverButton`), () => panel.run(async () => {
          if (!isPhone && !emailChallengeId) {
            emailChallengeId = (await security.getMethods()).emailChange?.pendingChallengeId;
            if (!emailChallengeId) { showConfirmation(load); return; }
          }
          if (!panel.active()) return;
          showDone(await (isPhone ? security.resumePhone() : security.resumeEmail(emailChallengeId)));
        }, errorMessage)));
    }

    function showDone(result) {
      if (!panel.active()) return;
      const key = editing ? `${ns}.doneChange` : (isPhone ? 'phoneLink.done' : 'emailChange.doneAdd');
      panel.setBody(node('p', 'dialog-note', t(key, { phone: result.maskedPhone, email: result.email || result.maskedEmail })),
        action(t('phoneLink.doneButton'), closeDialog));
      void security.getMethods().then(publishMethods).catch(() => {});
    }

    panel.setBody(message('loading'));
    void panel.run(load, error => {
      panel.setBody(action(t('common.retry'), () => panel.run(load, errorMessage)));
      return errorMessage(error);
    });
  }

  return { email, phone, pin };
}
