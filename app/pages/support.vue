<script setup lang="ts">
definePageMeta({ layout: 'default' })

useSeoMeta({
  title: 'Support',
  description: 'Get help with Schedra accounts, bookings, billing and integrations.'
})
</script>

<template>
  <PublicDocument
    eyebrow="Support"
    title="Help when scheduling gets complicated."
    summary="Start with the quickest route below. Include what you expected, what happened and when it happened so we can investigate properly."
  >
    <section>
      <h2>Contact support</h2>
      <p>
        Email <a href="mailto:support@schedra.xyz">support@schedra.xyz</a> from the address on
        your Schedra account. For account-specific or billing requests, this helps us verify ownership.
      </p>
      <div class="callout">
        <p><strong>Useful details to include</strong></p>
        <ul>
          <li>The affected booking page or team address.</li>
          <li>The date, time and timezone of the problem.</li>
          <li>The integration involved and the exact error message.</li>
          <li>A screenshot with passwords, tokens and payment details hidden.</li>
        </ul>
      </div>
    </section>

    <section>
      <h2>Zoom integration help</h2>
      <p>
        See the <NuxtLink to="/docs/integrations/zoom">Zoom integration guide</NuxtLink> for
        connection, permissions, meeting creation, disconnection and data-removal steps.
      </p>
      <p>
        If Zoom says authorization has expired, open Schedra’s Integrations page, disconnect Zoom
        if it is still listed, and connect it again. Existing booking records remain in Schedra, but
        future Zoom synchronization requires an active connection.
      </p>
    </section>

    <section>
      <h2>Account and privacy requests</h2>
      <p>
        Profile details can be updated in Settings. The same page lets you export your data or
        permanently delete your account. Connected calendars and Zoom can be revoked from Integrations.
      </p>
      <p>
        For a privacy request, email <a href="mailto:support@schedra.xyz">support@schedra.xyz</a>
        with “Privacy request” in the subject. We may ask you to verify control of the account first.
      </p>
    </section>

    <section>
      <h2>Security reports</h2>
      <p>
        If you believe you found a security issue, do not access other users’ data or disrupt the
        service. Send the affected URL, reproduction steps and potential impact privately to
        <a href="mailto:support@schedra.xyz?subject=Security%20report">support@schedra.xyz</a>.
      </p>
    </section>
  </PublicDocument>
</template>
