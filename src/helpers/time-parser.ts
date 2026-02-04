export function parseTimeToMinutes(input: string): number | null {
  if (!input || typeof input !== 'string') return null;

  const normalized = input
    .toLowerCase()
    .trim()
    .replace(/,/g, '.')
    .replace(/\s+/g, ' ');

  const combinedMatch = normalized.match(
    /(\d+(?:\.\d+)?)\s*(?:ч|час|часа|часов|h|hour|hours)\s*(\d+(?:\.\d+)?)\s*(?:м|мин|минут|минуты|m|min|minutes)?/,
  );
  if (combinedMatch) {
    const hours = parseFloat(combinedMatch[1]);
    const minutes = parseFloat(combinedMatch[2]);
    if (!isNaN(hours) && !isNaN(minutes)) {
      return Math.round(hours * 60 + minutes);
    }
  }

  const daysMatch = normalized.match(
    /^(\d+(?:\.\d+)?)\s*(?:д|день|дня|дней|day|days)$/,
  );
  if (daysMatch) {
    const days = parseFloat(daysMatch[1]);
    if (!isNaN(days) && days > 0) {
      return Math.round(days * 24 * 60);
    }
  }

  const hoursMatch = normalized.match(
    /^(\d+(?:\.\d+)?)\s*(?:ч|час|часа|часов|h|hour|hours)$/,
  );
  if (hoursMatch) {
    const hours = parseFloat(hoursMatch[1]);
    if (!isNaN(hours) && hours > 0) {
      return Math.round(hours * 60);
    }
  }

  const minutesMatch = normalized.match(
    /^(\d+(?:\.\d+)?)\s*(?:м|мин|минут|минуты|минута|m|min|minute|minutes)?$/,
  );
  if (minutesMatch) {
    const minutes = parseFloat(minutesMatch[1]);
    if (!isNaN(minutes) && minutes > 0) {
      return Math.round(minutes);
    }
  }

  return null;
}

/**
 * Форматирует количество минут в читаемую строку
 */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} мин`;
  }

  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  const mins = minutes % 60;

  const parts: string[] = [];

  if (days > 0) {
    const dayWord = days === 1 ? 'день' : days < 5 ? 'дня' : 'дней';
    parts.push(`${days} ${dayWord}`);
  }

  if (hours > 0) {
    const hourWord = hours === 1 ? 'час' : hours < 5 ? 'часа' : 'часов';
    parts.push(`${hours} ${hourWord}`);
  }

  if (mins > 0 || parts.length === 0) {
    parts.push(`${mins} мин`);
  }

  return parts.join(' ');
}
