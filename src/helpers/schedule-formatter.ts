const MOSCOW_TZ = 'Europe/Moscow';

const LESSON_TYPES = {
  0: 'Нет типа',
  1: 'Курсовой проект',
  2: 'Лекция',
  3: 'Экзамен',
  4: 'Практика',
  5: 'Консультация',
  6: 'Лекция + Практика',
  7: 'Дифференцированный зачет',
  8: 'Лабораторная работа',
  9: 'Библиотека',
  10: 'Лекция + Лабораторная работа',
  11: 'Организационное собрание',
  12: 'Не поддерживается',
  256: 'Экзамен',
};

function escapeHtml(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function getLessonTypeName(type: number): string {
  return LESSON_TYPES[type] || '';
}

function toMoscowStartOfDay(dateInput: Date | string): Date {
  const date =
    typeof dateInput === 'string' ? new Date(dateInput) : new Date(dateInput);
  const moscowDate = new Date(
    date.toLocaleString('en-US', { timeZone: MOSCOW_TZ }),
  );
  moscowDate.setHours(0, 0, 0, 0);
  return moscowDate;
}

function toMoscowTime(dateInput: Date | string): string {
  const date =
    typeof dateInput === 'string' ? new Date(dateInput) : new Date(dateInput);
  const moscowDate = new Date(
    date.toLocaleString('en-US', { timeZone: MOSCOW_TZ }),
  );
  const hh = moscowDate.getHours().toString().padStart(2, '0');
  const mm = moscowDate.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatLessonTime(lesson: any): string | null {
  if (lesson.type === 256) return null;

  if (lesson.timeRange) return lesson.timeRange;

  if (lesson.startAt && lesson.endAt) {
    const start = new Date(lesson.startAt);
    const end = new Date(lesson.endAt);
    const durationMs = end.getTime() - start.getTime();
    const durationHours = durationMs / (1000 * 60 * 60);
    if (durationHours >= 23) return null;
    return `${toMoscowTime(start)}-${toMoscowTime(end)}`;
  }

  if (lesson.startAt) return toMoscowTime(lesson.startAt);

  return '—';
}

export function formatSchedule(
  schedule: any,
  dayOffset: number | 'week' | Date,
  groupName: string,
  weekOffset = 0,
  type: 'student' | 'teacher' | 'audience' = 'student',
): string {
  if (!schedule || !schedule.items) {
    return '❌ Расписание не найдено.';
  }

  if (dayOffset === 'week') {
    return formatWeekSchedule(schedule, groupName, weekOffset, type);
  }

  if (dayOffset instanceof Date) {
    return formatDaySchedule(
      schedule,
      toMoscowStartOfDay(dayOffset),
      groupName,
      type,
    );
  }

  const date = toMoscowStartOfDay(new Date());
  if (dayOffset !== 0) {
    date.setDate(date.getDate() + dayOffset);
  }

  return formatDaySchedule(schedule, date, groupName, type);
}

function formatDaySchedule(
  schedule: any,
  targetDate: Date,
  groupName: string,
  type: 'student' | 'teacher' | 'audience' = 'student',
): string {
  targetDate.setHours(0, 0, 0, 0);

  const dayNames = [
    'Воскресенье',
    'Понедельник',
    'Вторник',
    'Среда',
    'Четверг',
    'Пятница',
    'Суббота',
  ];
  const dayName = dayNames[targetDate.getDay()];

  const dateStr =
    targetDate.getDate().toString().padStart(2, '0') +
    '.' +
    (targetDate.getMonth() + 1).toString().padStart(2, '0') +
    '.' +
    targetDate.getFullYear();

  let foundLessons: any[] = [];

  for (const week of schedule.items) {
    for (const day of week.days) {
      const dayDate = toMoscowStartOfDay(day.info.date);

      if (dayDate.getTime() === targetDate.getTime()) {
        foundLessons = day.lessons || [];
        break;
      }
    }
    if (foundLessons.length > 0) break;
  }

  if (foundLessons.length === 0) {
    return `📅 ${dayName} (${dateStr})\n\n🎉 Занятий нет`;
  }

  let msg = `📅 ${dayName} (${dateStr})\n\n`;

  foundLessons.forEach((lesson) => {
    if (!lesson.lessonName && !lesson.teacherName && !lesson.auditoryName) {
      return;
    }

    msg += `📚 ${escapeHtml(lesson.lessonName)}\n`;
    msg += `📝 ${getLessonTypeName(lesson.type)}\n`;
    const time = formatLessonTime(lesson);
    if (time) msg += `🕐 ${time}\n`;
    if (lesson.teacherName && type !== 'teacher')
      msg += `👨‍🏫 ${escapeHtml(lesson.teacherName)}\n`;
    if (lesson.auditoryName) msg += `🏛 ${escapeHtml(lesson.auditoryName)}\n`;
    if (
      (type === 'teacher' || type === 'audience') &&
      lesson.groups &&
      Array.isArray(lesson.groups) &&
      lesson.groups.length > 0
    ) {
      msg += `👥 ${lesson.groups.join(', ')}\n`;
    }
    msg += '\n';
  });

  return msg;
}

function formatWeekSchedule(
  schedule: any,
  groupName: string,
  weekOffset: number,
  type: 'student' | 'teacher' | 'audience' = 'student',
): string {
  const today = toMoscowStartOfDay(new Date());
  if (weekOffset && !Number.isNaN(weekOffset)) {
    today.setDate(today.getDate() + weekOffset * 7);
  }

  const weekStart = new Date(today);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  const dayNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const formatShort = (d: Date) =>
    `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1)
      .toString()
      .padStart(2, '0')}`;
  let msg = `📅 Расписание на неделю (${formatShort(
    weekStart,
  )} – ${formatShort(weekEnd)})\n\n`;

  const daysWithLessons: Array<{ date: Date; lessons: any[] }> = [];

  for (const week of schedule.items) {
    for (const day of week.days) {
      const dayDate = toMoscowStartOfDay(day.info.date);

      if (
        dayDate >= weekStart &&
        dayDate <= weekEnd &&
        day.lessons &&
        day.lessons.length > 0
      ) {
        daysWithLessons.push({
          date: dayDate,
          lessons: day.lessons,
        });
      }
    }
  }

  if (daysWithLessons.length === 0) {
    return msg + '🎉 На этой неделе занятий нет';
  }

  daysWithLessons.sort((a, b) => a.date.getTime() - b.date.getTime());

  daysWithLessons.forEach((day) => {
    const dateStr =
      day.date.getDate().toString().padStart(2, '0') +
      '.' +
      (day.date.getMonth() + 1).toString().padStart(2, '0');
    const dayName = dayNames[day.date.getDay()];

    msg += `━━━ ${dayName} ${dateStr} ━━━\n\n`;

    day.lessons.forEach((lesson) => {
      if (!lesson.lessonName && !lesson.teacherName && !lesson.auditoryName) {
        return;
      }

      msg += `📚 ${escapeHtml(lesson.lessonName)}\n`;
      msg += `📝 ${getLessonTypeName(lesson.type)}\n`;
      const time = formatLessonTime(lesson);
      if (time) msg += `🕐 ${time}\n`;
      if (lesson.teacherName && type !== 'teacher')
        msg += `👨‍🏫 ${escapeHtml(lesson.teacherName)}\n`;
      if (lesson.auditoryName) msg += `🏛 ${escapeHtml(lesson.auditoryName)}\n`;
      if (
        (type === 'teacher' || type === 'audience') &&
        lesson.groups &&
        Array.isArray(lesson.groups) &&
        lesson.groups.length > 0
      ) {
        msg += `👥 ${lesson.groups.join(', ')}\n`;
      }
      msg += '\n';
    });
  });

  return msg;
}
