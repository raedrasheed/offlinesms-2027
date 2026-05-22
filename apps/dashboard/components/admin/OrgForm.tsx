'use client';
import { useFormStatus, useFormState } from 'react-dom';
import type { OrgActionState } from '@/lib/orgActions';

type InitialValues = {
  name?: string; slug?: string; status?: string; ownerUid?: string;
  smsEnabled?: boolean; pointsEnabled?: boolean;
  defaultLanguage?: string; timezone?: string;
};

type Props = {
  action: (prev: OrgActionState, data: FormData) => Promise<OrgActionState>;
  initial?: InitialValues;
  submitLabel?: string;
};

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-5 py-2.5 bg-primary text-white font-bold text-sm rounded-xl hover:bg-primary-dark transition disabled:opacity-50"
    >
      {pending ? 'Saving…' : label}
    </button>
  );
}

export default function OrgForm({ action, initial = {}, submitLabel = 'Save' }: Props) {
  const [state, formAction] = useFormState(action, null);

  return (
    <form action={formAction} className="space-y-5 max-w-lg">
      {state?.error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">
          {state.error}
        </div>
      )}

      <Field label="Organization name" name="name" required defaultValue={initial.name} />
      <Field
        label="Slug"
        name="slug"
        required
        defaultValue={initial.slug}
        hint="Lowercase letters, numbers, hyphens. 2–40 chars."
      />

      <div>
        <label className="block text-xs font-semibold text-ink-700 mb-1">Status</label>
        <select name="status" defaultValue={initial.status ?? 'active'}
          className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none bg-white">
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="disabled">Disabled</option>
        </select>
      </div>

      <Field label="Owner UID (optional)" name="ownerUid" defaultValue={initial.ownerUid}
        hint="Firebase Auth UID of the organization owner." />

      <fieldset className="border border-ink-100 rounded-xl p-4 space-y-3">
        <legend className="text-xs font-bold text-ink-500 px-1">Settings</legend>
        <Toggle name="smsEnabled" label="SMS escalation enabled" defaultChecked={initial.smsEnabled} />
        <Toggle name="pointsEnabled" label="Points enabled" defaultChecked={initial.pointsEnabled} />

        <div>
          <label className="block text-xs font-semibold text-ink-700 mb-1">Default language</label>
          <select name="defaultLanguage" defaultValue={initial.defaultLanguage ?? 'en'}
            className="border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none bg-white">
            <option value="en">English</option>
            <option value="ar">Arabic</option>
            <option value="fr">French</option>
            <option value="es">Spanish</option>
            <option value="de">German</option>
            <option value="pt">Portuguese</option>
          </select>
        </div>

        <Field label="Timezone (IANA)" name="timezone" defaultValue={initial.timezone ?? 'UTC'}
          hint="e.g. Europe/London, America/New_York, Asia/Riyadh" />
      </fieldset>

      <div className="flex gap-3">
        <SubmitButton label={submitLabel} />
      </div>
    </form>
  );
}

function Field({
  label, name, required, defaultValue, hint,
}: {
  label: string; name: string; required?: boolean;
  defaultValue?: string; hint?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-ink-700 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        name={name}
        required={required}
        defaultValue={defaultValue}
        className="w-full border border-ink-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary bg-white"
      />
      {hint && <p className="text-[10px] text-ink-400 mt-1">{hint}</p>}
    </div>
  );
}

function Toggle({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer">
      <input type="hidden" name={name} value="false" />
      <input type="checkbox" name={name} value="true" defaultChecked={defaultChecked}
        className="w-4 h-4 accent-primary" />
      <span className="text-sm text-ink-700">{label}</span>
    </label>
  );
}
