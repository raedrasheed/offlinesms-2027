import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

export type PostImageDraft = { uri: string; base64: string };
export const removePostImage = (uri: string) => FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
export async function pickPostImage(): Promise<PostImageDraft | null> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: false, quality: 1, exif: false });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0], info = await FileSystem.getInfoAsync(asset.uri);
  if (!info.exists || info.isDirectory || info.size <= 0 || info.size > 30 * 1024 * 1024
    || ![asset.width, asset.height].every(n => Number.isFinite(n) && n > 0) || asset.width * asset.height > 40_000_000) throw Error('post-image-too-large');
  const context = ImageManipulator.manipulate(asset.uri);
  if (Math.max(asset.width, asset.height) > 1440) context.resize(asset.width >= asset.height ? { width: 1440 } : { height: 1440 });
  let image;
  try {
    image = await context.renderAsync();
    // Re-encoding normalizes orientation, removes metadata and bounds upload size.
    for (const compress of [.8, .55, .35]) {
      const output = await image.saveAsync({ format: SaveFormat.JPEG, compress, base64: true });
      if (output.base64 && output.base64.length <= 4 * 1024 * 1024) return { uri: output.uri, base64: output.base64 };
      await removePostImage(output.uri);
    }
    throw Error('post-image-too-large');
  } finally { image?.release(); context.release(); }
}
