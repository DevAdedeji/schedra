import type { WorkflowTrigger } from '#shared/workflows'

export const WORKFLOW_TRIGGER_OPTIONS: Array<{
  label: string
  value: WorkflowTrigger
  description: string
}> = [
  { label: 'A booking is confirmed', value: 'booking_created', description: 'Runs immediately after a guest books.' },
  { label: 'A booking needs approval', value: 'booking_requested', description: 'Runs when a guest submits a request.' },
  { label: 'A request is approved', value: 'booking_approved', description: 'Runs after the host confirms it.' },
  { label: 'A request is declined', value: 'booking_rejected', description: 'Runs after the host declines it.' },
  { label: 'A booking is cancelled', value: 'booking_cancelled', description: 'Runs for guest or host cancellations.' },
  { label: 'A booking is rescheduled', value: 'booking_rescheduled', description: 'Runs after a guest chooses a new time.' },
  { label: 'A guest is marked as a no-show', value: 'booking_no_show', description: 'Runs the first time a host records a missed meeting.' },
  { label: 'Before a meeting starts', value: 'before_start', description: 'Useful for reminders and preparation.' },
  { label: 'After a meeting ends', value: 'after_end', description: 'Useful for follow-ups and feedback.' }
]

export const WORKFLOW_OFFSET_OPTIONS = [
  { label: 'Immediately', value: 0 },
  { label: '15 minutes', value: 15 },
  { label: '30 minutes', value: 30 },
  { label: '1 hour', value: 60 },
  { label: '2 hours', value: 120 },
  { label: '1 day', value: 1440 },
  { label: '2 days', value: 2880 },
  { label: '1 week', value: 10080 }
]

export const WORKFLOW_RECIPIENT_OPTIONS = [
  { label: 'The attendee', value: 'attendee' },
  { label: 'The host or assigned hosts', value: 'hosts' },
  { label: 'A specific email address', value: 'custom' }
]
