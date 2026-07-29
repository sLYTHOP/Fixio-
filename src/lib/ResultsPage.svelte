<script>
  import { onMount, onDestroy } from 'svelte'
  import { uploadResume } from './supabase.js'
  import { getPendingResume, getPendingMeta, clearPendingResume } from './pendingResume.js'
  import { trackEvent } from './analytics.js'

  export let user

  let stage = 'uploading' // uploading -> processing -> done -> error
  let uploadError = ''
  let roleMeta = null
  let waitlistClicked = false

  const phrases = [
    "Alright, let's see what we've got here...",
    "Reading through your projects...",
    "Good stuff — checking this against the role...",
    "Almost there, putting your feedback together...",
  ]
  let phraseIndex = 0
  let phraseTimer

  const firstName = (user?.user_metadata?.full_name || user?.email || '').split(' ')[0]

  // Placeholder feedback until the real analysis (LLM) is wired up.
  const mockFeedback = {
    strengths: ['React ✓', 'Git ✓', 'Team project experience ✓'],
    gaps: ['SQL — most roles expect at least basic querying', 'No cloud platform experience (AWS/GCP/Azure)'],
    suggestions: ['AWS Cloud Practitioner (free learning path)', 'A small project using SQL + a public dataset'],
  }

  onMount(async () => {
    const file = getPendingResume()
    roleMeta = getPendingMeta()
    if (!file) {
      stage = 'error'
      uploadError = "We couldn't find your resume — please upload it again."
      return
    }

    const { error } = await uploadResume(user.id, file)
    clearPendingResume()

    if (error) {
      stage = 'error'
      uploadError = 'Upload failed. Please try again.'
      console.error(error)
      return
    }

    trackEvent('resume_uploaded_success')
    stage = 'processing'
    phraseTimer = setInterval(() => {
      phraseIndex = (phraseIndex + 1) % phrases.length
    }, 1400)

    setTimeout(() => {
      clearInterval(phraseTimer)
      stage = 'done'
      trackEvent('feedback_shown_mock')
    }, phrases.length * 1400)
  })

  onDestroy(() => clearInterval(phraseTimer))
</script>

<section class="min-h-screen flex items-center justify-center px-6 py-32">
  <div class="max-w-lg w-full text-center">
    {#if stage === 'uploading'}
      <p class="font-display text-2xl font-semibold">Uploading your resume...</p>

    {:else if stage === 'processing'}
      <p class="font-display text-2xl font-semibold">{phrases[phraseIndex]}</p>
      <div class="mt-6 flex justify-center gap-1.5">
        {#each phrases as _, i}
          <span
            class="w-2 h-2 rounded-full transition-colors"
            style="background: {i === phraseIndex ? 'var(--indigo)' : 'var(--line)'};"
          ></span>
        {/each}
      </div>

    {:else if stage === 'done'}
      <h1 class="font-display text-3xl font-bold tracking-tight">
        Alright {firstName}, here's how you match up{roleMeta?.role ? ` for ${roleMeta.role}` : ''}
      </h1>
      <p class="mt-2 text-sm" style="color: var(--ink-soft);">
        This is a preview layout — real AI-generated feedback is coming soon.
      </p>

      <div class="mt-8 text-left rounded-2xl border p-6" style="border-color: var(--line);">
        <p class="font-display font-semibold">Your experience looks solid on:</p>
        <div class="mt-3 flex flex-wrap gap-2">
          {#each mockFeedback.strengths as s}
            <span class="text-xs font-semibold px-2.5 py-1 rounded-full" style="background: color-mix(in srgb, var(--lime) 55%, white);">{s}</span>
          {/each}
        </div>

        <p class="font-display font-semibold mt-6">Here's what's missing:</p>
        <ul class="mt-3 space-y-2 text-sm" style="color: var(--ink-soft);">
          {#each mockFeedback.gaps as g}
            <li>• {g}</li>
          {/each}
        </ul>

        <p class="font-display font-semibold mt-6">Worth looking into:</p>
        <ul class="mt-3 space-y-2 text-sm" style="color: var(--ink-soft);">
          {#each mockFeedback.suggestions as s}
            <li>• {s}</li>
          {/each}
        </ul>
      </div>

      <div class="mt-6 rounded-2xl p-6 text-center" style="background: var(--ink); color: var(--paper);">
        <p class="font-display font-semibold">Want a step-by-step plan to close these gaps?</p>
        <p class="mt-1 text-sm opacity-80">Courses, certifications, and projects — prioritized for you.</p>
        <button
          on:click={() => { waitlistClicked = true; trackEvent('roadmap_interest_clicked', { role: roleMeta?.role }) }}
          disabled={waitlistClicked}
          class="mt-4 font-display font-semibold text-sm px-6 py-3 rounded-full transition-transform hover:-translate-y-0.5 disabled:opacity-60"
          style="background: var(--lime); color: var(--ink);"
        >
          {waitlistClicked ? "You're on the list!" : 'Join the waitlist'}
        </button>
      </div>

    {:else if stage === 'error'}
      <p class="font-display text-xl font-semibold" style="color: var(--coral);">{uploadError}</p>
    {/if}
  </div>
</section>
