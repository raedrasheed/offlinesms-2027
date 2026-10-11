// Which Firebase project does an API key belong to? Auth and other Firebase
// requests go wherever the key belongs, whatever a config file's project id
// says, so build checks ask Identity Toolkit: GET /v1/projects?key=… returns
// the key's project and its authorized domains (public endpoint, no
// credentials). Used by check-backend-config.mjs and relay-test-backend.mjs.
//
// Returns { ok: true, projectId, authorizedDomains } or { ok: false, reason }.
// Never prints the key.
export async function apiKeyProject(key) {
  let r;
  try {
    r = await fetch(`https://identitytoolkit.googleapis.com/v1/projects?key=${encodeURIComponent(key)}`);
  } catch (e) {
    return { ok: false, reason: `could not reach Identity Toolkit to check the key (${e.message})` };
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    return { ok: false, reason: `Identity Toolkit refused the key (${body?.error?.message ?? `HTTP ${r.status}`}); its project cannot be verified` };
  }
  return { ok: true, projectId: String(body.projectId ?? ''), authorizedDomains: body.authorizedDomains ?? [] };
}

/** Identity Toolkit reports the project id or, for some keys, the project number. */
export const keyBelongsTo = (res, projectId, projectNumber) =>
  res.ok && (res.projectId === projectId || res.projectId === projectNumber);

/** The project number inside a Firebase app id ("1:<number>:android:<hex>"). */
export const appIdNumber = id => /^1:(\d+):(web|android|ios):[0-9a-f]+$/i.exec(id ?? '')?.[1] ?? null;
