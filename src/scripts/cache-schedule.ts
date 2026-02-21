import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ScheduleService } from '../schedule/schedule.service';
import { Logger } from '@nestjs/common';
import 'dotenv/config';

const logger = new Logger('CacheScheduleScript');

type CacheType = 'all' | 'groups' | 'teachers' | 'audiences';

function parseArguments(): CacheType {
  const args = process.argv.slice(2);
  const type = args[0]?.toLowerCase();

  if (!type || type === 'all') {
    return 'all';
  }

  if (['groups', 'teachers', 'audiences'].includes(type)) {
    return type as CacheType;
  }

  logger.error(`❌ Неизвестный тип: ${type}`);
  logger.log('📖 Доступные типы: all, groups, teachers, audiences');
  process.exit(1);
}

async function cacheGroups(scheduleService: ScheduleService) {
  logger.log('📋 Поиск списка групп...');
  const groups = await scheduleService.getGroups();
  logger.log(`✅ Найдено групп: ${groups.length}`);

  if (groups.length === 0) {
    logger.warn('⚠️  Группы не найдены');
    return { success: 0, total: 0 };
  }

  logger.log('📅 Кэширую расписание для групп...');
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    try {
      await scheduleService.getSchedule(group);
      successCount++;
      if ((i + 1) % 10 === 0) {
        logger.log(`⏳ Прогресс: ${i + 1}/${groups.length} групп обработано`);
      }
    } catch (error: any) {
      errorCount++;
      logger.warn(
        `⚠️  Ошибка при кэшировании группы ${group}: ${error.message}`,
      );
    }
  }

  logger.log(`✅ Группы: успешно ${successCount}, ошибок ${errorCount}`);
  return { success: successCount, total: groups.length };
}

async function cacheTeachers(scheduleService: ScheduleService) {
  logger.log('👨‍🏫 Поиск списка преподавателей...');
  const teachers = await scheduleService.getTeachers();
  logger.log(`✅ Найдено преподавателей: ${teachers.length}`);

  if (teachers.length === 0) {
    logger.warn('⚠️  Преподаватели не найдены');
    return { success: 0, total: 0 };
  }

  logger.log('📅 Кэширую расписание для преподавателей...');
  let teacherSuccessCount = 0;
  let teacherErrorCount = 0;

  for (let i = 0; i < teachers.length; i++) {
    const teacher = teachers[i];
    try {
      const teacherId = teacher.id || teacher.teacherId || teacher;
      if (teacherId) {
        await scheduleService.getTeacherSchedule(teacherId);
        teacherSuccessCount++;
        if ((i + 1) % 10 === 0) {
          logger.log(
            `⏳ Прогресс: ${i + 1}/${teachers.length} преподавателей обработано`,
          );
        }
      }
    } catch (error: any) {
      teacherErrorCount++;
      logger.warn(
        `⚠️  Ошибка при кэшировании преподавателя ${JSON.stringify(teacher)}: ${error.message}`,
      );
    }
  }

  logger.log(
    `✅ Преподаватели: успешно ${teacherSuccessCount}, ошибок ${teacherErrorCount}`,
  );
  return { success: teacherSuccessCount, total: teachers.length };
}

async function cacheAudiences(scheduleService: ScheduleService) {
  logger.log('🏢 Поиск списка аудиторий...');
  const audiences = await scheduleService.getAudiences();
  logger.log(`✅ Найдено аудиторий: ${audiences.length}`);

  if (audiences.length === 0) {
    logger.warn('⚠️  Аудитории не найдены');
    return { success: 0, total: 0 };
  }

  logger.log('📅 Кэширую расписание для аудиторий...');
  let audienceSuccessCount = 0;
  let audienceErrorCount = 0;

  for (let i = 0; i < audiences.length; i++) {
    const audience = audiences[i];
    try {
      const audienceId = audience.id || audience.audienceId || audience;
      if (audienceId) {
        await scheduleService.getAudienceSchedule(audienceId);
        audienceSuccessCount++;
        if ((i + 1) % 10 === 0) {
          logger.log(
            `⏳ Прогресс: ${i + 1}/${audiences.length} аудиторий обработано`,
          );
        }
      }
    } catch (error: any) {
      audienceErrorCount++;
      logger.warn(
        `⚠️  Ошибка при кэшировании аудитории ${JSON.stringify(audience)}: ${error.message}`,
      );
    }
  }

  logger.log(
    `✅ Аудитории: успешно ${audienceSuccessCount}, ошибок ${audienceErrorCount}`,
  );
  return { success: audienceSuccessCount, total: audiences.length };
}

async function cacheSchedules(cacheType: CacheType) {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const scheduleService = app.get(ScheduleService);

  try {
    logger.log(`🚀 Начинаю кэширование расписания (тип: ${cacheType})...`);

    const stats = {
      groups: { success: 0, total: 0 },
      teachers: { success: 0, total: 0 },
      audiences: { success: 0, total: 0 },
    };

    if (cacheType === 'all' || cacheType === 'groups') {
      stats.groups = await cacheGroups(scheduleService);
    }

    if (cacheType === 'all' || cacheType === 'teachers') {
      stats.teachers = await cacheTeachers(scheduleService);
    }

    if (cacheType === 'all' || cacheType === 'audiences') {
      stats.audiences = await cacheAudiences(scheduleService);
    }

    logger.log('🎉 Кэширование завершено!');
    logger.log(`📊 Итого:`);
    logger.log(`   - Группы: ${stats.groups.success}/${stats.groups.total}`);
    logger.log(
      `   - Преподаватели: ${stats.teachers.success}/${stats.teachers.total}`,
    );
    logger.log(
      `   - Аудитории: ${stats.audiences.success}/${stats.audiences.total}`,
    );
  } catch (error) {
    logger.error('❌ Критическая ошибка при кэшировании:', error);
    process.exit(1);
  } finally {
    try {
      await app.close();
    } catch (closeError: any) {
      if (closeError?.message?.includes('Bot is not running')) {
        logger.debug('⚠️  Бот не был запущен, это нормально для скрипта');
      } else {
        logger.warn(
          `⚠️  Ошибка при закрытии приложения: ${closeError?.message || closeError}`,
        );
      }
    }
  }
}

const cacheType = parseArguments();
cacheSchedules(cacheType)
  .then(() => {
    logger.log('✅ Скрипт завершен успешно');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('❌ Фатальная ошибка:', error);
    process.exit(1);
  });
