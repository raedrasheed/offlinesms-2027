const copy = {
  ar: {
    heading: 'الدخول إلى OfflineSMS',
    introduction: 'استخدم البريد المرتبط بحسابك لفتح محادثاتك على الويب. إذا كان البريد جديدًا، يُنشأ حساب بعد التحقق منه.',
    email: 'البريد الإلكتروني',
    send: 'إرسال رمز التحقق',
    sending: 'جارٍ إرسال الرمز…',
    codeHeading: 'أدخل رمز التحقق',
    sentTo: 'أرسلنا رمزًا من 6 أرقام إلى',
    code: 'رمز التحقق',
    verify: 'تحقّق وسجّل الدخول',
    verifying: 'جارٍ التحقق…',
    resend: 'إعادة إرسال الرمز',
    resendWait: (seconds) => `إعادة الإرسال خلال ${seconds} ث`,
    sentAgain: 'أرسلنا رمزًا جديدًا. استخدم آخر رمز وصلك.',
    changeEmail: 'تغيير البريد',
    invalidCode: 'أدخل رمز التحقق المكوّن من 6 أرقام.',
    rejectedCode: 'تعذّر قبول الرمز. تحقق من آخر رمز وصلك أو اطلب رمزًا جديدًا.',
    requestLimit: 'يرجى الانتظار قليلًا قبل طلب رمز آخر.',
    requestFailed: 'تعذّر إرسال رمز التحقق. حاول مرة أخرى.',
    unavailable: 'تسجيل الدخول بالبريد غير متاح حاليًا.',
    verificationFailed: 'تعذّر إكمال تسجيل الدخول. اطلب رمزًا جديدًا وحاول مرة أخرى.',
    loading: 'جارٍ الاتصال بـ OfflineSMS…',
    connectionError: 'تعذّر الاتصال بـ OfflineSMS',
    connectionHelp: 'تحقق من اتصالك بالإنترنت وأعد تحميل الصفحة.',
    blocked: 'الحساب غير متاح',
    blockedHelp: 'تعذّر فتح الحساب على الويب. يمكنك تسجيل الخروج واستخدام حساب آخر.',
    signOut: 'تسجيل الخروج',
    retry: 'إعادة التحميل',
    alternateLanguage: 'English',
    continuePhone: 'المتابعة برقم الهاتف',
    continueEmail: 'المتابعة بالبريد الإلكتروني',
    phoneTitle: 'رقم هاتفك',
    phoneSubtitle: 'سنرسل لك رمزًا من 6 أرقام. قد تُطبّق رسوم المشغّل.',
    phonePrivacy: 'لا تتم مشاركة رقمك مع جهات الاتصال.',
    country: 'اختر الدولة',
    nationalNumber: 'رقم الجوال',
    countryLoading: 'جارٍ تحميل الدول المتاحة…',
    countryError: 'تعذّر تحميل الدول المتاحة. اضغط لإعادة المحاولة.',
    countryEmpty: 'لا توجد دول متاحة للتسجيل حاليًا.',
    phoneSend: 'إرسال الرمز',
    phoneVerify: 'تحقق من رقمك',
    phoneSent: 'أُرسل الرمز إلى',
    phoneDidNotReceive: 'لم تستلم الرمز؟',
    phoneResendWait: (time) => `إعادة الإرسال ${time}`,
    changePhone: 'استخدم رقمًا آخر',
  },
  en: {
    heading: 'Sign in to OfflineSMS',
    introduction: 'Use your OfflineSMS email to open your chats on the web. A new email creates an account after verification.',
    email: 'Email address',
    send: 'Send verification code',
    sending: 'Sending code…',
    codeHeading: 'Enter the verification code',
    sentTo: 'We sent a 6-digit code to',
    code: 'Verification code',
    verify: 'Verify and sign in',
    verifying: 'Verifying…',
    resend: 'Resend code',
    resendWait: (seconds) => `Resend in ${seconds}s`,
    sentAgain: 'We sent a new code. Use the latest code in your inbox.',
    changeEmail: 'Change email',
    invalidCode: 'Enter the 6-digit verification code.',
    rejectedCode: 'The code was not accepted. Check the latest code in your inbox or request a new one.',
    requestLimit: 'Wait a little before requesting another code.',
    requestFailed: 'We could not send a verification code. Try again.',
    unavailable: 'Email sign-in is currently unavailable.',
    verificationFailed: 'We could not finish signing in. Request a new code and try again.',
    loading: 'Connecting to OfflineSMS…',
    connectionError: 'Could not connect to OfflineSMS',
    connectionHelp: 'Check your internet connection and reload the page.',
    blocked: 'Account unavailable',
    blockedHelp: 'This account cannot be opened on the web. You can sign out and use another account.',
    signOut: 'Sign out',
    retry: 'Reload page',
    alternateLanguage: 'العربية',
    continuePhone: 'Continue with phone',
    continueEmail: 'Continue with email',
    phoneTitle: 'Your phone number',
    phoneSubtitle: "We'll text you a 6-digit code. Carrier rates may apply.",
    phonePrivacy: "Your number isn't shared with contacts.",
    country: 'Choose country',
    nationalNumber: 'Mobile number',
    countryLoading: 'Loading available countries…',
    countryError: "Couldn't load available countries. Tap to retry.",
    countryEmpty: 'No countries are currently available for phone sign-in.',
    phoneSend: 'Send code',
    phoneVerify: 'Verify your number',
    phoneSent: 'Code sent to',
    phoneDidNotReceive: "Didn't receive a code?",
    phoneResendWait: (time) => `Resend ${time}`,
    changePhone: 'Use a different number',
  },
};

