# No forced profile setup; stickers float on the wallpaper

## Startup

Mandatory profile onboarding is removed, rather than delayed. The profile completion screen, its navigator and the completion gate hook are deleted. Once Firebase restores an authenticated account, the app opens its root navigator immediately. Profile loading, missing documents, an incomplete marker or a preference read error cannot open a setup form or block push registration, invite/clip link replay or sharing. Signed-out users still see the sign-in flow.

Profile editing remains available voluntarily in Settings. A small account-bound theme hook reads only the optional preferredTheme; it cannot choose the session navigator. Backend account, membership and username authorization checks are unchanged. No completion flags are forged or written as a shortcut.

## Sticker presentation

Bundled and custom stickers use a transparent surface with no border, background or elevation, including queued and failed states. Sender names, receipts, time, replies and long-press actions remain available. Pending-to-delivered transitions now retain a consistent React hook order; deleted pending stickers do not render their old content.

Custom stickers use the original/cached PNG instead of a potentially opaque image thumbnail. Cache state is bound to the media source, preventing a recycled cell from briefly showing the preceding image. No image bytes are flattened or converted to JPEG by this display change.

Older servers may omit media.presentation. Display compatibility requires the exact sticker export filename or stored Sticker/Photo-export label plus bounded 512×512 PNG metadata and no ordinary caption. PNG format or square dimensions alone are not treated as a sticker. Remote image filenames now survive serialization into SQLite. A history read can repair missing filename/presentation metadata only for the same original and cannot roll back edits, replace known metadata or resurrect deleted content. Original photos retain their normal media cards. Images without any sticker intent marker remain ordinary photos.

## Validation and device check

- Tests mount the real App with native/transport mocks: authenticated startup before profile data, incomplete/missing/complete profile snapshots, preference errors, account switching, sign-in and optional theme isolation. No ProfileCompletion route is registered.
- Rendering tests cover original PNG stickers, legacy exports, ordinary image cards, sender/time, pending transitions and deletion. URI tests reject opaque thumbnails for stickers and stale cached cell images.
- SQLite tests cover serialization, history metadata repair, source isolation, deletion and preservation of newer metadata.

Install the updated APK over OfflineSMS Test and open that application. Verify repeated cold starts and offline restarts never show profile setup. In a group, verify a newly sent custom sticker and a compatible older sticker float directly on the wallpaper; an ordinary photo should keep its card. Physical device behavior remains to be verified separately from automated tests.

This is a mobile-only change and requires a new app build, not an additional Firebase deployment. The preceding Posts shutdown still requires its previously documented server/dashboard deployments. This branch retains the Posts, video and external SMS contact fixes from PRs #66/#65/#64/#63.
