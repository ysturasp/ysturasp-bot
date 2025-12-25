import { Markup } from 'telegraf';

export function getMainKeyboard() {
  return Markup.keyboard([
    ['📅 Сегодня', '📅 Завтра'],
    ['📅 Неделя', '⚙️ Настройки'],
  ]).resize();
}