const phoneErrors = {
  "ar": {
    "unavailable": "تسجيل الدخول برقم الهاتف غير متاح حاليًا. يرجى المتابعة بالبريد الإلكتروني.",
    "servicePaused": "رسائل التحقق متوقفة مؤقتًا. يرجى المحاولة لاحقًا.",
    "serviceBusy": "نرسل عددًا كبيرًا من الرموز الآن. يرجى المحاولة بعد {{time}}.",
    "numberNotSupported": "هذا الرقم غير مدعوم. أدخل رقم جوال يبدأ بـ 59 أو 56.",
    "countryUnavailable": "تسجيل الدخول عبر SMS غير متاح لهذه الدولة بعد.",
    "sessionExpired": "انتهت جلسة تسجيل الدخول. يرجى البدء من جديد.",
    "sessionExhausted": "طلبت رموزًا كثيرة في هذه المحاولة. يرجى البدء من جديد لاحقًا.",
    "cooldown": "يرجى الانتظار {{time}} قبل طلب رمز آخر.",
    "rateLimited": "طلبت رموزًا كثيرة. حاول مجددًا بعد {{time}}.",
    "tooManyNumbers": "جرّبت أرقامًا مختلفة كثيرة. حاول مجددًا بعد {{time}}.",
    "codeInvalid": "الرمز غير صحيح. المحاولات المتبقية: {{count}}.",
    "codeExpired": "انتهت صلاحية الرمز. اطلب رمزًا جديدًا.",
    "tooManyAttempts": "رموز خاطئة كثيرة. اطلب رمزًا جديدًا لاحقًا.",
    "accountDisabled": "لا يمكن لهذا الحساب تسجيل الدخول. تواصل مع الدعم.",
    "interrupted": "توقف تسجيل الدخول. تم قبول رمزك — أدخل الرمز مرة أخرى لإعادة المحاولة.",
    "network": "مشكلة في الاتصال. تحقّق من الشبكة وأعد المحاولة.",
    "generic": "حدث خطأ ما. يرجى المحاولة مجددًا."
  },
  "en": {
    "unavailable": "Phone sign-in isn't available right now. Please continue with email.",
    "servicePaused": "Verification messages are paused right now. Please try again later.",
    "serviceBusy": "We're sending too many codes right now. Please try again in {{time}}.",
    "numberNotSupported": "This number isn't supported. Enter a mobile number starting with 59 or 56.",
    "countryUnavailable": "Sign-in by SMS isn't available for this country yet.",
    "sessionExpired": "Your sign-in session expired. Please start again.",
    "sessionExhausted": "Too many codes for this attempt. Please start again later.",
    "cooldown": "Please wait {{time}} before requesting another code.",
    "rateLimited": "Too many codes requested. Try again in {{time}}.",
    "tooManyNumbers": "Too many different numbers tried. Try again in {{time}}.",
    "codeInvalid": "That code isn't right. Attempts left: {{count}}.",
    "codeExpired": "That code has expired. Request a new one.",
    "tooManyAttempts": "Too many incorrect codes. Request a new code later.",
    "accountDisabled": "This account can't sign in. Contact support.",
    "interrupted": "Signing in was interrupted. Your code was accepted — tap the code again to retry.",
    "network": "Network problem. Check your connection and try again.",
    "generic": "Something went wrong. Please try again."
  }
};

