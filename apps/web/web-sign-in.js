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
  },
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
  return text.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (digit) => String(digit.charCodeAt(0) & 0x0f))
    .replace(/[^0-9]/g, '').slice(0, 6);
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

export function createSignInView({ container, getLanguage, setLanguage, requestCode, verifyCode, signOut }) {
  let view = 'loading';
  let email = '';
  let code = '';
  let busy = false;
  let generation = 0;
  let error = '';
  let note = '';
  let resendAt = 0;
  let timer;

  function transition(next) {
    generation += 1;
    email = '';
    code = '';
    busy = false;
    error = '';
    note = '';
    resendAt = 0;
    view = next;
    render();
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

  function render(focusTarget) {
    clearInterval(timer);
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
    } else if (view === 'email' || view === 'code') {
      const isCode = view === 'code';
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
