export const LESSON_TYPES = {
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

export function getLessonTypeName(type: number): string {
  return LESSON_TYPES[type] || '';
}

export function formatSchedule(
  schedule: any,
  dayOffset: number | 'week',
  groupName: string,
): string {
  if (!schedule || !schedule.items) {
    return '❌ Расписание не найдено.';
  }

  const date = new Date();
  if (dayOffset === 1) {
    date.setDate(date.getDate() + 1);
  }

  if (dayOffset === 'week') {
    return formatWeekSchedule(schedule, groupName);
  }

  return formatDaySchedule(schedule, date, groupName);
}

function formatDaySchedule(
  schedule: any,
  date: Date,
  groupName: string,
): string {
  const dayStr = date.toISOString().split('T')[0];

  let lessons: any[] = [];

  for (const week of schedule.items) {
    for (const day of week.days) {
      if (day.info.date === dayStr) {
        lessons = day.lessons;
        break;
      }
    }
    if (lessons.length > 0) break;
  }

  const dateFormatted = date.toLocaleDateString('ru-RU', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  });

  let msg = `📅 Расписание на ${dateFormatted} (${groupName}):\n\n`;

  if (lessons.length === 0) {
    msg += '🎉 Пар нет! Отдыхайте.';
    return msg;
  }

  lessons.forEach((lesson) => {
    msg += `🕒 ${lesson.timeRange} - ${lesson.lessonName}\n`;
    msg += `📝 ${getLessonTypeName(lesson.type)}\n`;
    if (lesson.auditoryName) msg += `🚪 ${lesson.auditoryName}\n`;
    if (lesson.teacherName) msg += `👨‍🏫 ${lesson.teacherName}\n`;
    msg += '\n';
  });

  return msg;
}

function formatWeekSchedule(schedule: any, groupName: string): string {
  const today = new Date().toISOString().split('T')[0];
  let currentWeek = schedule.items.find((w: any) =>
    w.days.some((d: any) => d.info.date === today),
  );

  if (!currentWeek && schedule.items.length > 0) {
    currentWeek = schedule.items[0];
  }

  if (!currentWeek) {
    return 'Расписание на неделю не найдено.';
  }

  let msg = `📅 Расписание на неделю (${groupName}):\n\n`;

  for (const day of currentWeek.days) {
    if (day.lessons.length === 0) continue;

    const d = new Date(day.info.date);
    const dateFormatted = d.toLocaleDateString('ru-RU', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
    });

    msg += `🔹 ${dateFormatted}\n`;
    day.lessons.forEach((lesson: any) => {
      msg += `${lesson.timeRange} ${lesson.lessonName} (${lesson.auditoryName})\n`;
    });
    msg += '\n';
  }

  return msg;
}
