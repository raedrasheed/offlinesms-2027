import { normalizeUsername, validateUsername } from '../mobile/src/lib/username.ts';

const copy = {
  ar: {
    displayName: 'الاسم الظاهر', username: 'اسم المستخدم', save: 'حفظ التغييرات', saving: 'جارٍ الحفظ…',
    saved: 'تم حفظ بيانات الحساب.', failed: 'تعذّر حفظ بيانات الحساب. حاول مرة أخرى.',
    taken: 'اسم المستخدم مستخدم بالفعل. اختر اسمًا آخر.', invalid: 'تحقّق من الاسم الظاهر واسم المستخدم.',
    'display-name-required': 'أدخل الاسم الظاهر.', 'display-name-too-long': 'استخدم 60 حرفًا أو أقل للاسم الظاهر.',
    'too-short': 'استخدم 3 أحرف أو أكثر لاسم المستخدم.', 'too-long': 'استخدم 20 حرفًا أو أقل لاسم المستخدم.',
    'invalid-chars': 'استخدم الحروف الإنجليزية والأرقام والنقطة والشرطة السفلية فقط.',
    'edge-punct': 'يجب أن يبدأ اسم المستخدم وينتهي بحرف أو رقم.',
    'consecutive-punct': 'تجنّب وضع نقطتين أو شرطتين سفليتين متتاليتين أو الجمع بينهما.',
    reserved: 'اسم المستخدم محجوز. اختر اسمًا آخر.',
  },
  en: {
    displayName: 'Display name', username: 'Username', save: 'Save changes', saving: 'Saving…',
    saved: 'Profile saved.', failed: 'Could not save your profile. Try again.',
    taken: 'That username is taken. Choose another.', invalid: 'Check your display name and username.',
    'display-name-required': 'Enter a display name.', 'display-name-too-long': 'Use 60 characters or fewer for your display name.',
    'too-short': 'Use at least 3 characters for your username.', 'too-long': 'Use at most 20 characters for your username.',
    'invalid-chars': 'Use only English letters, numbers, dots, and underscores.',
    'edge-punct': 'Start and end your username with a letter or number.',
    'consecutive-punct': 'Avoid consecutive dots or underscores.',
    reserved: 'That username is reserved. Choose another.',
  },
};

function profileValues(profile) {
  return {
    displayName: typeof profile?.displayName === 'string' ? profile.displayName.trim() : '',
    username: typeof profile?.username === 'string' ? normalizeUsername(profile.username) : '',
  };
}

function profileField(name, label, value, { autocomplete, direction }) {
  const wrapper = document.createElement('label');
  wrapper.className = 'feature-field';
  const caption = document.createElement('span');
  caption.textContent = label;
  const input = document.createElement('input');
  input.className = 'feature-input';
  input.name = name;
  input.value = value;
  input.autocomplete = autocomplete;
  input.dir = direction;
  wrapper.append(caption, input);
  return { wrapper, input };
}

export function createProfileSettings({ locale, profile, save, isActive }) {
  const words = copy[locale] ?? copy.en;
  const saved = profileValues(profile);
  let busy = false;
  let feedback = '';
  const element = document.createElement('form');
  element.className = 'feature-form live-profile-form';
  const display = profileField('displayName', words.displayName, saved.displayName, { autocomplete: 'nickname', direction: 'auto' });
  const handle = profileField('username', words.username, saved.username, { autocomplete: 'username', direction: 'ltr' });
  handle.input.setAttribute('autocapitalize', 'none');
  handle.input.spellcheck = false;
  const inputs = { displayName: display.input, username: handle.input };
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'feature-button feature-primary';
  const status = document.createElement('p');
  status.className = 'dialog-note';
  status.setAttribute('role', 'status');
  element.append(display.wrapper, handle.wrapper, submit, status);

  function inputValues() {
    return profileValues({ displayName: inputs.displayName.value, username: inputs.username.value });
  }

  function validate() {
    const values = inputValues();
    const changes = {};
    if (values.displayName !== saved.displayName) changes.displayName = values.displayName;
    if (values.username !== saved.username) changes.username = values.username;
    const hasChanges = Object.keys(changes).length > 0;
    const displayError = !hasChanges ? '' : !values.displayName ? 'display-name-required'
      : values.displayName.length > 60 ? 'display-name-too-long' : '';
    const usernameCheck = changes.username === undefined ? 'ok' : validateUsername(values.username);
    const usernameError = usernameCheck === 'ok' ? '' : usernameCheck;
    return { changes, hasChanges, displayError, usernameError };
  }

  function render() {
    const { hasChanges, displayError, usernameError } = validate();
    submit.disabled = busy || !hasChanges || Boolean(displayError || usernameError);
    submit.textContent = words[busy ? 'saving' : 'save'];
    for (const input of Object.values(inputs)) input.readOnly = busy;
    element.setAttribute('aria-busy', String(busy));
    inputs.displayName.setAttribute('aria-invalid', String(Boolean(displayError)));
    inputs.username.setAttribute('aria-invalid', String(Boolean(usernameError) || feedback === 'taken'));
    const message = displayError || usernameError || feedback;
    status.hidden = !message;
    status.textContent = words[message] ?? '';
  }

  function update(profile) {
    const next = profileValues(profile);
    const draft = inputValues();
    for (const name of Object.keys(inputs)) {
      if (next[name] !== saved[name] && draft[name] === saved[name]) inputs[name].value = next[name];
      saved[name] = next[name];
    }
    render();
  }

  element.addEventListener('input', () => {
    feedback = '';
    render();
  });
  element.addEventListener('submit', async (event) => {
    event.preventDefault();
    const { changes, hasChanges, displayError, usernameError } = validate();
    if (!isActive() || busy || !hasChanges || displayError || usernameError) return;
    busy = true;
    feedback = '';
    render();
    try {
      const result = await save(changes);
      if (!isActive()) return;
      for (const name of Object.keys(changes)) {
        const value = result?.[name] ?? changes[name];
        inputs[name].value = saved[name] = value;
      }
      feedback = 'saved';
    } catch (error) {
      if (!isActive()) return;
      const code = error?.code?.replace?.(/^functions\//, '');
      feedback = code === 'already-exists' ? 'taken' : code === 'invalid-argument' ? 'invalid' : 'failed';
    } finally {
      busy = false;
      if (isActive()) render();
    }
  });
  render();
  return { element, update };
}
