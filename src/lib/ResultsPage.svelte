<script>
  import { onMount, onDestroy, tick } from 'svelte'
  import { ArrowLeft, House } from '@lucide/svelte'
  import { uploadResume, downloadResume, getLatestFeedback, supabase, joinWaitlist } from './supabase.js'
  import { getPendingResume, getPendingMeta, clearPendingResume } from './pendingResume.js'
  import { trackEvent } from './analytics.js'
  import ResumePreview from './ResumePreview.svelte'

  export let user
  export let onHome = () => {}
  export let onRetry = () => {}
  export let onHelp = () => {}
  export let onTourReady = () => {}
  export let onSignOut = () => {}

  let stage = 'loading' // loading -> uploading -> processing -> done -> error
  let uploadError = ''
  let roleMeta = null
  let resumeFile = null
  let activeIssue = null
  let paymentPageOpen = false
  let purchaseClicked = false
  let interestSaving = false
  let interestSaved = false
  let interestError = ''
  let feedback = null // real result from analyze-resume: { strengths, gaps, suggestions, vagueBullets }

  function openPaymentPage() {
    paymentPageOpen = true
    purchaseClicked = false
    trackEvent('roadmap_checkout_viewed', { role: roleMeta?.role, source: 'results_page' })
  }

  function recordStudentPurchaseClick() {
    purchaseClicked = true
    interestSaved = false
    interestError = ''
    trackEvent('roadmap_purchase_clicked', {
      plan: 'student',
      price_inr: 199,
      role: roleMeta?.role,
      source: 'roadmap_checkout',
    })
  }

  function handlePurchaseDialogKeydown(event) {
    if (event.key === 'Escape' && purchaseClicked) {
      event.stopPropagation()
      purchaseClicked = false
    }
  }

  async function registerStudentInterest() {
    if (interestSaving || interestSaved) return
    if (!user?.email) {
      interestError = "We couldn't find an email address for your account. Please try another Google account."
      return
    }

    interestSaving = true
    interestError = ''

    const { error } = await joinWaitlist({
      email: user.email,
      role: roleMeta?.role,
      source: 'roadmap_purchase_interest',
      userId: user.id,
    })

    interestSaving = false
    if (error) {
      console.error('[ResultsPage] failed to save roadmap purchase interest', error)
      interestError = "We couldn't save your interest. Please try again."
      return
    }

    interestSaved = true
    trackEvent('roadmap_purchase_interest_confirmed', {
      plan: 'student',
      price_inr: 199,
      role: roleMeta?.role,
      source: 'roadmap_checkout',
    })
  }

  function trackCollegeContact() {
    trackEvent('roadmap_plan_selected', { plan: 'college', role: roleMeta?.role })
  }

  const phrases = [
    "Alright, let's see what we've got here...",
    "Reading through your projects...",
    "Good stuff — checking this against the role...",
    "Almost there, putting your feedback together...",
  ]
  let phraseIndex = 0
  let phraseTimer

  const firstName = (user?.user_metadata?.full_name || user?.email || '').split(' ')[0]

  const errorMessages = {
    no_knowledge_base: "We don't have validated feedback for this role yet.",
    file_not_found: "We couldn't find your uploaded resume. Please try again.",
    unsupported_file_type: 'Please upload your resume as a PDF file.',
    llm_error: 'Something went wrong generating your feedback. Please try again in a moment.',
    llm_empty: 'The AI returned an empty answer. Please try again.',
    parse_error: 'Something went wrong reading your feedback. Please try again.',
    unexpected_error: 'Something unexpected went wrong. Please try again.',
    unauthorized: 'Please log in again and retry.',
    forbidden: 'Something went wrong with your upload. Please try again.',
    rate_limited: "You've hit today's limit of resume scans. Please come back tomorrow.",
    feedback_save_error: "Your feedback was generated but couldn't be saved. Please try again.",
  }

  onMount(async () => {
    const file = getPendingResume()
    roleMeta = getPendingMeta()
    if (!file) {
      const { data: savedFeedback, error: feedbackError } = await getLatestFeedback(user.id)
      if (feedbackError) {
        stage = 'error'
        uploadError = "We couldn't load your saved feedback. Please try again."
        console.error('[ResultsPage] failed to load saved feedback', feedbackError)
        return
      }
      if (!savedFeedback) {
        onHome()
        return
      }

      const { data: savedResume, error: resumeError } = await downloadResume(savedFeedback.resume_path)
      if (resumeError || !savedResume) {
        stage = 'error'
        uploadError = "We couldn't load the resume for your saved feedback. Please upload it again."
        console.error('[ResultsPage] failed to download saved resume', resumeError)
        return
      }

      const resumeName = savedFeedback.resume_path.split('/').pop() || 'resume.pdf'
      resumeFile = new File([savedResume], resumeName, { type: savedResume.type || 'application/pdf' })
      roleMeta = { role: savedFeedback.role, level: savedFeedback.level }
      if (!Array.isArray(savedFeedback.result?.issues)) {
        stage = 'error'
        uploadError = 'Your saved feedback could not be displayed. Please upload your resume for a new analysis.'
        console.error('[ResultsPage] saved analysis is missing structured issues', savedFeedback.result)
        return
      }
      feedback = savedFeedback.result
      stage = 'done'
      await tick()
      onTourReady()
      return
    }

    resumeFile = file
    stage = 'uploading'
    const { data: uploadData, error: uploadErr } = await uploadResume(user.id, file)
    clearPendingResume()

    if (uploadErr || !uploadData?.path) {
      stage = 'error'
      uploadError = 'Upload failed. Please try again.'
      console.error(uploadErr)
      return
    }

    trackEvent('resume_uploaded_success')
    stage = 'processing'
    phraseTimer = setInterval(() => {
      phraseIndex = (phraseIndex + 1) % phrases.length
    }, 3200)

    const { data, error: fnError } = await supabase.functions.invoke('analyze-resume', {
      body: { role: roleMeta?.role, level: roleMeta?.level, resumePath: uploadData.path },
    })

    clearInterval(phraseTimer)

    if (fnError || !data?.ok) {
      stage = 'error'
      uploadError = errorMessages[data?.reason] || 'Something went wrong. Please try again.'
      console.error(fnError || data)
      trackEvent('feedback_failed', { reason: data?.reason || 'invoke_error' })
      return
    }

    if (!Array.isArray(data.result?.issues)) {
      stage = 'error'
      uploadError = 'Resume feedback could not be displayed because the analysis service needs an update. Please try again later.'
      console.error('[ResultsPage] analysis response is missing structured issues', data.result)
      trackEvent('feedback_failed', { reason: 'missing_structured_issues' })
      return
    }

    feedback = data.result
    stage = 'done'
    await tick()
    onTourReady()
    trackEvent('feedback_shown', { role: roleMeta?.role })
  })

  onDestroy(() => clearInterval(phraseTimer))
