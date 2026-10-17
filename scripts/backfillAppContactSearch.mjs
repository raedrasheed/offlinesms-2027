#!/usr/bin/env node
// Build Functions first. Explicit project; dry-run unless --write is supplied.
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {initializeApp}=require('firebase-admin/app');
const {getFirestore,FieldPath,FieldValue}=require('firebase-admin/firestore');
const {refreshAppContactSearch}=require('../functions/lib/contacts/syncAppContactSearch.js');
const {CONTACT_SEARCH_VERSION}=require('../functions/lib/contacts/contactSearch.js');
const args=process.argv.slice(2);
const project=args[args.indexOf('--project')+1];
if (!args.includes('--project') || !project || project.startsWith('--')) throw new Error('Use --project <project-id> [--write]');
const write=args.includes('--write');
initializeApp({projectId:project});
const db=getFirestore();
let after,total=0;
console.log(`${write?'WRITE':'DRY RUN'} public contact search index in ${project}`);
try {
  while (true) {
    let query=db.collection('users').orderBy(FieldPath.documentId()).select().limit(200);
    if (after) query=query.startAfter(after);
    const rows=await query.get();
    if (write) for (let i=0;i<rows.size;i+=10) {
      await Promise.all(rows.docs.slice(i,i+10).map(row=>refreshAppContactSearch(row.id,db)));
    }
    total+=rows.size;
    console.log(`Processed ${total} accounts`);
    if (rows.size<200) break;
    after=rows.docs[rows.size-1].id;
  }
  if (write) await db.doc('appContactSearchMeta/state').set({version:CONTACT_SEARCH_VERSION,ready:true,completedAt:FieldValue.serverTimestamp()});
  console.log(write?'Contact search is ready.':'No data changed. Add --write to build the index.');
} catch (error) {
  console.error('Contact search indexing failed:',error?.message ?? error);
  process.exitCode=1;
} finally { await db.terminate(); }
