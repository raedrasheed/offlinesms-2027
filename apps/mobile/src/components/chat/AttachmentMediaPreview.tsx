import { useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
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
  const [imageNatural, setImageNatural] = useState<{ uri: string; size: MediaDimensions } | null>(null);
  const learned = type === 'image' ? (imageNatural?.uri === uri ? imageNatural.size : null) : natural;
  const size = fitMediaDimensions(learned || validMediaDimensions(width, height), window.width - 44, window.height * 0.6);
  function update(dimensions: MediaDimensions | null) {
    if (!dimensions) return;
    setNatural(previous => previous?.width === dimensions.width && previous.height === dimensions.height ? previous : dimensions);
    onDimensions(dimensions);
  }
  const style = [mediaFrameStyles.frame, size, { alignSelf: 'center' as const }];
  return type === 'video'
    ? <Video source={{ uri }} style={style} useNativeControls resizeMode={ResizeMode.CONTAIN} shouldPlay={false}
      onReadyForDisplay={event => update(videoDisplayDimensions(event.naturalSize))}/>
    : <Image source={{ uri }} style={style} contentFit="contain" useAppleWebpCodec={false} recyclingKey={uri}
      onLoad={event => {
        const dimensions = validMediaDimensions(event.source.width, event.source.height);
        if (!dimensions) return;
        setImageNatural({ uri, size: dimensions });
        onDimensions(dimensions);
      }}/>;
}