// Mirrors the existing email OTP endpoint's resend window.
const resendDelay = 60_000;

function node(tag, className = '', content = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content) element.textContent = content;
  return element;
}

function button(label, action, className = 'web-sign-in-link') {
  const element = node('button', className, label);
  element.type = 'button';
  element.addEventListener('click', action);
  return element;
}

function normalizedCode(text) {
  return digitsOnly(text).slice(0, 6);
}

function digitsOnly(text) {
  return text.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (digit) => String(digit.charCodeAt(0) & 0x0f)).replace(/\D/g, '');
}

function phoneDisplay(digits) {
  return [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6)].filter(Boolean).join(' ');
}

function countdown(seconds, language) {
  const formatter = new Intl.NumberFormat(language, { useGrouping: false });
  const twoDigits = new Intl.NumberFormat(language, { minimumIntegerDigits: 2, useGrouping: false });
  return `${formatter.format(Math.floor(seconds / 60))}:${twoDigits.format(seconds % 60)}`;
}

function errorKey(error, verifying) {
  const kind = typeof error?.code === 'string' ? error.code.split('/').at(-1) : '';
  if (!verifying) {
    if (kind === 'resource-exhausted') return 'requestLimit';
    if (kind === 'failed-precondition') return 'unavailable';
    return 'requestFailed';
  }
  if (['invalid-argument', 'failed-precondition', 'deadline-exceeded', 'resource-exhausted', 'permission-denied'].includes(kind)) return 'rejectedCode';
  return 'verificationFailed';
}

