export const RUSSIAN_DAYS_MAP: Record<string, number> = {
  понедельник: 1,
  пн: 1,
  вторник: 2,
  вт: 2,
  среда: 3,
  ср: 3,
  четверг: 4,
  чт: 4,
  пятница: 5,
  пт: 5,
  суббота: 6,
  сб: 6,
  воскресенье: 0,
  вс: 0,
};

function stripSchedulePrefix(input: string): string {
  return input
    .toLowerCase()
    .replace(
      /^(?:расписание|распис|раписание|расписаие|распесание|рапсписание|рачписание|рачсписание|расрисание|покажи|дай|посмотреть|показать|глянуть)\s+(?:на\s+)?(?:следующую\s+)?(?:эту\s+)?/iu,
      '',
    )
    .trim();
}

export function parseRussianDayOfWeek(input: string): number | null {
  const normalized = stripSchedulePrefix(input);
  return RUSSIAN_DAYS_MAP[normalized] ?? null;
}

export function getOffsetForDayOfWeek(dayOfWeek: number): number {
  const now = new Date();
  const moscowNow = new Date(
    now.toLocaleString('en-US', { timeZone: 'Europe/Moscow' }),
  );
  const currentDay = moscowNow.getDay();

  let offset = dayOfWeek - currentDay;
  if (offset < 0) {
    offset += 7;
  }
  return offset;
}

export const RUSSIAN_MONTHS_MAP: Record<string, number> = {
  январь: 0,
  января: 0,
  янв: 0,
  февраль: 1,
  февраля: 1,
  фев: 1,
  март: 2,
  марта: 2,
  мар: 2,
  апрель: 3,
  апреля: 3,
  апр: 3,
  май: 4,
  мая: 4,
  июнь: 5,
  июня: 5,
  июн: 5,
  июль: 6,
  июля: 6,
  июл: 6,
  август: 7,
  августа: 7,
  авг: 7,
  сентябрь: 8,
  сентября: 8,
  сен: 8,
  октябрь: 9,
  октября: 9,
  окт: 9,
  ноябрь: 10,
  ноября: 10,
  ноя: 10,
  декабрь: 11,
  декабря: 11,
  дек: 11,
};

export function parseRussianDate(input: string): Date | null {
  const normalized = stripSchedulePrefix(input);

  if (normalized === 'сегодня') return new Date();
  if (normalized === 'завтра') {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  }
  if (normalized === 'вчера') {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d;
  }

  const dateMatch = normalized.match(
    /^(\d{1,2})[./\s](\d{1,2})(?:[./\s](\d{2,4}))?$/,
  );
  if (dateMatch) {
    const day = parseInt(dateMatch[1], 10);
    const month = parseInt(dateMatch[2], 10) - 1;
    let year = dateMatch[3]
      ? parseInt(dateMatch[3], 10)
      : new Date().getFullYear();

    if (dateMatch[3] && dateMatch[3].length === 2) {
      year += 2000;
    }

    const date = new Date(year, month, day);
    if (
      date.getFullYear() === year &&
      date.getMonth() === month &&
      date.getDate() === day
    ) {
      return date;
    }
  }

  const monthNameMatch = normalized.match(
    /^(\d{1,2})\s+([а-яё]+)(?:\s+(\d{2,4}))?$/,
  );
  if (monthNameMatch) {
    const day = parseInt(monthNameMatch[1], 10);
    const monthName = monthNameMatch[2];
    const month = RUSSIAN_MONTHS_MAP[monthName];

    if (month !== undefined) {
      let year = monthNameMatch[3]
        ? parseInt(monthNameMatch[3], 10)
        : new Date().getFullYear();
      if (monthNameMatch[3] && monthNameMatch[3].length === 2) {
        year += 2000;
      }

      const date = new Date(year, month, day);
      if (
        date.getFullYear() === year &&
        date.getMonth() === month &&
        date.getDate() === day
      ) {
        return date;
      }
    }
  }

  if (/^\d{1,2}$/.test(normalized)) {
    const day = parseInt(normalized, 10);
    const now = new Date();
    const date = new Date(now.getFullYear(), now.getMonth(), day);
    if (date.getDate() === day) return date;
  }

  return null;
}

export function parseRussianDateRange(
  input: string,
): { start: Date; end: Date } | null {
  const normalized = stripSchedulePrefix(input).replace(/\s+/g, ' ');

  const rangePart = normalized
    .replace(/^неделя\s*(?:\()?\s*/i, '')
    .replace(/\)\s*$/, '');

  const separators = ['—', '–', '-', ' по ', ' до '];
  let foundSeparator: string | null = null;

  for (const sep of separators) {
    if (rangePart.includes(sep)) {
      foundSeparator = sep;
      break;
    }
  }

  if (!foundSeparator) return null;

  const parts = rangePart.split(foundSeparator);
  if (parts.length !== 2) return null;

  const startStr = parts[0].trim();
  const endStr = parts[1].trim();

  const startDate = parseRussianDate(startStr);
  let endDate = parseRussianDate(endStr);

  if (!startDate && /^\d{1,2}$/.test(startStr) && endDate) {
    const day = parseInt(startStr, 10);
    const start = new Date(endDate);
    start.setDate(day);
    if (start > endDate) {
      start.setMonth(start.getMonth() - 1);
    }
    return { start, end: endDate };
  }

  if (startDate && endDate) {
    return { start: startDate, end: endDate };
  }

  return null;
}
