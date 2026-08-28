<script setup lang="ts">
definePageMeta({ layout: 'default' })

useSeoMeta({
  title: 'Privacy policy',
  description: 'How Schedra collects, uses, protects and deletes personal information.'
})
</script>

<template>
  <PublicDocument
    eyebrow="Legal"
    title="Privacy, without the fog."
    summary="This policy explains what Schedra collects, why we need it, who receives it and the controls available to you."
    updated="28 August 2026"
  >
    <section>
      <h2>1. Who this policy covers</h2>
      <p>
        This policy applies when you create or use a Schedra account, join a Schedra team,
        connect an integration, visit a Schedra booking page, or make a booking through Schedra.
        In this policy, “Schedra”, “we”, “us” and “our” refer to the operator of the Schedra service.
      </p>
      <p>
        Questions and privacy requests can be sent to
        <a href="mailto:support@schedra.xyz">support@schedra.xyz</a>.
      </p>
    </section>

    <section>
      <h2>2. Information we collect</h2>
      <h3>Account and profile information</h3>
      <p>
        We collect information you provide, such as your name, email address, username,
        password verifier, timezone, profile biography and profile photo. Team accounts also
        contain organization details, roles, invitations and membership history.
      </p>

      <h3>Scheduling and booking information</h3>
      <p>
        We process schedules, availability rules, event types, meeting locations, booking
        questions and the information a guest supplies when booking. This can include a guest’s
        name, email address, timezone, additional guests and answers to booking questions.
      </p>

      <h3>Connected services</h3>
      <p>
        If you connect a calendar or video provider, we receive the account identifier,
        account label, granted permissions and OAuth credentials needed to operate the
        integration. Access and refresh tokens are encrypted before database storage.
      </p>
      <p>
        For Google Calendar, Schedra reads the calendars you select for conflict checking and
        writes booking events to the calendar you choose. For Zoom, Schedra creates, updates
        and deletes meetings for bookings whose location is Zoom. Schedra does not access Zoom
        meeting audio, video, chat, recordings, transcripts, participant activity or analytics.
      </p>

      <h3>Billing information</h3>
      <p>
        For paid team plans, we keep subscription, seat, invoice, currency and payment-status
        information. Payment providers process card and bank details; Schedra does not store
        complete payment-card or bank-account numbers.
      </p>

      <h3>Technical and security information</h3>
      <p>
        We process session identifiers, IP addresses, browser request data, security and rate-limit
        events, delivery attempts and integration error records to operate and protect the service.
      </p>
      <p>
        We use Microsoft Clarity to understand how visitors use Schedra. Clarity can process page
        visits, clicks, scrolling, navigation, browser and device information, approximate location
        and session recordings. Sensitive form content, including input values and email addresses,
        is masked by default and is not included in recordings.
      </p>
    </section>

    <section>
      <h2>3. How we use information</h2>
      <ul>
        <li>Provide booking pages, availability calculations, reminders and account features.</li>
        <li>Prevent double-booking and keep connected calendars and meetings synchronized.</li>
        <li>Authenticate users, prevent abuse and investigate security or reliability incidents.</li>
        <li>Deliver service messages, including verification, booking and billing emails.</li>
        <li>Administer team subscriptions, invoices and occupied seats.</li>
        <li>Understand visitor journeys and improve the usability and reliability of Schedra.</li>
        <li>Comply with legal obligations and enforce our Terms.</li>
      </ul>
      <p>
        We do not sell personal information and we do not use third-party advertising trackers.
      </p>
    </section>

    <section>
      <h2>4. When information is shared</h2>
      <p>
        We share information only as needed to provide the service, follow your instructions,
        protect Schedra and its users, or comply with law. Recipients can include:
      </p>
      <ul>
        <li>The host, guest and invited attendees involved in a booking.</li>
        <li>Members of a team, according to their role and the team features they use.</li>
        <li>Google and Zoom when a user connects and uses those integrations.</li>
        <li>
          Infrastructure, database, analytics, email-delivery and payment providers acting for
          Schedra, including Microsoft Clarity for usage analytics.
        </li>
        <li>Authorities or professional advisers where disclosure is legally required or necessary to protect rights and safety.</li>
      </ul>
      <p>
        Providers are given only the information required for their function and are expected to
        protect it under contract and applicable law.
      </p>
    </section>

    <section>
      <h2>5. Retention and deletion</h2>
      <p>
        Account and scheduling data is kept while the account is active. Operational security logs,
        delivery records, completed booking records and billing records may be retained for a limited
        period where needed for security, support, accounting, dispute resolution or legal compliance.
      </p>
      <p>
        Disconnecting Google Calendar or Zoom revokes the connection and removes the encrypted
        credentials stored by Schedra. Zoom’s deauthorization event also removes the related local
        meeting mappings and join links. Deleting a Schedra account removes the account’s booking
        links, schedules, bookings and connected-service credentials, subject to records we must
        retain by law and short-lived infrastructure backups that expire through their normal cycle.
      </p>
      <p>
        Team owners must transfer ownership or archive their teams before deleting their account so
        a team cannot be left without an owner.
      </p>
    </section>

    <section>
      <h2>6. Your choices and rights</h2>
      <p>
        You can update profile and scheduling information, disconnect integrations, export your data,
        or delete your account from Settings. Depending on where you live, you may also have rights to
        access, correct, delete, restrict or object to processing, or receive a portable copy of your data.
      </p>
      <p>
        Send a request to <a href="mailto:support@schedra.xyz">support@schedra.xyz</a> from the
        email address associated with your account. We may need to verify your identity before acting.
      </p>
      <p>
        You can allow, decline or withdraw Microsoft Clarity analytics permission at any time using
        the <strong>Privacy choices</strong> control shown on Schedra. Your choice is saved in your
        browser. Declining analytics prevents Clarity cookies and limits collection to cookieless,
        page-level measurements.
      </p>
    </section>

    <section>
      <h2>7. Security and international processing</h2>
      <p>
        Schedra uses access controls, encrypted transport, encrypted integration credentials,
        request validation, rate limiting and database constraints designed to protect personal
        information. No online service can guarantee absolute security, so please use a unique,
        strong password and contact us if you believe your account is at risk.
      </p>
      <p>
        Schedra and its providers may process information in countries other than your own. Where
        required, we use contractual and legal safeguards for those transfers.
      </p>
    </section>

    <section>
      <h2>8. Children and changes to this policy</h2>
      <p>
        Schedra is not directed to children under 16, and we do not knowingly collect account data
        from them. If you believe a child has provided information, contact us so we can investigate.
      </p>
      <p>
        We may update this policy as Schedra changes. We will publish the revised policy with a new
        effective date and provide additional notice when a change materially affects your rights.
      </p>
    </section>
  </PublicDocument>
</template>
