import { useState } from 'react';
import { Image, useWindowDimensions } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { fitMediaDimensions, validMediaDimensions, videoDisplayDimensions, type MediaDimensions } from '../../media/mediaDimensions';
import { mediaFrameStyles } from './MediaMessageFrame';

/** The send preview uses the same ratio as the eventual message card. */
export function AttachmentMediaPreview({ uri, type, width, height, onDimensions }: {
  uri: string; type: 'image' | 'video'; width?: number; height?: number;
  onDimensions: (size: MediaDimensions) => void;
}) {
  const window = useWindowDimensions();
  const [natural, setNatural] = useState<MediaDimensions | null>(null);
  const size = fitMediaDimensions(natural || validMediaDimensions(width, height), window.width - 44, window.height * 0.6);
  function update(dimensions: MediaDimensions | null) {
    if (!dimensions) return;
    setNatural(previous => previous?.width === dimensions.width && previous.height === dimensions.height ? previous : dimensions);
    onDimensions(dimensions);
  }
  const style = [mediaFrameStyles.frame, size, { alignSelf: 'center' as const }];
  return type === 'video'
    ? <Video source={{ uri }} style={style} useNativeControls resizeMode={ResizeMode.CONTAIN} shouldPlay={false}
      onReadyForDisplay={event => update(videoDisplayDimensions(event.naturalSize))}/>
    : <Image source={{ uri }} style={style} resizeMode="contain"
      onLoad={event => update(validMediaDimensions(event.nativeEvent.source.width, event.nativeEvent.source.height))}/>;
}
