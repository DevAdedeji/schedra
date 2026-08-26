<script setup lang="ts">
definePageMeta({ layout: 'default' })

useSeoMeta({
  title: 'Terms of service',
  description: 'The terms that apply when you use Schedra scheduling and team services.'
})
</script>

<template>
  <PublicDocument
    eyebrow="Legal"
    title="Terms built for clear expectations."
    summary="These terms describe the rules for using Schedra, paid team plans and connected services."
    updated="26 August 2026"
  >
    <section>
      <h2>1. Agreement</h2>
      <p>
        By creating an account, joining a team or using Schedra, you agree to these Terms and our
        <NuxtLink to="/privacy">Privacy Policy</NuxtLink>. If you use Schedra for an organization,
        you confirm that you can accept these Terms for that organization. You must be at least 16
        and legally able to enter into this agreement.
      </p>
    </section>

    <section>
      <h2>2. Accounts and teams</h2>
      <p>
        You must provide accurate account information, protect your sign-in credentials and tell us
        promptly about unauthorized access. You are responsible for activity under your account.
      </p>
      <p>
        Team owners and administrators control team membership, roles, shared event types and billing.
        Invitations do not create a paid seat until accepted. A team owner must transfer ownership or
        archive the team before deleting their personal account.
      </p>
    </section>

    <section>
      <h2>3. Scheduling responsibilities</h2>
      <p>
        You control your availability, booking questions, meeting locations and connected services.
        You are responsible for making sure those settings are accurate and that you have a lawful
        reason to collect any information you request from guests.
      </p>
      <p>
        Guests are responsible for the accuracy of information supplied in a booking. Schedra provides
        scheduling tools but is not a party to meetings, services, sales or other arrangements between
        hosts and guests.
      </p>
    </section>

    <section>
      <h2>4. Connected services</h2>
      <p>
        Google, Zoom, payment providers and other integrations are separate services governed by their
        own terms. You authorize Schedra to exchange the information and take the actions needed to
        operate an integration you connect. You can revoke that access from Schedra or the provider.
      </p>
      <p>
        We are not responsible for an external provider’s availability, changes, suspension or handling
        of information after it receives data at your direction.
      </p>
    </section>

    <section>
      <h2>5. Paid team plans</h2>
      <p>
        Personal scheduling is free unless the pricing page says otherwise. Paid team plans are charged
        for members who have joined, using the billing period and currency shown at checkout. Pending
        invitations are not billed.
      </p>
      <p>
        Card subscriptions renew automatically unless cancelled before renewal. Bank-transfer plans do
        not renew silently and require payment for each period. Taxes, currency conversion and provider
        fees may apply where disclosed. Failed or overdue payments can place team features into a grace
        period or read-only state, but do not immediately delete team data.
      </p>
    </section>

    <section>
      <h2>6. Acceptable use</h2>
      <p>You may not use Schedra to:</p>
      <ul>
        <li>Break the law, violate another person’s rights or facilitate fraud or abuse.</li>
        <li>Send spam, harassment, malware or deceptive booking invitations.</li>
        <li>Probe, bypass or interfere with authentication, rate limits or security controls.</li>
        <li>Access another person’s account or data without authorization.</li>
        <li>Scrape, overload, reverse engineer or resell the service except where law expressly permits it.</li>
      </ul>
      <p>
        We may restrict or suspend use that creates risk to Schedra, its providers or other users.
      </p>
    </section>

    <section>
      <h2>7. Ownership</h2>
      <p>
        You keep ownership of content you submit. You give Schedra a limited permission to host,
        process, reproduce and transmit that content only as needed to provide, secure and improve the
        service. Schedra and its licensors retain rights in the software, design, trademarks and service.
      </p>
    </section>

    <section>
      <h2>8. Availability, warranties and liability</h2>
      <p>
        We work to keep Schedra reliable, but scheduling, email, internet, calendar, video and payment
        services can fail or be delayed. The service is provided “as is” and “as available” to the extent
        the law permits, without warranties that it will always be uninterrupted or error-free.
      </p>
      <p>
        To the maximum extent permitted by law, Schedra is not liable for indirect, special, incidental,
        consequential or punitive loss, or lost profits, revenue, data or goodwill. Schedra’s total
        liability for a claim will not exceed the amount you paid Schedra for the service during the
        twelve months before the event giving rise to the claim. Nothing in these Terms excludes liability
        that cannot legally be excluded.
      </p>
    </section>

    <section>
      <h2>9. Ending use</h2>
      <p>
        You can disconnect integrations or delete your account from Settings. Team owners must first
        transfer ownership or archive their team. We may suspend or end access for a serious breach,
        security risk, legal requirement or non-payment, and will provide notice when reasonably possible.
      </p>
      <p>
        Sections that by their nature should continue after termination, including payment, ownership,
        warranty, liability and dispute provisions, will remain in effect.
      </p>
    </section>

    <section>
      <h2>10. Changes and contact</h2>
      <p>
        We may update these Terms as the service changes. We will publish the revised version with a new
        effective date and provide additional notice for material changes. Continued use after the change
        takes effect means you accept the updated Terms.
      </p>
      <p>
        Questions can be sent to <a href="mailto:support@schedra.xyz">support@schedra.xyz</a>.
        Applicable mandatory consumer protections and conflict-of-law rules remain unaffected.
      </p>
    </section>
  </PublicDocument>
</template>
