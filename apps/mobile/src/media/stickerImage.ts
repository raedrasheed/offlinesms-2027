import * as ImagePicker from 'expo-image-picker';
import * as FS from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { StickerEdits } from '../lib/stickerEditorModel';

export interface StickerSource { uri: string; width: number; height: number }
export async function pickStickerImage(): Promise<StickerSource | null> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 1, exif: false });
  const asset = !result.canceled && result.assets[0];
  if (!asset) return null;
  const info = await FS.getInfoAsync(asset.uri);
  if (!info.exists || info.isDirectory || info.size <= 0 || info.size > 30 * 1024 * 1024
    || ![asset.width, asset.height].every(n => Number.isFinite(n) && n > 0) || asset.width * asset.height > 40_000_000) throw Error('sticker-image-too-large');
  const context = ImageManipulator.manipulate(asset.uri);
  // Decode/normalize EXIF orientation once. PNG retains transparent imports.
  if (Math.max(asset.width, asset.height) > 1024) context.resize(asset.width >= asset.height ? { width: 1024 } : { height: 1024 });
  let image;
  try { image = await context.renderAsync(); return await image.saveAsync({ format: SaveFormat.PNG }); }
  finally { image?.release(); context.release(); }
}
export async function orientStickerImage(source: StickerSource, edits: StickerEdits): Promise<StickerSource> {
  if (!edits.rotation && !edits.flipX && !edits.flipY) return source;
  const context = ImageManipulator.manipulate(source.uri);
  if (edits.rotation) context.rotate(edits.rotation);
  if (edits.flipX) context.flip('horizontal');
  if (edits.flipY) context.flip('vertical');
  let image;
  try { image = await context.renderAsync(); return await image.saveAsync({ format: SaveFormat.PNG }); }
  finally { image?.release(); context.release(); }
}
export const removeStickerTemp = (uri: string) => FS.deleteAsync(uri, { idempotent: true }).catch(() => {});