</script>

<svelte:window on:keydown={handlePurchaseDialogKeydown} />

<section class="relative min-h-screen px-6 {stage === 'loading' || stage === 'uploading' || stage === 'processing' || stage === 'error' ? 'flex items-center justify-center py-6' : 'py-32'}">
  <div class="absolute inset-x-6 top-6 flex flex-wrap items-center justify-between gap-3">
    <button
      type="button"
      on:click={onHome}
      class="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors hover:bg-[var(--surface-2)]"
      style="border-color: var(--line); background: var(--surface); color: var(--ink);"
    >
      <House size={16} strokeWidth={2} aria-hidden="true" />
      Back to home
    </button>
    <div class="flex items-center gap-3">
      {#if stage === 'done'}
        <button
          type="button"
          on:click={onHelp}
          class="rounded-full border px-4 py-2 text-sm font-semibold transition-colors hover:bg-[var(--surface-2)]"
          style="border-color: var(--line); background: var(--surface); color: var(--ink);"
          aria-label="Restart product tour"
        >
          Take a tour
        </button>
      {/if}
      <button
        type="button"
        on:click={onSignOut}
        class="rounded-full border px-4 py-2 text-sm font-semibold transition-colors hover:bg-[var(--surface-2)]"
        style="border-color: var(--line); background: var(--surface); color: var(--ink);"
      >
        Sign out
      </button>
    </div>
  </div>

  {#if stage === 'loading' || stage === 'uploading' || stage === 'processing' || stage === 'error'}
    <div class="flex w-full items-center justify-center">
      <div class="max-w-lg w-full text-center">
        {#if stage === 'loading'}
          <p class="font-display text-2xl font-semibold">Loading your recent analysis...</p>

        {:else if stage === 'uploading'}
          <p class="font-display text-2xl font-semibold">Uploading your resume...</p>

        {:else if stage === 'processing'}
          <p class="font-display text-2xl font-semibold">{phrases[phraseIndex]}</p>
          <div class="mt-6 flex justify-center gap-1.5">
            {#each phrases as _, i}
              <span
                class="w-2 h-2 rounded-full transition-colors"
                style="background: {i === phraseIndex ? 'var(--lime)' : 'var(--line)'};"
              ></span>
            {/each}
          </div>

        {:else if stage === 'error'}
          <p class="font-display text-xl font-semibold" style="color: var(--coral);">{uploadError}</p>
          <button
            type="button"
            on:click={onRetry}
            class="mt-6 rounded-full px-6 py-3 text-sm font-semibold transition-transform hover:-translate-y-0.5"
            style="background: var(--lime); color: var(--paper);"
          >
            Upload another resume
          </button>
        {/if}
      </div>
    </div>

  {:else if stage === 'done'}
    {#if paymentPageOpen}
      <div class="max-w-7xl mx-auto">
        <div class="mx-auto max-w-4xl pt-10">
          <button
            type="button"
            on:click={() => (paymentPageOpen = false)}
            class="mb-8 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition-colors hover:bg-[var(--surface-2)]"
            style="border-color: var(--line); background: var(--surface); color: var(--ink);"
          >
            <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />
            Back to your results
          </button>

          <div>
            <p class="text-xs font-semibold uppercase tracking-[0.18em]" style="color: var(--lime);">Fixio Roadmap</p>
            <h1 class="mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl">Checkout</h1>
            <p class="mt-2 text-sm leading-relaxed" style="color: var(--ink-soft);">
              Choose the roadmap that fits you.
            </p>
          </div>

          <div class="mt-8 grid gap-5 md:grid-cols-2">
            <section class="flex flex-col rounded-2xl border p-6 sm:p-8" style="border-color: var(--lime); background: var(--surface);">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <p class="text-xs font-semibold uppercase tracking-wide" style="color: var(--lime);">For students</p>
                  <h2 class="mt-2 font-display text-2xl font-bold">Portfolio Roadmap</h2>
                </div>
              </div>

              <div class="mt-6 flex items-baseline gap-2">
                <span class="font-display text-4xl font-extrabold">₹199</span>
                <span class="text-sm" style="color: var(--ink-soft);">INR</span>
              </div>
              <p class="mt-3 text-sm leading-relaxed" style="color: var(--ink-soft);">
                A prioritised roadmap to help you build a strong portfolio and improve your chances of getting more interviews.
              </p>
              <div class="mt-5 rounded-xl border p-4" style="border-color: var(--line); background: var(--paper);">
                <p class="text-xs font-semibold uppercase tracking-wide" style="color: var(--ink-soft);">Order summary</p>
                <div class="mt-3 flex items-center justify-between gap-3 text-sm">
                  <span>Student Portfolio Roadmap</span>
                  <span class="font-semibold">₹199</span>
                </div>
                {#if user?.email}
                  <div class="mt-3 border-t pt-3 text-xs" style="border-color: var(--line); color: var(--ink-soft);">
                    Account: {user.email}
                  </div>
                {/if}
              </div>

              <ul class="mt-6 flex-1 space-y-3 text-sm">
                <li class="flex gap-2"><span style="color: var(--lime);" aria-hidden="true">✓</span>Personalised learning priorities</li>
                <li class="flex gap-2"><span style="color: var(--lime);" aria-hidden="true">✓</span>Portfolio-building project guidance</li>
                <li class="flex gap-2"><span style="color: var(--lime);" aria-hidden="true">✓</span>Recommendations matched to your target role</li>
              </ul>

              <button
                type="button"
                on:click={recordStudentPurchaseClick}
                class="mt-8 w-full rounded-full px-6 py-3 font-display text-sm font-semibold transition-transform hover:-translate-y-0.5"
                style="background: var(--lime); color: var(--paper);"
              >
                Buy for ₹199
              </button>
            </section>

            <section class="flex flex-col rounded-2xl border p-6 sm:p-8" style="border-color: var(--line); background: var(--surface);">
              <p class="text-xs font-semibold uppercase tracking-wide" style="color: var(--indigo);">For colleges</p>
              <h2 class="mt-2 font-display text-2xl font-bold">Campus Plan</h2>
              <div class="mt-6">
                <span class="font-display text-2xl font-bold">Custom pricing</span>
              </div>
              <p class="mt-3 text-sm leading-relaxed" style="color: var(--ink-soft);">
                Help your students build stronger portfolios with role-focused roadmaps at scale.
              </p>

              <ul class="mt-6 flex-1 space-y-3 text-sm">
                <li class="flex gap-2"><span style="color: var(--indigo);" aria-hidden="true">✓</span>Roadmaps for your student community</li>
                <li class="flex gap-2"><span style="color: var(--indigo);" aria-hidden="true">✓</span>Designed around career-ready skills</li>
                <li class="flex gap-2"><span style="color: var(--indigo);" aria-hidden="true">✓</span>Talk with us about your requirements</li>
              </ul>

              <a
                href="mailto:samuelfernandis25@gmail.com?subject=Fixio%20college%20roadmap%20pricing"
                on:click={trackCollegeContact}
                class="mt-8 block w-full rounded-full border px-6 py-3 text-center font-display text-sm font-semibold transition-colors hover:bg-[var(--surface-2)]"
                style="border-color: var(--line); color: var(--ink);"
              >
                Contact us for pricing
              </a>
            </section>
          </div>

          {#if purchaseClicked}
            <div
              class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 py-4 sm:items-center sm:px-6 sm:py-6"
              style="background: color-mix(in srgb, var(--ink) 45%, transparent);"
              on:click={() => (purchaseClicked = false)}
              role="presentation"
            >
              <div
                class="relative my-auto w-full max-w-md rounded-2xl border p-6 shadow-2xl sm:p-8"
                on:click|stopPropagation
                on:keydown={handlePurchaseDialogKeydown}
                role="dialog"
                tabindex="-1"
                aria-modal="true"
                aria-labelledby="roadmap-interest-title"
                style="border-color: var(--line); background: var(--surface); color: var(--ink);"
              >
                <button
                  type="button"
                  on:click={() => (purchaseClicked = false)}
                  aria-label="Close"
                  class="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold hover:bg-[var(--surface-2)]"
                >
                  ✕
                </button>

                {#if interestSaved}
                  <h2 id="roadmap-interest-title" class="pr-8 font-display text-2xl font-bold">Thanks for your interest!</h2>
                  <p class="mt-3 text-sm leading-relaxed" role="status" style="color: var(--ink-soft);">
                    We’ll let you know when the roadmap is ready.
                  </p>
                {:else}
                  <h2 id="roadmap-interest-title" class="pr-8 font-display text-2xl font-bold">Coming soon</h2>
                  <p class="mt-3 text-sm leading-relaxed" style="color: var(--ink-soft);">
                    We’re working on this feature. Good to know you’re interested in buying our product. Click “Interested” and we’ll let you know when it’s ready.
                  </p>
                  <button
                    type="button"
                    on:click={registerStudentInterest}
                    disabled={interestSaving}
                    class="mt-6 w-full rounded-full px-5 py-3 font-display text-sm font-semibold transition-transform hover:-translate-y-0.5 disabled:opacity-60"
                    style="background: var(--lime); color: var(--paper);"
                  >
                    {interestSaving ? 'Saving...' : 'Interested'}
                  </button>
                {/if}
                {#if interestError}
                  <p class="mt-3 text-sm" role="alert" style="color: var(--coral);">{interestError}</p>
                {/if}
              </div>
            </div>
          {/if}

        </div>
      </div>
    {:else}
      <div class="max-w-7xl mx-auto">
      <h1 class="font-display text-3xl font-bold tracking-tight">
        Alright {firstName}, here's how you match up{roleMeta?.role ? ` for ${roleMeta.role}` : ''}
      </h1>
      <p class="mt-2 text-sm" style="color: var(--ink-soft);">
        Review the marked sections of your resume, then use the solutions to decide what to improve.
      </p>

      <div class="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <div class="space-y-6">
          <ResumePreview file={resumeFile} issues={feedback.issues} bind:activeIssue />

          {#if feedback.strengths.length}
            <section data-tour="strengths" class="rounded-2xl border p-6" style="border-color: var(--line); background: var(--surface);">
              <h2 class="font-display font-semibold">What your resume already shows well</h2>
              <div class="mt-3 flex flex-wrap gap-2">
                {#each feedback.strengths as strength}
                  <span class="rounded-full px-2.5 py-1 text-xs font-semibold" style="background: var(--lime-tint); color: var(--lime);">
                    {strength}
                  </span>
                {/each}
              </div>
            </section>
          {/if}
        </div>

        <div class="space-y-6">
          <section data-tour="issues" class="rounded-2xl border p-5 sm:p-6" style="border-color: var(--line); background: var(--surface);">
            <div class="flex items-start justify-between gap-3">
              <div>
                <h2 class="font-display text-xl font-semibold">Issues found</h2>
                <p class="mt-1 text-sm" style="color: var(--ink-soft);">
                  Select an issue to locate it in your resume.
                </p>
              </div>
              <span class="shrink-0 rounded-full px-2.5 py-1 text-xs font-bold" style="background: var(--coral-tint); color: var(--coral);">
                {feedback.issues.length}
              </span>
            </div>

            {#if feedback.issues.length}
              <div class="mt-5 space-y-3">
                {#each feedback.issues as issue, i}
                  <button
                    type="button"
                    aria-pressed={activeIssue === i}
                    on:click={() => (activeIssue = activeIssue === i ? null : i)}
                    class="w-full rounded-xl border p-4 text-left transition-colors"
                    style="border-color: {activeIssue === i ? 'var(--lime)' : 'var(--line)'};
                           background: {activeIssue === i ? 'var(--surface-2)' : 'transparent'};"
                  >
                    <span class="text-xs font-semibold uppercase tracking-wide" style="color: var(--coral);">
                      {issue.section}
                    </span>
                    <span class="mt-1 block text-sm font-semibold">{issue.issue}</span>
                  </button>
                {/each}
              </div>
            {:else}
              <p class="mt-5 rounded-xl p-4 text-sm" style="background: var(--surface-2); color: var(--ink-soft);">
                No specific issues were identified for this resume.
              </p>
            {/if}
          </section>

          {#if feedback.suggestions.length || feedback.issues.length}
            <section data-tour="next-steps" class="rounded-2xl border p-5 sm:p-6" style="border-color: var(--line); background: var(--surface);">
              <h2 class="font-display font-semibold" style="color: var(--lime);">Suggested next steps</h2>
              <ul class="mt-3 space-y-2 text-sm leading-relaxed" style="color: var(--ink-soft);">
                {#each feedback.suggestions as suggestion}
                  <li>• {suggestion}</li>
                {/each}
                {#each feedback.issues as issue}
                  <li>• {issue.solution}</li>
                {/each}
              </ul>
            </section>
          {/if}

          <div data-tour="roadmap" class="rounded-2xl p-6 text-center" style="background: var(--ink); color: var(--paper);">
            <p class="font-display font-semibold">Want to close these skill gaps?</p>
            <p class="mt-1 text-sm opacity-80">Get a personalised roadmap of courses, certifications, and projects, prioritised to help you prepare for your target role.</p>
            <button
              type="button"
              on:click={openPaymentPage}
              class="mt-4 rounded-full px-6 py-3 font-display text-sm font-semibold transition-transform hover:-translate-y-0.5"
              style="background: var(--lime); color: var(--paper);"
            >
              Get My Roadmap
            </button>
          </div>

          <div class="rounded-2xl border p-6" style="border-color: var(--line); background: var(--surface);">
            <p class="text-xs font-semibold uppercase tracking-wide" style="color: var(--ink-soft);">Snapshot</p>
            {#if roleMeta?.role}
              <div class="mt-4">
                <p class="text-xs" style="color: var(--ink-soft);">Target role</p>
                <p class="mt-0.5 font-display font-semibold">{roleMeta.role}</p>
              </div>
            {/if}
            {#if roleMeta?.level}
              <div class="mt-4">
                <p class="text-xs" style="color: var(--ink-soft);">Profile</p>
                <p class="mt-0.5 font-semibold capitalize">{roleMeta.level === 'fresher' ? 'Fresher' : 'Career switcher'}</p>
              </div>
            {/if}
          </div>
        </div>
      </div>
      </div>
    {/if}
  {/if}
</section>
