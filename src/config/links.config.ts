export const APP_LINKS = {
  webapp: 'https://t.me/ysturasp_bot/ysturasp_webapp',
  channel: 'https://t.me/ysturasp',
};

export function getFooterLinks(
  parseMode: 'Markdown' | 'HTML' = 'Markdown',
): string {
  return parseMode === 'HTML'
    ? `\n<a href="${APP_LINKS.webapp}">app ysturasp</a>\n` +
        `<a href="${APP_LINKS.channel}">тгк ysturasp</a>`
    : `\n[app ysturasp](${APP_LINKS.webapp})\n` +
        `[тгк ysturasp](${APP_LINKS.channel})`;
}
