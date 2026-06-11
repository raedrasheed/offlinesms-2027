// AnimatedEmoji3D — renders one of the bundled Microsoft Fluent 3D emoji
// PNGs (assets/emoji3d, MIT) inside a looping mood-specific animation:
//   bounce → happy/laugh/party/thumbs-up   (springy hop + squash)
//   pulse  → love/heart/fire/wow           (heartbeat scale)
//   shake  → angry/clap                    (fast side-to-side judder)
//   droop  → sad/cry/sleep                 (slow sway, sinking)
//   wiggle → cool/wink/think               (gentle tilt left/right)
// Transform-only animations, so everything runs on the native driver.

import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import type { Emoji3D, EmojiMood } from '../../lib/emoji3d';

const ASSETS: Record<string, ReturnType<typeof require>> = {
  happy:    require('../../../assets/emoji3d/happy.png'),
  laugh:    require('../../../assets/emoji3d/laugh.png'),
  love:     require('../../../assets/emoji3d/love.png'),
  cool:     require('../../../assets/emoji3d/cool.png'),
  wink:     require('../../../assets/emoji3d/wink.png'),
  sad:      require('../../../assets/emoji3d/sad.png'),
  cry:      require('../../../assets/emoji3d/cry.png'),
  angry:    require('../../../assets/emoji3d/angry.png'),
  wow:      require('../../../assets/emoji3d/wow.png'),
  think:    require('../../../assets/emoji3d/think.png'),
  sleep:    require('../../../assets/emoji3d/sleep.png'),
  party:    require('../../../assets/emoji3d/party.png'),
  thumbsup: require('../../../assets/emoji3d/thumbsup.png'),
  heart:    require('../../../assets/emoji3d/heart.png'),
  fire:     require('../../../assets/emoji3d/fire.png'),
  clap:     require('../../../assets/emoji3d/clap.png'),
  lovehearts:  require('../../../assets/emoji3d/lovehearts.png'),
  kiss:        require('../../../assets/emoji3d/kiss.png'),
  rofl:        require('../../../assets/emoji3d/rofl.png'),
  sweat:       require('../../../assets/emoji3d/sweat.png'),
  halo:        require('../../../assets/emoji3d/halo.png'),
  hug:         require('../../../assets/emoji3d/hug.png'),
  plead:       require('../../../assets/emoji3d/plead.png'),
  scream:      require('../../../assets/emoji3d/scream.png'),
  mindblown:   require('../../../assets/emoji3d/mindblown.png'),
  eyeroll:     require('../../../assets/emoji3d/eyeroll.png'),
  yummy:       require('../../../assets/emoji3d/yummy.png'),
  starstruck:  require('../../../assets/emoji3d/starstruck.png'),
  wave:        require('../../../assets/emoji3d/wave.png'),
  pray:        require('../../../assets/emoji3d/pray.png'),
  muscle:      require('../../../assets/emoji3d/muscle.png'),
  okhand:      require('../../../assets/emoji3d/okhand.png'),
  victory:     require('../../../assets/emoji3d/victory.png'),
  partypopper: require('../../../assets/emoji3d/partypopper.png'),
  brokenheart: require('../../../assets/emoji3d/brokenheart.png'),
  hundred:     require('../../../assets/emoji3d/hundred.png'),
};

function buildLoop(mood: EmojiMood, v: Animated.Value): Animated.CompositeAnimation {
  switch (mood) {
    case 'bounce':
      return Animated.loop(Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 420, easing: Easing.bounce, useNativeDriver: true }),
        Animated.delay(700),
      ]));
    case 'pulse':
      return Animated.loop(Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 260, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 1, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 260, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.delay(900),
      ]));
    case 'shake':
      return Animated.loop(Animated.sequence([
        ...Array.from({ length: 4 }, () => [
          Animated.timing(v, { toValue: 1, duration: 70, easing: Easing.linear, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: 70, easing: Easing.linear, useNativeDriver: true }),
        ]).flat(),
        Animated.delay(900),
      ]));
    case 'droop':
      return Animated.loop(Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 1100, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]));
    case 'wiggle':
    default:
      return Animated.loop(Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 500, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.delay(500),
      ]));
  }
}

function moodTransforms(mood: EmojiMood, v: Animated.Value) {
  switch (mood) {
    case 'bounce':
      return [
        { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }) },
        { scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) },
      ];
    case 'pulse':
      return [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.16] }) }];
    case 'shake':
      return [
        { translateX: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [-3, 0, 3] }) },
        { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['-6deg', '6deg'] }) },
      ];
    case 'droop':
      return [
        { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['-7deg', '7deg'] }) },
        { translateY: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 3, 0] }) },
      ];
    case 'wiggle':
    default:
      return [{ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['-10deg', '10deg'] }) }];
  }
}

export function AnimatedEmoji3D({
  emoji, size, replayTrigger,
}: {
  emoji: Emoji3D;
  size: number;
  /** Bump this number to replay a one-shot "pop" (scale-up flourish) on top
   *  of the mood loop — used by tap-to-replay on emoji messages. */
  replayTrigger?: number;
}) {
  const v = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;
  const popArmed = useRef(false); // skip the initial mount value

  useEffect(() => {
    v.setValue(0);
    const loop = buildLoop(emoji.mood, v);
    loop.start();
    return () => loop.stop();
  }, [emoji.key, emoji.mood, v]);

  useEffect(() => {
    if (replayTrigger === undefined) return;
    if (!popArmed.current) { popArmed.current = true; return; }
    pop.setValue(0);
    Animated.sequence([
      Animated.spring(pop, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }),
      Animated.timing(pop, { toValue: 0, duration: 280, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]).start();
  }, [replayTrigger, pop]);

  return (
    <Animated.Image
      source={ASSETS[emoji.key]}
      style={{
        width: size, height: size,
        transform: [
          ...moodTransforms(emoji.mood, v),
          { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [1, 1.65] }) },
        ],
      }}
      accessibilityLabel={emoji.char}
    />
  );
}
