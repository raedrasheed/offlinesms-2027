// A request-size bound, not a limit on the group's membership.
export const GROUP_INVITATION_BATCH_SIZE = 240;

export async function inviteInBatches(
  memberUids: readonly string[],
  send: (uids: string[]) => Promise<number>,
): Promise<number> {
  const unique = [...new Set(memberUids)];
  let invited = 0;
  for (let offset = 0; offset < unique.length; offset += GROUP_INVITATION_BATCH_SIZE) {
    // Sequential calls bound server work. If one fails, leave the selection in
    // the UI for retry; the server skips existing/declined invitations safely.
    invited += await send(unique.slice(offset, offset + GROUP_INVITATION_BATCH_SIZE));
  }
  return invited;
}
