export interface ProductFeature {
  title: string
  summary: string
  icon: string
}

export interface ProductFeatureGroup {
  eyebrow: string
  title: string
  description: string
  features: ProductFeature[]
}

export const productFeatureGroups: ProductFeatureGroup[] = [
  {
    eyebrow: 'Scheduling',
    title: 'A booking flow that fits the way you work',
    description: 'Start with a simple link, then add control only where a meeting needs it.',
    features: [
      { title: 'Flexible event types', summary: 'Set durations, buffers, notice, booking windows, booking limits, questions, approvals and capacity.', icon: 'i-lucide-calendar-range' },
      { title: 'Private meeting links', summary: 'Send a secure single-use link with your normal availability, or offer only the exact times you choose.', icon: 'i-lucide-send' },
      { title: 'Availability schedules', summary: 'Reuse working hours, date overrides and timezones across different event types.', icon: 'i-lucide-clock-3' },
      { title: 'Group events', summary: 'Let several guests reserve the same session while capacity stays accurate.', icon: 'i-lucide-users-round' },
      { title: 'Routing forms', summary: 'Ask a few questions and send each guest to the right booking experience.', icon: 'i-lucide-git-branch' }
    ]
  },
  {
    eyebrow: 'Automation',
    title: 'Keep every meeting moving after it is booked',
    description: 'Schedra handles the routine work and keeps a clear trail when another service needs attention.',
    features: [
      { title: 'Workflows', summary: 'Send timely emails or secure webhooks when bookings are created, changed or approaching.', icon: 'i-lucide-workflow' },
      { title: 'Calendar sync', summary: 'Protect busy time and update Google or Microsoft calendars after changes.', icon: 'i-lucide-refresh-cw' },
      { title: 'Meeting rooms', summary: 'Create unique Google Meet, Microsoft Teams or Zoom links automatically.', icon: 'i-lucide-video' },
      { title: 'Reliable delivery', summary: 'Durable jobs, retries and operational health checks reduce silent failures.', icon: 'i-lucide-shield-check' }
    ]
  },
  {
    eyebrow: 'Growth',
    title: 'Turn scheduling into a better customer journey',
    description: 'Understand demand, collect payment and keep visitors on the experience you already own.',
    features: [
      { title: 'Booking analytics', summary: 'See booking trends, conversion, lead time, traffic source and popular event types.', icon: 'i-lucide-chart-no-axes-combined' },
      { title: 'Paid bookings', summary: 'Collect payment before confirmation and trace checkouts, fees, settlements and refunds.', icon: 'i-lucide-wallet-cards' },
      { title: 'Website overlays', summary: 'Open the real booking flow over your own site instead of redirecting visitors away.', icon: 'i-lucide-panels-top-left' },
      { title: 'Teams and workspaces', summary: 'Run branded round-robin or collective events with managed templates, roles and shared operations.', icon: 'i-lucide-building-2' }
    ]
  }
]

export const landingFeatureHighlights = [
  ['Book from anywhere', 'Share a memorable link or open the same booking flow over your own website without redirecting visitors.'],
  ['Invite someone privately', 'Create a secure single-use link with your usual availability, or offer a hand-picked set of times for one meeting.'],
  ['Route every guest', 'Use routing forms, reusable schedules and booking rules to take people to the right meeting.'],
  ['Schedule alone or together', 'Run personal, round-robin, collective and group events without mixing private calendars.'],
  ['Automate the follow-through', 'Send workflow emails and webhooks while durable calendar and meeting-link jobs handle retries.'],
  ['Learn what converts', 'Understand booking trends, lead time, traffic sources and the event types people choose.'],
  ['Get paid and trace it', 'Confirm paid bookings only after checkout and follow payments, fees, settlements and refunds.']
] as const
