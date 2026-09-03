export interface SeoLandingPageContent {
  path: string
  eyebrow: string
  metaTitle: string
  metaDescription: string
  headline: string
  intro: string
  problemTitle: string
  problemDescription: string
  benefits: Array<{ title: string, description: string, icon: string }>
  steps: Array<{ title: string, description: string }>
  useCases: string[]
  faqs: Array<{ question: string, answer: string }>
  related: Array<{ label: string, description: string, to: string }>
}

export const seoLandingPages: Record<string, SeoLandingPageContent> = {
  '/solutions/consultants': {
    path: '/solutions/consultants',
    eyebrow: 'Scheduling for consultants',
    metaTitle: 'Online Scheduling Software for Consultants',
    metaDescription: 'Let consulting clients book the right meeting, pay when required and receive automatic reminders with Schedra scheduling software.',
    headline: 'Spend less time scheduling. More time consulting.',
    intro: 'Give every prospect and client one clear place to choose the right call, see your real availability and confirm a time in their own timezone.',
    problemTitle: 'A professional booking flow without the calendar admin',
    problemDescription: 'Schedra handles the repetitive work around a consulting meeting while you keep control of your availability, meeting formats and client experience.',
    benefits: [
      { title: 'One link, several meeting lengths', description: 'Offer a focused call or a longer working session from the same event type without maintaining duplicate links.', icon: 'i-lucide-timer' },
      { title: 'Charge for your time', description: 'Collect payment for paid appointments and keep the booking connected to its payment status.', icon: 'i-lucide-wallet-cards' },
      { title: 'Follow-ups that run themselves', description: 'Send confirmations, reminders and workflow emails without manually chasing every client.', icon: 'i-lucide-workflow' }
    ],
    steps: [
      { title: 'Choose your meeting formats', description: 'Create discovery calls, advisory sessions or recurring client check-ins with the durations you actually use.' },
      { title: 'Connect your working calendar', description: 'Schedra checks connected calendars and only offers times that remain available.' },
      { title: 'Share one clear next step', description: 'Place your booking link in proposals, email signatures and your website so clients can book without another email thread.' }
    ],
    useCases: ['Independent consultants', 'Coaches and advisors', 'Freelance specialists', 'Agencies offering consultations'],
    faqs: [
      { question: 'Can clients choose between different meeting lengths?', answer: 'Yes. One event type can offer its main duration plus additional durations, so clients choose without making you manage several nearly identical links.' },
      { question: 'Can I require payment before confirming a consultation?', answer: 'Yes. Paid event types connect the reservation to its checkout so the appointment is not treated as paid until the payment provider confirms it.' },
      { question: 'Will Schedra handle client timezones?', answer: 'Yes. Guests see available times in their own timezone while your availability remains tied to the timezone you configured.' },
      { question: 'Can I send reminders automatically?', answer: 'Yes. Event reminders and workflows can send the right message before or after a booking without manual follow-up.' }
    ],
    related: [
      { label: 'Paid appointments', description: 'Connect scheduling and payment in one flow.', to: '/solutions/paid-appointments' },
      { label: 'Booking widget', description: 'Let clients book without leaving your website.', to: '/features/booking-widget' },
      { label: 'Explore every feature', description: 'See scheduling, analytics, workflows and integrations.', to: '/features' }
    ]
  },
  '/solutions/small-business': {
    path: '/solutions/small-business',
    eyebrow: 'Scheduling for small businesses',
    metaTitle: 'Appointment Scheduling for Small Businesses',
    metaDescription: 'Accept appointments online, reduce scheduling messages and coordinate staff availability with Schedra for small businesses.',
    headline: 'A simpler appointment system for a busy small business.',
    intro: 'Turn enquiries into confirmed appointments with a booking page that stays available even when nobody is free to answer the phone.',
    problemTitle: 'Keep bookings organised without adding more admin',
    problemDescription: 'Schedra brings availability, team assignment, reminders and payment status into one scheduling flow that is understandable for staff and customers.',
    benefits: [
      { title: 'Appointments around real availability', description: 'Working hours, time off, notice periods and booking limits protect the time your team needs.', icon: 'i-lucide-calendar-check-2' },
      { title: 'The right person gets the booking', description: 'Use individual, round-robin or collective team events depending on how your service is delivered.', icon: 'i-lucide-users' },
      { title: 'Fewer missed appointments', description: 'Automatic confirmations and reminders give customers the details they need before the meeting.', icon: 'i-lucide-bell-ring' }
    ],
    steps: [
      { title: 'Create your services', description: 'Set the duration, location, questions, capacity and price for each appointment customers can book.' },
      { title: 'Add your team and availability', description: 'Each person keeps their own calendar and working hours while the team controls shared booking links.' },
      { title: 'Share or embed the booking flow', description: 'Use a hosted page, direct link or website overlay wherever customers already find your business.' }
    ],
    useCases: ['Professional service firms', 'Small agencies', 'Tutors and educators', 'Appointment-based local teams'],
    faqs: [
      { question: 'Can several employees receive bookings?', answer: 'Yes. Team event types can assign one host, rotate bookings between available hosts or require several hosts for the same meeting.' },
      { question: 'Can we prevent too many bookings in one day?', answer: 'Yes. Booking limits can cap reservations per day, week or month alongside notice periods and availability rules.' },
      { question: 'Can customers book from our existing website?', answer: 'Yes. Schedra provides a booking overlay and inline embed so customers do not have to leave your site.' },
      { question: 'Can we see how the team is performing?', answer: 'Yes. Team analytics show booking activity and can be exported according to each member’s permissions.' }
    ],
    related: [
      { label: 'Team scheduling', description: 'Coordinate shared availability and assignment.', to: '/solutions/team-scheduling' },
      { label: 'Paid appointments', description: 'Collect payment as part of booking.', to: '/solutions/paid-appointments' },
      { label: 'Pricing', description: 'Compare personal and team plans.', to: '/pricing' }
    ]
  },
  '/solutions/paid-appointments': {
    path: '/solutions/paid-appointments',
    eyebrow: 'Paid appointment booking',
    metaTitle: 'Paid Appointment Booking Software',
    metaDescription: 'Create paid booking links, confirm appointments after payment and track refunds and settlements with Schedra.',
    headline: 'Get the booking and the payment in one clear flow.',
    intro: 'Set a price on an event type and let clients reserve and pay without separating your calendar from your checkout.',
    problemTitle: 'Know which appointments are actually paid',
    problemDescription: 'Schedra links each checkout to one booking and waits for verified provider confirmation, giving you a reliable record instead of trusting a browser success screen.',
    benefits: [
      { title: 'Payment-linked reservations', description: 'A paid appointment keeps its amount, currency and checkout state attached to the booking.', icon: 'i-lucide-calendar-check' },
      { title: 'Clear financial history', description: 'Review confirmed payments, fees, settlement information, withdrawals and refund progress.', icon: 'i-lucide-receipt-text' },
      { title: 'Safe failure recovery', description: 'Expired holds and failed refunds remain visible so they can be reconciled instead of silently disappearing.', icon: 'i-lucide-shield-check' }
    ],
    steps: [
      { title: 'Connect a payment recipient', description: 'Complete the payment-provider setup for your personal account or team.' },
      { title: 'Set the appointment price', description: 'Choose a supported collection currency and show the price before a guest selects a time.' },
      { title: 'Let confirmation follow payment', description: 'Schedra holds the slot during checkout and confirms the booking from verified payment state.' }
    ],
    useCases: ['Paid consultations', 'Coaching sessions', 'Classes and workshops', 'Professional advisory calls'],
    faqs: [
      { question: 'Is a booking confirmed just because the customer returns from checkout?', answer: 'No. Schedra uses verified payment-provider state as the source of truth before treating a paid reservation as successful.' },
      { question: 'What happens if checkout is abandoned?', answer: 'The slot is held for a limited period. If payment is not completed, the hold expires so the time can become available again.' },
      { question: 'Can teams collect payments?', answer: 'Yes. A team can connect its payment recipient and use paid team event types independently of a member’s personal plan.' },
      { question: 'Can I track a refund?', answer: 'Yes. Refunds retain requested, processing, successful or failed state rather than being shown as complete before the provider confirms them.' }
    ],
    related: [
      { label: 'Consultant scheduling', description: 'Turn expertise into bookable sessions.', to: '/solutions/consultants' },
      { label: 'Small-business scheduling', description: 'Organise staff and customer appointments.', to: '/solutions/small-business' },
      { label: 'Pricing', description: 'See the plans that include advanced tools.', to: '/pricing' }
    ]
  },
  '/solutions/team-scheduling': {
    path: '/solutions/team-scheduling',
    eyebrow: 'Team scheduling software',
    metaTitle: 'Round-Robin and Team Scheduling Software',
    metaDescription: 'Distribute meetings with round-robin scheduling, coordinate collective events and manage team booking links with Schedra.',
    headline: 'Route every meeting to the right available teammate.',
    intro: 'Create team booking pages that respect each member’s calendar while keeping shared event types, branding and reporting organised.',
    problemTitle: 'Shared scheduling without a shared-calendar mess',
    problemDescription: 'Team members keep their own availability. Schedra combines it only when a shared booking needs to choose or coordinate hosts.',
    benefits: [
      { title: 'Round-robin distribution', description: 'Offer times from available team members and distribute new meetings through a fair assignment flow.', icon: 'i-lucide-refresh-cw' },
      { title: 'Collective meetings', description: 'Find a time when every required host is free for panels, onboarding or multi-person calls.', icon: 'i-lucide-users-round' },
      { title: 'Managed event templates', description: 'Give selected members consistent booking links while allowing controlled personalisation.', icon: 'i-lucide-layout-template' }
    ],
    steps: [
      { title: 'Create the team workspace', description: 'Invite members and assign clear owner, administrator and member permissions.' },
      { title: 'Choose how hosts are assigned', description: 'Use one host, round robin or collective availability for each team event type.' },
      { title: 'Measure and improve', description: 'Review team booking analytics and export the data each role is allowed to see.' }
    ],
    useCases: ['Sales and discovery teams', 'Customer onboarding', 'Recruiting panels', 'Agencies with shared services'],
    faqs: [
      { question: 'What is round-robin scheduling?', answer: 'Round robin offers times from a group of eligible hosts and assigns a booking to an available member instead of sending every meeting to one person.' },
      { question: 'What is collective scheduling?', answer: 'Collective scheduling only offers times when all required hosts are available, which is useful when several team members must attend together.' },
      { question: 'Do team members lose their personal booking pages?', answer: 'No. Team membership and personal scheduling are separate. A member can keep personal event types while also hosting team event types.' },
      { question: 'Can team administrators standardise event types?', answer: 'Yes. Managed templates can create consistent member links and keep administrator-controlled fields synchronised.' }
    ],
    related: [
      { label: 'Small-business scheduling', description: 'Build a customer-friendly appointment flow.', to: '/solutions/small-business' },
      { label: 'Booking widget', description: 'Embed team booking into your website.', to: '/features/booking-widget' },
      { label: 'Explore every feature', description: 'See workflows, routing, analytics and more.', to: '/features' }
    ]
  },
  '/features/booking-widget': {
    path: '/features/booking-widget',
    eyebrow: 'Embeddable booking widget',
    metaTitle: 'Booking Widget for Your Website',
    metaDescription: 'Add a responsive scheduling widget to your website with timezone-aware availability and a clear Schedra booking flow.',
    headline: 'Let visitors book without leaving your website.',
    intro: 'Turn any button or section into a booking experience that opens directly on your site and stays connected to your Schedra availability.',
    problemTitle: 'Fewer steps between interest and a confirmed time',
    problemDescription: 'A visitor can choose an event, see available times in the correct timezone and finish booking without being sent through an unfamiliar series of pages.',
    benefits: [
      { title: 'Overlay or inline booking', description: 'Open Schedra from a call-to-action or place the booking flow directly inside a page.', icon: 'i-lucide-panels-top-left' },
      { title: 'Responsive by default', description: 'The booking experience adapts to the available space across phones, tablets and desktop screens.', icon: 'i-lucide-monitor-smartphone' },
      { title: 'One source of availability', description: 'Embedded bookings use the same event settings, connected calendars and booking rules as your hosted page.', icon: 'i-lucide-calendar-sync' }
    ],
    steps: [
      { title: 'Choose an event type', description: 'Use the personal or team event that visitors should be able to book.' },
      { title: 'Copy the embed snippet', description: 'Add the generated script and button or inline container to your website.' },
      { title: 'Keep managing everything in Schedra', description: 'Changes to availability and event settings automatically apply to the embedded experience.' }
    ],
    useCases: ['Portfolio contact pages', 'Consulting websites', 'Agency service pages', 'Product demo pages'],
    faqs: [
      { question: 'Does the widget work on mobile?', answer: 'Yes. The embedded booking interface is responsive and designed to fit smaller screens as well as desktop layouts.' },
      { question: 'Do I need to maintain separate availability for the widget?', answer: 'No. The widget reads the same Schedra event type and availability used by the hosted booking page.' },
      { question: 'Can I open booking from an existing button?', answer: 'Yes. The overlay option can attach the booking experience to a call-to-action instead of occupying permanent space on the page.' },
      { question: 'Will visitors see times in their timezone?', answer: 'Yes. The booking flow presents availability using the guest’s selected timezone while preserving the host’s scheduling rules.' }
    ],
    related: [
      { label: 'Consultant scheduling', description: 'Make consultation pages easier to convert.', to: '/solutions/consultants' },
      { label: 'Team scheduling', description: 'Embed a shared team booking flow.', to: '/solutions/team-scheduling' },
      { label: 'All Schedra features', description: 'Explore everything around the booking widget.', to: '/features' }
    ]
  },
  '/compare/calendly-alternative': {
    path: '/compare/calendly-alternative',
    eyebrow: 'Calendly alternative',
    metaTitle: 'Calendly Alternative for Flexible Scheduling',
    metaDescription: 'Looking for a Calendly alternative? Explore Schedra booking pages, multiple durations, workflows, routing, team scheduling and paid appointments.',
    headline: 'A Calendly alternative built to stay clear as you grow.',
    intro: 'Start with a straightforward personal booking link, then add payments, routing, workflows or team scheduling when your process genuinely needs them.',
    problemTitle: 'Powerful scheduling should still feel understandable',
    problemDescription: 'Schedra keeps personal and team subscriptions separate, uses focused forms and gives advanced features a clear place instead of crowding the basic booking flow.',
    benefits: [
      { title: 'Flexible personal scheduling', description: 'Use multiple durations, recurring bookings, booking limits, time off and private one-use meeting links.', icon: 'i-lucide-calendar-range' },
      { title: 'Automation without losing control', description: 'Build booking workflows and routing forms while keeping the guest experience focused.', icon: 'i-lucide-workflow' },
      { title: 'Teams when you actually need them', description: 'Add round robin, collective scheduling, team analytics and managed templates separately from personal Pro.', icon: 'i-lucide-users' }
    ],
    steps: [
      { title: 'Create your personal booking page', description: 'Set your availability and publish the meeting types people should be able to choose.' },
      { title: 'Connect the tools around the meeting', description: 'Add calendars, video conferencing, reminders, workflows or payment according to your process.' },
      { title: 'Expand without rebuilding', description: 'Keep personal scheduling while creating a separate team workspace when collaboration becomes necessary.' }
    ],
    useCases: ['People replacing scattered booking links', 'Consultants who need paid sessions', 'Teams that need host assignment', 'Businesses embedding scheduling on their site'],
    faqs: [
      { question: 'Can I use Schedra for personal scheduling without creating a team?', answer: 'Yes. Personal scheduling is a complete product on its own; a team workspace is only needed for shared ownership, host assignment and team administration.' },
      { question: 'Can one event type offer multiple durations?', answer: 'Yes. Guests can choose from the durations you enable on one event type instead of navigating several duplicate links.' },
      { question: 'Does Schedra support workflows and routing forms?', answer: 'Yes. Routing forms direct a guest to the appropriate event, while workflows automate messages and follow-up around booking activity.' },
      { question: 'Can I keep a personal plan while joining or creating a team?', answer: 'Yes. Personal Pro and team billing represent different benefits, so team membership does not silently replace a user’s personal subscription.' }
    ],
    related: [
      { label: 'All features', description: 'Review the complete Schedra feature set.', to: '/features' },
      { label: 'Team scheduling', description: 'Compare shared scheduling modes.', to: '/solutions/team-scheduling' },
      { label: 'Pricing', description: 'See personal and team plan options.', to: '/pricing' }
    ]
  }
}
