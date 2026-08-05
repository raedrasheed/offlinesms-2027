// Curated, dependency-free emoji catalogue for the full reaction picker.
//
// Grouped into a handful of categories with a representative (not exhaustive)
// set per category — enough to feel like a "full" picker without bundling a
// multi-thousand-entry data file or a native module. Plain unicode strings, so
// the same value flows straight through the existing reaction pipeline
// (toggleReaction → queueReactMessage → reactToMessage).

export type EmojiCategory = {
  key: string;
  label: string;
  icon: string;       // a representative emoji used as the tab glyph
  emojis: string[];
};

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    key: 'smileys', label: 'Smileys', icon: '😀',
    emojis: [
      '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩',
      '😘','😗','😚','😙','😋','😛','😜','🤪','😝','🤗','🤭','🤫','🤔','🤐','😐','😑',
      '😶','😏','😒','🙄','😬','😮‍💨','😌','😔','😪','😴','😷','🤒','🤕','🤧','🥵','🥶',
      '🥴','😵','🤯','🤠','🥳','😎','🤓','🧐','😕','😟','🙁','😮','😯','😲','😳','🥺',
      '😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤',
      '😡','😠','🤬','😈','👿','💀','💩','🤡','👻','👽','🤖',
    ],
  },
  {
    key: 'gestures', label: 'Gestures', icon: '👍',
    emojis: [
      '👍','👎','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','✋',
      '🤚','🖐️','🖖','👋','🤝','👏','🙌','👐','🤲','🙏','✍️','💪','🦾','👊','✊','🤛','🤜',
    ],
  },
  {
    key: 'hearts', label: 'Hearts', icon: '❤️',
    emojis: [
      '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖',
      '💘','💝','💟','♥️','💯','🔥','✨','⭐','🌟','💫','💥','🎉','🎊','🥂','🎁',
    ],
  },
  {
    key: 'animals', label: 'Animals', icon: '🐶',
    emojis: [
      '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🐔',
      '🐧','🐦','🐤','🦆','🦅','🦉','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐢',
      '🐍','🐙','🦑','🦀','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🐘',
    ],
  },
  {
    key: 'food', label: 'Food', icon: '🍕',
    emojis: [
      '🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍒','🍑','🥭','🍍','🥥','🥝',
      '🍅','🥑','🍆','🥕','🌽','🌶️','🥦','🧄','🧅','🍞','🧀','🥐','🥖','🥨','🥞','🧇',
      '🍔','🍟','🍕','🌭','🥪','🌮','🌯','🥗','🍿','🍩','🍪','🎂','🍰','🧁','🍫','🍬',
      '🍭','🍮','🍯','☕','🍵','🧃','🥤','🍺','🍻','🥂','🍷','🥃',
    ],
  },
  {
    key: 'activity', label: 'Activity', icon: '⚽',
    emojis: [
      '⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🥅','🏒','🏑',
      '🏏','⛳','🎣','🥊','🥋','🎽','🛹','🛷','⛸️','🥌','🎿','⛷️','🏂','🏋️','🤸','🤼',
      '🤾','🏌️','🏇','🧘','🏄','🏊','🚴','🚵','🎯','🎮','🎲','🎸','🎺','🎷','🥁','🎤',
    ],
  },
  {
    key: 'travel', label: 'Travel', icon: '✈️',
    emojis: [
      '🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🚚','🚛','🚜','🏍️','🛵','🚲',
      '✈️','🚀','🛸','🚁','⛵','🚤','🛳️','⚓','🏔️','🌋','🗻','🏕️','🏖️','🏝️','🌅','🌄',
      '🌃','🌆','🌇','🌉','🗼','🗽','🎡','🎢','🎠','🏰','⛩️','🕌','⛪','🏟️',
    ],
  },
  {
    key: 'symbols', label: 'Symbols', icon: '✅',
    emojis: [
      '✅','❌','⛔','🚫','❓','❗','‼️','⁉️','💬','💭','🗯️','♻️','✔️','☑️','🔆','⚠️',
      '🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤','🔺','🔻','🔔','🔕','🎵','🎶','💲',
      '💱','™️','©️','®️','〽️','🔱','⚜️','🏁','🚩','🏳️','🏴','🏳️‍🌈',
    ],
  },
];

/** Flat de-duplicated list of every emoji the picker can produce. */
export const ALL_PICKER_EMOJIS: string[] = Array.from(
  new Set(EMOJI_CATEGORIES.flatMap(c => c.emojis)),
);
