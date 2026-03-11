export const TelegramCustomEmojis = {
  format: {
    download: {
      id: '5433811242135331842',
      char: '⬇️',
    },
    processing: {
      id: '5202200238730780195',
      char: '⚙️',
    },
    done: {
      id: '5222148368955877900',
      char: '✅',
    },
  },
} as const;

export type TelegramCustomEmojiCategory = keyof typeof TelegramCustomEmojis;

export type TelegramCustomEmojiKey<
  C extends TelegramCustomEmojiCategory = TelegramCustomEmojiCategory,
> = keyof (typeof TelegramCustomEmojis)[C];
