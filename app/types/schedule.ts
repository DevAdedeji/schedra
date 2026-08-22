export interface ScheduleRuleRecord {
  weekday: number
  start: string
  end: string
}

export interface ScheduleOverrideRecord {
  date: string
  start: string | null
  end: string | null
}

export interface ScheduleRecord {
  id: string
  name: string
  timeZone: string
  isDefault: boolean
  eventTypeCount: number
  rules: ScheduleRuleRecord[]
  overrides: ScheduleOverrideRecord[]
}
