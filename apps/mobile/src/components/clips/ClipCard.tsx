import { auth } from '../../lib/firebase';
import ClipCardFrame, { type ClipCardFrameProps } from './ClipCardFrame';
import ClipPlayer from './ClipPlayer';
type Props = Omit<ClipCardFrameProps, 'media' | 'own'> & { active: boolean; muted: boolean; quality: 'standard' | 'dataSaver'; onMute: () => void };
export default function ClipCard(p: Props) {
  return <ClipCardFrame {...p} own={p.clip.ownerUid === auth.currentUser?.uid}
    media={<ClipPlayer clip={p.clip} active={p.active} muted={p.muted} quality={p.quality} onMute={p.onMute} bottomInset={p.bottomInset} />} />;
}
