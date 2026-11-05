#!/usr/bin/env node
// Read-only deployment check: no token or valid post payload is sent, so an
// older deployment cannot create or modify a post when this check is run.
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node scripts/release/check-posts-disabled.mjs --project <firebase-project-id>');
  process.exit(0);
}
const project = args[args.indexOf('--project') + 1];
if (!args.includes('--project') || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project ?? '')) {
  console.error('Provide --project with a valid Firebase project ID.'); process.exit(2);
}
const names = ['createPost', 'getPost', 'listPosts', 'deletePost', 'setPostLike', 'listPostComments', 'addPostComment', 'deletePostComment', 'reportPost'];
const results = await Promise.all(names.map(async name => {
  try {
    const response = await fetch(`https://us-central1-${project}.cloudfunctions.net/${name}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: {} }), signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json();
    const disabled = body?.error?.status === 'FAILED_PRECONDITION' && body?.error?.message === 'posts-disabled';
    console.log(`${disabled ? 'PASS' : 'FAIL'} ${name}: ${disabled ? 'posts-disabled' : `disabled response not confirmed (HTTP ${response.status})`}`);
    return disabled;
  } catch { console.log(`FAIL ${name}: request failed; deployment not verified`); return false; }
}));
console.log(`${results.filter(Boolean).length}/${names.length} Posts callables confirmed disabled in ${project}.`);
process.exitCode = results.every(Boolean) ? 0 : 1;
