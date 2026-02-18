/**
 * School hours checking utility for event scheduling failsafe.
 * Default: Mon-Fri 7:00-15:30. Configurable per-site via Site.settings.schoolHours.
 */

export interface SchoolHoursConfig {
  days: number[]; // 0=Sunday, 1=Monday, ... 6=Saturday
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

const DEFAULT_SCHOOL_HOURS: SchoolHoursConfig = {
  days: [1, 2, 3, 4, 5], // Mon-Fri
  startHour: 7,
  startMinute: 0,
  endHour: 15,
  endMinute: 30,
};

export function parseSchoolHours(siteSettings?: any): SchoolHoursConfig {
  if (!siteSettings?.schoolHours) return DEFAULT_SCHOOL_HOURS;
  const sh = siteSettings.schoolHours;
  return {
    days: sh.days ?? DEFAULT_SCHOOL_HOURS.days,
    startHour: sh.startHour ?? DEFAULT_SCHOOL_HOURS.startHour,
    startMinute: sh.startMinute ?? DEFAULT_SCHOOL_HOURS.startMinute,
    endHour: sh.endHour ?? DEFAULT_SCHOOL_HOURS.endHour,
    endMinute: sh.endMinute ?? DEFAULT_SCHOOL_HOURS.endMinute,
  };
}

export function isSchoolHours(siteSettings: any, timestamp: Date = new Date()): boolean {
  const config = parseSchoolHours(siteSettings);
  const day = timestamp.getDay();
  if (!config.days.includes(day)) return false;

  const minuteOfDay = timestamp.getHours() * 60 + timestamp.getMinutes();
  const startMinute = config.startHour * 60 + config.startMinute;
  const endMinute = config.endHour * 60 + config.endMinute;

  return minuteOfDay >= startMinute && minuteOfDay < endMinute;
}
