import { z } from 'zod'

export const bookingLinkKindSchema = z.enum(['single_use', 'one_off'])
export type BookingLinkKind = z.infer<typeof bookingLinkKindSchema>

const bookingLinkSlotSchema = z.object({
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true })
}).refine(slot => Date.parse(slot.end) > Date.parse(slot.start), {
  message: 'A meeting time must end after it starts.'
})

export const createBookingLinkSchema = z.object({
  kind: bookingLinkKindSchema,
  eventTypeId: z.uuid(),
  durationMinutes: z.number().int().min(5).max(720).optional(),
  label: z.string().trim().max(80, 'Keep the label under 80 characters.').nullable().default(null),
  expiresAt: z.iso.datetime({ offset: true }),
  slots: z.array(bookingLinkSlotSchema).max(40, 'Choose no more than 40 times.').default([])
}).superRefine((value, context) => {
  if (value.kind === 'single_use' && value.slots.length) {
    context.addIssue({ code: 'custom', path: ['slots'], message: 'A single-use link follows the event type availability.' })
  }
  if (value.kind === 'one_off' && !value.slots.length) {
    context.addIssue({ code: 'custom', path: ['slots'], message: 'Choose at least one time for this one-off meeting.' })
  }
})

export type CreateBookingLinkInput = z.infer<typeof createBookingLinkSchema>

export const bookingLinksQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
  filter: z.enum(['all', 'available', 'booked', 'closed']).default('all')
})
