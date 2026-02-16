export function escapeHtml(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escapeMarkdown(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(/([*_`\[])/g, '\\$1');
}