export function createSignInView({
  container, getLanguage, setLanguage, requestCode, verifyCode, signOut,
  getPhoneAvailability, requestPhoneCode, verifyPhoneCode, resetPhoneFlow, phoneErrorInfo,
}) {
  let view = 'loading';
  let email = '';
  let code = '';
  let busy = false;
  let generation = 0;
  let error = '';
  let note = '';
  let resendAt = 0;
  let timer;
  let availabilityRequest = 0;
  let countryState = 'idle';
  let countries = [];
  let countryCode = '';
  let nationalNumber = '';
  let challenge;
  let phoneError;
  let phoneOption;
  let phoneRequest;

  function clearPhone() {
    availabilityRequest += 1;
    phoneRequest?.abort();
    phoneRequest = undefined;
    countryState = 'idle';
    countries = [];
    countryCode = '';
    nationalNumber = '';
    challenge = undefined;
    phoneError = undefined;
    resetPhoneFlow?.();
  }

  function transition(next) {
    generation += 1;
    clearPhone();
    email = '';
    code = '';
    busy = false;
    error = '';
    note = '';
    resendAt = 0;
    view = next;
    render();
    if (next === 'email' && getPhoneAvailability && requestPhoneCode && verifyPhoneCode) void loadCountries();
  }

  async function loadCountries() {
    const current = ++availabilityRequest;
    countryState = 'loading';
    if (view === 'phone') render();
    try {
      const result = await getPhoneAvailability();
      if (current !== availabilityRequest) return;
      countries = result?.available && Array.isArray(result.countries) ? result.countries : [];
      countryCode = countries.find((country) => country.code === countryCode)?.code ?? countries[0]?.code ?? '';
      countryState = 'ready';
    } catch {
      if (current !== availabilityRequest) return;
      countries = [];
      countryState = 'error';
    }
    if (view === 'phone') render('field');
    else if (view === 'email' && phoneOption) phoneOption.hidden = !countries.length;
  }

  function openPhone() {
    if (busy) return;
    generation += 1;
    phoneRequest?.abort();
    resetPhoneFlow?.();
    challenge = undefined;
    phoneError = undefined;
    code = '';
    resendAt = 0;
    view = 'phone';
    void loadCountries();
  }

  async function submitPhone(mode) {
    if (busy || (mode === 'resend' && Date.now() < resendAt)) return;
    const verifying = mode === 'verify';
    const first = mode === 'first';
    if (verifying && code.length !== 6) return;
    if (!first && !challenge) return;
    const country = countries.find((item) => item.code === countryCode);
    const local = nationalNumber.replace(/^0+/, '');
    const number = first && country ? country.dial + local : challenge?.number;
    if (first && (!number || local.length < 6 || !/^(59|56)/.test(local) || !/^\+[1-9]\d{7,14}$/.test(number))) {
      phoneError = { key: 'phoneAuth.errors.numberNotSupported' };
      render('field');
      return;
    }

    const current = ++generation;
    const controller = new AbortController();
    phoneRequest = controller;
    busy = true;
    phoneError = undefined;
    if (!verifying) code = '';
    render();
    try {
      if (verifying) {
        await verifyPhoneCode(challenge.id, code, { signal: controller.signal });
        if (current === generation) transition('loading');
      } else {
        const result = await requestPhoneCode(number, { reset: first, signal: controller.signal });
        if (current !== generation) return;
        if (typeof result?.challengeId !== 'string' || !result.challengeId) throw new Error('Missing phone challenge');
        challenge = { id: result.challengeId, masked: result.maskedPhone, number };
        const wait = Number.isFinite(result.resendAfterSec) && result.resendAfterSec >= 0 ? result.resendAfterSec : resendDelay / 1000;
        resendAt = Date.now() + wait * 1000;
        view = 'phoneCode';
      }
    } catch (reason) {
      if (current !== generation) return;
      phoneError = phoneErrorInfo?.(reason) ?? { key: 'phoneAuth.errors.generic' };
      if (verifying) code = '';
      if (mode === 'resend' && Number.isFinite(phoneError.retryAfterSec) && phoneError.retryAfterSec > 0) {
        resendAt = Date.now() + phoneError.retryAfterSec * 1000;
      }
    } finally {
      if (current === generation) {
        phoneRequest = undefined;
        busy = false;
        render('field');
      }
    }
  }

  async function submit(resending = false) {
    if (busy || (resending && Date.now() < resendAt)) return;
    const verifying = view === 'code' && !resending;
    if (verifying && code.length !== 6) {
      error = 'invalidCode';
      render('field');
      return;
    }

    const current = ++generation;
    const requestedAt = Date.now();
    busy = true;
    error = '';
    note = '';
    render();
    try {
      if (verifying) {
        await verifyCode(email, code);
        if (current !== generation) return;
        transition('loading');
      } else {
        await requestCode(email);
        if (current !== generation) return;
        resendAt = requestedAt + resendDelay;
        view = 'code';
        code = '';
        note = resending ? 'sentAgain' : '';
      }
    } catch (reason) {
      if (current !== generation) return;
      error = errorKey(reason, verifying);
    } finally {
      if (current === generation) {
        busy = false;
        render('field');
      }
    }
  }

  function addPhoneError(parent, input, language) {
    if (!phoneError) return;
    const messages = phoneErrors[language];
    const key = typeof phoneError.key === 'string' ? phoneError.key.split('.').at(-1) : '';
    const time = countdown(Math.max(0, Math.ceil(phoneError.retryAfterSec ?? 0)), language);
    const count = new Intl.NumberFormat(language).format(Math.max(0, phoneError.attemptsLeft ?? 0));
    const content = (Object.hasOwn(messages, key) ? messages[key] : messages.generic)
      .replace('{{time}}', time).replace('{{count}}', count);
    const message = node('p', 'web-sign-in-error', content);
    message.id = 'web-sign-in-phone-error';
    message.setAttribute('role', 'alert');
    input.setAttribute('aria-describedby', message.id);
    if (key === 'numberNotSupported' || key === 'codeInvalid') input.setAttribute('aria-invalid', 'true');
    parent.append(message);
  }

  function renderPhoneEntry(card, t, language) {
    card.append(node('p', 'web-sign-in-copy', t.phoneSubtitle));
    let input;
    if (countryState === 'loading') {
      const notice = node('p', 'web-sign-in-copy', t.countryLoading);
      notice.setAttribute('role', 'status');
      card.append(notice);
    } else if (countryState === 'error') {
      card.append(button(t.countryError, () => { void loadCountries(); }));
    } else if (!countries.length) {
      card.append(node('p', 'web-sign-in-copy', t.countryEmpty));
    } else {
      const form = node('form', 'web-sign-in-form');
      const row = node('div', 'web-sign-in-phone-row');
      const countryLabel = node('label', '', t.country);
      const selector = node('select');
      const names = new Intl.DisplayNames([language], { type: 'region' });
      for (const country of countries) {
        const option = node('option', '', `${names.of(country.code) || country.name} (${country.dial})`);
        option.value = country.code;
        selector.append(option);
      }
      selector.value = countryCode;
      selector.disabled = busy;
      selector.addEventListener('change', () => { countryCode = selector.value; });
      countryLabel.append(selector);

      const numberLabel = node('label', '', t.nationalNumber);
      input = node('input');
      input.type = 'tel';
      input.name = 'phone';
      input.inputMode = 'tel';
      input.autocomplete = 'tel-national';
      input.dir = 'ltr';
      input.required = true;
      input.disabled = busy;
      input.value = phoneDisplay(nationalNumber);
      numberLabel.append(input);
      row.append(countryLabel, numberLabel);
      form.append(row, node('p', 'web-sign-in-copy', t.phonePrivacy));
      addPhoneError(form, input, language);

      const primary = node('button', 'web-sign-in-primary', busy ? t.sending : t.phoneSend);
      primary.type = 'submit';
      primary.disabled = busy || nationalNumber.length < 7;
      input.addEventListener('input', () => {
        nationalNumber = digitsOnly(input.value).slice(0, 15);
        const next = phoneDisplay(nationalNumber);
        if (input.value !== next) input.value = next;
        primary.disabled = busy || nationalNumber.length < 7;
      });
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (nationalNumber.length >= 7) void submitPhone('first');
      });
      form.append(primary);
      card.append(form);
    }
    const alternate = button(t.continueEmail, () => transition('email'));
    alternate.disabled = busy;
    card.append(alternate);
    return input;
  }

  function renderPhoneCode(card, t, language) {
    const description = node('p', 'web-sign-in-copy', `${t.phoneSent} `);
    if (typeof challenge.masked === 'string' && challenge.masked) {
      const address = node('bdi', 'web-sign-in-address', challenge.masked);
      address.dir = 'ltr';
      description.append(address);
    }
    card.append(description);

    const form = node('form', 'web-sign-in-form');
    const label = node('label', 'web-sign-in-otp');
    label.dir = 'ltr';
    label.append(node('span', 'sr-only', t.code));
    const boxes = Array.from({ length: 6 }, () => node('span', 'web-sign-in-otp-box'));
    for (const box of boxes) {
      box.setAttribute('aria-hidden', 'true');
      label.append(box);
    }
    const input = node('input');
    input.type = 'text';
    input.name = 'code';
    input.inputMode = 'numeric';
    input.autocomplete = 'one-time-code';
    input.dir = 'ltr';
    input.required = true;
    input.disabled = busy;
    input.value = code;
    label.append(input);
    form.append(label);
    addPhoneError(form, input, language);
    if (busy) {
      const status = node('p', 'web-sign-in-copy', code.length === 6 ? t.verifying : t.sending);
      status.setAttribute('role', 'status');
      form.append(status);
    }
    function updateBoxes() {
      boxes.forEach((box, index) => {
        box.textContent = code[index] ?? '';
        box.toggleAttribute('data-active', index === code.length);
      });
    }
    updateBoxes();
    input.addEventListener('input', () => {
      code = normalizedCode(input.value);
      if (input.value !== code) input.value = code;
      updateBoxes();
      if (code.length === 6) void submitPhone('verify');
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (code.length === 6) void submitPhone('verify');
    });
    card.append(form);

    const actions = node('div', 'web-sign-in-actions');
    const resend = button(t.resend, () => { void submitPhone('resend'); });
    actions.append(node('p', 'web-sign-in-copy', t.phoneDidNotReceive), resend);
    const change = button(t.changePhone, openPhone);
    change.disabled = busy;
    card.append(actions, change);
    function updateResend() {
      const remaining = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
      resend.disabled = busy || remaining > 0;
      resend.textContent = remaining ? t.phoneResendWait(countdown(remaining, language)) : t.resend;
      if (!remaining) clearInterval(timer);
    }
    if (resendAt > Date.now()) timer = setInterval(updateResend, 1000);
    updateResend();
    return input;
  }

  function render(focusTarget) {
    clearInterval(timer);
    phoneOption = undefined;
    container.hidden = view === 'hidden';
    container.replaceChildren();
    if (container.hidden) return;

    const language = getLanguage() === 'en' ? 'en' : 'ar';
    const t = copy[language];
    const card = node('section', 'web-sign-in-card');
    card.lang = language;
    card.dir = language === 'ar' ? 'rtl' : 'ltr';
    card.setAttribute('aria-labelledby', 'web-sign-in-heading');
    const header = node('div', 'web-sign-in-header');
    const brand = node('div', 'web-sign-in-brand');
    brand.dir = 'ltr';
    const logo = node('img');
    logo.src = './logo.png';
    logo.alt = '';
    logo.width = 42;
    logo.height = 42;
    brand.append(logo, node('span', '', 'OfflineSMS'));
    const switchLanguage = button(t.alternateLanguage, () => {
      setLanguage(language === 'ar' ? 'en' : 'ar');
      render('language');
    });
    switchLanguage.lang = language === 'ar' ? 'en' : 'ar';
    header.append(brand, switchLanguage);
    card.append(header);

    const title = node('h1', '', t[{
      loading: 'loading', error: 'connectionError', blocked: 'blocked', code: 'codeHeading', email: 'heading',
      phone: 'phoneTitle', phoneCode: 'phoneVerify',
    }[view]]);
    title.id = 'web-sign-in-heading';
    if (view === 'loading') title.setAttribute('role', 'status');
    card.append(title);

    let input;
    if (view === 'blocked') {
      const logout = button(t.signOut, async () => {
        logout.disabled = true;
        try { await signOut(); } catch { logout.disabled = false; }
      }, 'web-sign-in-primary');
      card.append(node('p', 'web-sign-in-copy', t.blockedHelp), logout);
    } else if (view === 'error') {
      card.append(node('p', 'web-sign-in-copy', t.connectionHelp), button(t.retry, () => location.reload(), 'web-sign-in-primary'));
    } else if (view === 'phone') {
      input = renderPhoneEntry(card, t, language);
    } else if (view === 'phoneCode') {
      input = renderPhoneCode(card, t, language);
    } else if (view === 'email' || view === 'code') {
      const isCode = view === 'code';
      if (!isCode) {
        phoneOption = button(t.continuePhone, openPhone, 'web-sign-in-primary web-sign-in-phone-primary');
        phoneOption.hidden = !countries.length;
        phoneOption.disabled = busy;
        card.append(phoneOption);
      }
      const introduction = node('p', 'web-sign-in-copy', isCode ? t.sentTo + ' ' : t.introduction);
      if (isCode) introduction.append(node('bdi', 'web-sign-in-address', email));
      card.append(introduction);

      const form = node('form', 'web-sign-in-form');
      const label = node('label', '', isCode ? t.code : t.email);
      input = node('input', isCode ? 'web-sign-in-code' : '');
      input.type = isCode ? 'text' : 'email';
      input.name = isCode ? 'code' : 'email';
      input.autocomplete = isCode ? 'one-time-code' : 'email';
      input.inputMode = isCode ? 'numeric' : 'email';
      input.dir = 'ltr';
      input.required = true;
      input.disabled = busy;
      input.value = isCode ? code : email;
      input.addEventListener('input', () => {
        if (isCode) {
          code = normalizedCode(input.value);
          if (input.value !== code) input.value = code;
        } else email = input.value.trim();
      });
      label.append(input);
      form.append(label);

      if (error) {
        const message = node('p', 'web-sign-in-error', t[error]);
        message.id = 'web-sign-in-error';
        message.setAttribute('role', 'alert');
        input.setAttribute('aria-describedby', message.id);
        if (error === 'invalidCode' || error === 'rejectedCode') input.setAttribute('aria-invalid', 'true');
        form.append(message);
      } else if (note) {
        const message = node('p', 'web-sign-in-copy', t[note]);
        message.setAttribute('role', 'status');
        form.append(message);
      }
      const primary = node('button', 'web-sign-in-primary', t[isCode ? (busy ? 'verifying' : 'verify') : (busy ? 'sending' : 'send')]);
      primary.type = 'submit';
      primary.disabled = busy;
      form.append(primary);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (isCode) code = normalizedCode(input.value);
        else email = input.value.trim();
        void submit();
      });
      card.append(form);

      if (isCode) {
        const actions = node('div', 'web-sign-in-actions');
        const resend = button(t.resend, () => { void submit(true); });
        const edit = button(t.changeEmail, () => {
          generation += 1;
          code = '';
          error = '';
          note = '';
          view = 'email';
          render('field');
        });
        edit.disabled = busy;
        actions.append(resend, edit);
        card.append(actions);
        function updateResend() {
          const remaining = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
          resend.disabled = busy || remaining > 0;
          resend.textContent = remaining ? t.resendWait(new Intl.NumberFormat(language).format(remaining)) : t.resend;
          if (!remaining) clearInterval(timer);
        }
        if (resendAt > Date.now()) timer = setInterval(updateResend, 1000);
        updateResend();
      }
    }

    const screen = node('main', 'web-sign-in-screen');
    screen.append(card);
    container.append(screen);
    if (focusTarget === 'language') switchLanguage.focus();
    if (focusTarget === 'field') input?.focus();
  }

  return {
    render,
    showLoading: () => transition('loading'),
    showError: () => transition('error'),
    showBlocked: () => transition('blocked'),
    showSignIn: () => transition('email'),
    hide: () => transition('hidden'),
  };
}
