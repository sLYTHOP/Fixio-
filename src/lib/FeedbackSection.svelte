<script>
  import { submitUserFeedback } from './supabase.js'

  export let user = null

  let message = ''
  let saving = false
  let submitted = false
  let errorMessage = ''

  async function submitFeedback() {
    const trimmedMessage = message.trim()
    if (!user?.id || !user.email || !trimmedMessage || saving) return

    saving = true
    submitted = false
    errorMessage = ''

    const { error } = await submitUserFeedback({
      userId: user.id,
      email: user.email,
      message: trimmedMessage,
    })

    saving = false
    if (error) {
      console.error('[FeedbackSection] failed to save feedback', error)
      errorMessage = "We couldn't save your feedback. Please try again."
      return
    }

    message = ''
    submitted = true
  }
</script>

<section class="mx-auto mt-12 w-full max-w-7xl border-t px-6 py-12" style="border-color: var(--line);">
  <div class="mx-auto max-w-3xl">
    <h2 class="font-display text-2xl font-bold">Leave your feedback</h2>
    <form class="mt-5" on:submit|preventDefault={submitFeedback}>
      <label class="sr-only" for="user-feedback">Leave your feedback</label>
      <textarea
        id="user-feedback"
        bind:value={message}
        maxlength="2000"
        rows="4"
        placeholder="Tell us what you think..."
        class="w-full resize-y rounded-xl border px-4 py-3 text-sm outline-none transition-colors focus:border-[var(--lime)]"
        style="border-color: var(--line); background: var(--surface); color: var(--ink);"
      ></textarea>
      <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
        {#if !user?.email}
          <p class="text-sm" style="color: var(--ink-soft);">Sign in to submit feedback.</p>
        {:else}
          <p class="text-sm" style="color: var(--ink-soft);">Submitted as {user.email}</p>
        {/if}
        <button
          type="submit"
          disabled={!user?.email || !message.trim() || saving}
          class="rounded-full px-5 py-2.5 text-sm font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          style="background: var(--lime); color: var(--paper);"
        >
          {saving ? 'Submitting...' : 'Submit feedback'}
        </button>
      </div>
      {#if submitted}
        <p class="mt-3 text-sm" role="status" style="color: var(--lime);">Thanks for your feedback!</p>
      {/if}
      {#if errorMessage}
        <p class="mt-3 text-sm" role="alert" style="color: var(--coral);">{errorMessage}</p>
      {/if}
    </form>
  </div>
</section>
