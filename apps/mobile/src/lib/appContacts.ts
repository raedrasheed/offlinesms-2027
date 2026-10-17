import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from './firebase';
import { parseContact, type ContactAttachment } from '../media/attachmentModel';

export type AppContact = ContactAttachment & { uid: string };
export type ContactPage = { cursor: Array<{done:boolean;afterUid?:string;query?:string}>; hasMore:boolean };

/** The callable returns public fields only, including for legacy profiles. */
export async function loadAppContacts(term: string, page?: ContactPage): Promise<{ contacts: AppContact[]; page: ContactPage }> {
  const result = await httpsCallable<
    {search:string;cursor?:ContactPage['cursor']},
    {schemaVersion:number;contacts:unknown[];page:ContactPage}
  >(getFunctions(app),'listAppContacts')({search:term.trim().slice(0,80),...(page ? {cursor:page.cursor} : {})});
  if (result.data.schemaVersion !== 2) throw Object.assign(new Error('contact-service-unavailable'),{code:'functions/failed-precondition'});
  const contacts = result.data.contacts.map(parseContact).filter((contact): contact is AppContact => !!contact?.uid);
  return {contacts,page:result.data.page};
}

export function contactSearchErrorKey(error: unknown): string {
  const code=(error as {code?:string})?.code ?? '';
  return /not-found|failed-precondition|unimplemented/.test(code) ? 'attachments.contactServiceUnavailable' : 'attachments.contactSearchError';
}

export function mergeAppContacts(current: AppContact[], incoming: AppContact[]): AppContact[] {
  const unique = new Map(current.map(contact => [contact.uid, contact]));
  incoming.forEach(contact => unique.set(contact.uid, contact));
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, ['ar', 'en'], { sensitivity: 'base' }) || a.uid.localeCompare(b.uid));
}
