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

  if (dayOffset === 'week') {
    return formatWeekSchedule(schedule, groupName);
  }

  const date = new Date();
  if (dayOffset === 1) {
    date.setDate(date.getDate() + 1);
  }

  return formatDaySchedule(schedule, date, groupName);
}

function formatDaySchedule(
  schedule: any,
  targetDate: Date,
  groupName: string,
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
      const dayDate = new Date(day.info.date);
      dayDate.setHours(0, 0, 0, 0);

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
    msg += `📚 ${lesson.lessonName}\n`;
    msg += `📝 ${getLessonTypeName(lesson.type)}\n`;
    msg += `🕐 ${lesson.timeRange}\n`;
    if (lesson.teacherName) msg += `👨‍🏫 ${lesson.teacherName}\n`;
    if (lesson.auditoryName) msg += `🏛 ${lesson.auditoryName}\n`;
    msg += '\n';
  });

  return msg;
}

function formatWeekSchedule(schedule: any, groupName: string): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const weekEnd = new Date(today);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const dayNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  let msg = '📅 Расписание на неделю\n\n';

  const daysWithLessons: Array<{ date: Date; lessons: any[] }> = [];

  for (const week of schedule.items) {
    for (const day of week.days) {
      const dayDate = new Date(day.info.date);
      dayDate.setHours(0, 0, 0, 0);

      if (
        dayDate >= today &&
        dayDate < weekEnd &&
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
      msg += `📚 ${lesson.lessonName}\n`;
      msg += `📝 ${getLessonTypeName(lesson.type)}\n`;
      msg += `🕐 ${lesson.timeRange}\n`;
      if (lesson.teacherName) msg += `👨‍🏫 ${lesson.teacherName}\n`;
      if (lesson.auditoryName) msg += `🏛 ${lesson.auditoryName}\n`;
      msg += '\n';
    });
  });

  return msg;
}
