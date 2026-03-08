export function normalizeGroupName(groupName: string): string {
  return groupName.trim().toUpperCase();
}

export function getGroupScheduleKey(groupName: string): string {
  const normalized = normalizeGroupName(groupName);
  return `schedule:${normalized}`;
}

export function getActualGroupsKey(): string {
  return 'schedule:list:actual_groups';
}

export function getStatisticsDisciplinesKey(institute: string): string {
  return `statistics:disciplines:${institute}`;
}

export function getStatisticsSubjectKey(
  institute: string,
  discipline: string,
): string {
  return `statistics:subject:${institute}:${encodeURIComponent(discipline)}`;
}

export function getTeachersListKey(): string {
  return 'schedule:list:teachers';
}

export function getAudiencesListKey(): string {
  return 'schedule:list:audiences';
}

export function getTeacherScheduleKey(teacherId: number | string): string {
  return `schedule:teacher:${teacherId}`;
}

export function getAudienceScheduleKey(audienceId: string): string {
  return `schedule:audience:${audienceId}`;
}
