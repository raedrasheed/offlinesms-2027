// Retired product feature. Keep the server-action guard as well as hiding its
// navigation: an old browser tab must not publish or lease post images.
export function assertPostsEnabled(): void {
  throw new Error('Posts are disabled.');
}
