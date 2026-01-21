export function normalizeGroupName(groupName: string): string {
  return groupName.trim().toUpperCase();
}

export function getGroupScheduleKey(groupName: string): string {
  const normalized = normalizeGroupName(groupName);
  return `schedule:${normalized}`;
}

export function getGroupsListKey(): string {
  return 'schedule:groups_list';
}

export function getActualGroupsKey(): string {
  return 'ystu:actual_groups';
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
  return 'schedule:teachers_list';
}

export function getAudiencesListKey(): string {
  return 'schedule:audiences_list';
}

export function getTeacherScheduleKey(teacherId: number | string): string {
  return `schedule:teacher:${teacherId}`;
}

export function getAudienceScheduleKey(audienceId: string): string {
  return `schedule:audience:${audienceId}`;
}
