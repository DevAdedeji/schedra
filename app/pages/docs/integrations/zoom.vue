<script setup lang="ts">
definePageMeta({ layout: 'default' })

useSeoMeta({
  title: 'Zoom integration guide',
  description: 'How to connect Zoom to Schedra, create meeting links and remove access.'
})
</script>

<template>
  <PublicDocument
    eyebrow="Integration guide"
    title="Use Zoom for Schedra bookings."
    summary="Connect your Zoom account once, choose Zoom on an event type and let Schedra keep the meeting synchronized with the booking."
    updated="26 August 2026"
  >
    <section>
      <h2>What the integration does</h2>
      <p>
        When a confirmed booking uses Zoom as its location, Schedra creates one scheduled Zoom
        meeting in the organizer’s connected account and shares the protected join link with the
        host and invited guests. Rescheduling updates that meeting. Cancelling removes it while the
        Zoom connection remains active.
      </p>
      <p>
        Schedra does not access meeting audio, video, chat, recordings, transcripts, participant
        activity or analytics.
      </p>
    </section>

    <section>
      <h2>Before you connect</h2>
      <ul>
        <li>You need an active Schedra account and a Zoom account that can schedule meetings.</li>
        <li>Your Schedra account must be able to open the Integrations page.</li>
        <li>For a team event, the event organizer must have Zoom connected.</li>
      </ul>
    </section>

    <section>
      <h2>Connect Zoom</h2>
      <ol>
        <li>Sign in to Schedra and open <NuxtLink to="/integrations">Integrations</NuxtLink>.</li>
        <li>Select <strong>Connect</strong> on the Zoom card.</li>
        <li>Sign in to Zoom, review the requested permissions and authorize Schedra.</li>
        <li>Return to Schedra and confirm that the Zoom card shows <strong>Connected</strong>.</li>
        <li>Create or edit an event type and choose <strong>Zoom</strong> as its location.</li>
      </ol>
    </section>

    <section>
      <h2>Permissions Schedra requests</h2>
      <ul>
        <li><code>user:read:user</code> identifies the Zoom account you authorized.</li>
        <li><code>meeting:write:meeting</code> creates a scheduled meeting for a confirmed booking.</li>
        <li><code>meeting:update:meeting</code> keeps the same meeting current after rescheduling.</li>
        <li><code>meeting:delete:meeting</code> removes the meeting after cancellation.</li>
        <li><code>meeting:read:list_meetings</code> reconciles Schedra-created meetings after an interrupted synchronization job and prevents duplicates.</li>
      </ul>
    </section>

    <section>
      <h2>Information sent to Zoom</h2>
      <p>
        Schedra sends the event title, guest name, start time, duration, the event type’s public
        description and a private Schedra booking-management link. A private Schedra marker is added
        so an interrupted job can find the same meeting instead of creating a duplicate.
      </p>
      <p>
        Guest email addresses, additional-guest addresses and answers to booking questions are not
        copied into the Zoom meeting description.
      </p>
    </section>

    <section>
      <h2>Disconnect and remove Schedra</h2>
      <h3>From Schedra</h3>
      <ol>
        <li>Open <NuxtLink to="/integrations">Integrations</NuxtLink>.</li>
        <li>Select <strong>Disconnect</strong> on the Zoom card and confirm.</li>
      </ol>
      <p>
        Schedra asks Zoom to revoke the token and deletes the encrypted Zoom credentials it stores.
        Meetings already created in Zoom are left in place so a disconnect does not unexpectedly
        erase scheduled meetings. Future changes will not synchronize until Zoom is reconnected.
      </p>

      <h3>From Zoom</h3>
      <ol>
        <li>Sign in to the Zoom web portal and open the Zoom App Marketplace.</li>
        <li>Open <strong>Manage</strong>, then <strong>Added Apps</strong>.</li>
        <li>Find Schedra and select <strong>Remove</strong>.</li>
      </ol>
      <p>
        Zoom sends Schedra a signed deauthorization event. Schedra verifies the notification and
        removes the Zoom credentials, Zoom meeting mappings and stored join links associated with
        that connection.
      </p>
    </section>

    <section>
      <h2>Troubleshooting</h2>
      <h3>Zoom is connected but a booking has no meeting link</h3>
      <p>
        Confirm the event type location is Zoom and that the organizer’s Zoom card still shows
        Connected. Retry after a short delay; Schedra processes meeting synchronization through a
        durable job so temporary provider failures can recover without creating duplicate meetings.
      </p>

      <h3>Authorization expired</h3>
      <p>
        Open Integrations, disconnect the existing Zoom entry if present, then connect it again.
        Contact <a href="mailto:support@schedra.xyz">support@schedra.xyz</a> if the error continues.
      </p>

      <h3>A disconnected meeting still exists in Zoom</h3>
      <p>
        This is intentional. Disconnecting access does not delete existing remote meetings. Delete
        the meeting in Zoom if you no longer need it.
      </p>
    </section>

    <section>
      <h2>Privacy and support</h2>
      <p>
        Read the <NuxtLink to="/privacy">Privacy Policy</NuxtLink> for retention, security and data
        rights. For help, visit <NuxtLink to="/support">Support</NuxtLink> or email
        <a href="mailto:support@schedra.xyz">support@schedra.xyz</a>.
      </p>
    </section>
  </PublicDocument>
</template>
