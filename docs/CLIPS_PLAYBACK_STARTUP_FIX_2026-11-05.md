# Clips playback startup

The group viewer and the Clips feed share `ClipPlayer`. Previously, touching the
poster while a video was still loading changed the desired state to paused. The
player could then finish loading without moving. Native callbacks from an old
player could also affect a new playback attempt, and startup had no deadline.

The fix makes a tap request playback unless the current video is already playing.
It synchronizes the requested play/pause state with the native player after load,
rejects callbacks from obsolete attempts, and provides a bounded startup failure
with an explicit retry. Retry obtains a fresh authorized playback URL.

This is a mobile JavaScript change. Build and install a new mobile binary to test
it; no Firebase function, rule, IAM, dependency, or app-version change is required
by this patch. Store submission still follows the normal version/build-number
process when the release is ready.

## Validation

The regression for touching the loading poster fails against the original player.
Lifecycle tests cover the corrected controls, startup failure, manual retry,
stale callbacks, account changes, backgrounding, and authorization renewal.

Production diagnostics supplied by the developer returned successful callable
responses and successful bounded range reads for three clips under the local
admin credential. The MP4 prefixes contained video sample tables. This does not
test the native decoder or independently verify the deployed signer's object
read permission. A physical-device check is still needed before claiming the
reported symptom is fully resolved.

## Device check

1. On Android and iOS, open an existing clip from the Clips tab and a group share.
   Verify that the picture starts moving and sound can be enabled.
2. Tap the poster during loading. It should continue trying to play. Once the
   video is moving, pause and resume it explicitly.
3. Switch clips, tabs and foreground/background state. Only the visible focused
   clip may play. On a stalled connection, verify that startup ends in a retry
   state and that retry works when the connection is restored.

Source: [Expo AV SDK 53 video lifecycle](https://github.com/expo/expo/blob/sdk-53/packages/expo-av/src/Video.tsx).
