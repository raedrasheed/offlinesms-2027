// Shared bootstrapping helpers for Firestore rules tests.
//
// Requires a running Firestore emulator:
//   firebase emulators:start --only firestore
//
// Each test file imports getTestEnv() once in beforeAll and tears it
// down in afterAll. Contexts are created per-test for authenticated /
// unauthenticated / admin assertions.

import {
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const PROJECT_ID = 'offlinesms-rules-test';

let envPromise: Promise<RulesTestEnvironment> | null = null;

export function getTestEnv(): Promise<RulesTestEnvironment> {
  if (envPromise) return envPromise;
  envPromise = initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
  return envPromise;
}

export async function clearAll() {
  const env = await getTestEnv();
  await env.clearFirestore();
}

export async function teardownEnv() {
  if (!envPromise) return;
  const env = await envPromise;
  await env.cleanup();
  envPromise = null;
}

/** Create an authenticated user context for the given uid. */
export async function asUser(uid: string, customClaims: Record<string, unknown> = {}) {
  const env = await getTestEnv();
  return env.authenticatedContext(uid, customClaims).firestore();
}

/** Create an admin context (has the `admin: true` custom claim). */
export async function asAdmin(uid = 'admin-1') {
  return asUser(uid, { admin: true });
}

/** Create an unauthenticated context. */
export async function asAnon() {
  const env = await getTestEnv();
  return env.unauthenticatedContext().firestore();
}

/**
 * Seed pre-existing docs that bypass rules. Use this for fixture data
 * (an existing user profile, an existing conversation) that the test
 * subject is operating against.
 */
export async function seed(
  fn: (db: import('firebase/firestore').Firestore) => Promise<void>,
) {
  const env = await getTestEnv();
  await env.withSecurityRulesDisabled(async ctx => {
    await fn(ctx.firestore() as unknown as import('firebase/firestore').Firestore);
  });
}
