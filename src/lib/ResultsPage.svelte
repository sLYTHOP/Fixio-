<script>
  import { onMount, onDestroy, tick } from 'svelte'
  import { fly } from 'svelte/transition'
  import { ArrowLeft, House, Sun, Moon, Check } from '@lucide/svelte'
  import { uploadResume, downloadResume, getLatestFeedback, supabase, joinWaitlist } from './supabase.js'
  import { getPendingResume, getPendingMeta, clearPendingResume, hasPendingResume } from './pendingResume.js'
  import { trackEvent } from './analytics.js'
  import FeedbackSection from './FeedbackSection.svelte'
  import ResumePreview from './ResumePreview.svelte'

  export let user
  export let onHome = () => {}
  export let onRetry = () => {}
  export let onHelp = () => {}
  export let onSignOut = () => {}
  export let onTourReady = () => {}

  let stage = hasPendingResume() ? 'processing' : 'loading' // processing -> done -> error, or loading saved feedback
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
  let resultsTheme = 'dark'

  const reviewColors = [
    { color: 'red', label: 'Fix first' },
    { color: 'orange', label: 'Weak' },
    { color: 'green', label: 'Looks right' },
  ]

  function getIssueColor(issue) {
    if (issue.color !== undefined && issue.color !== null) {
      return issue.color === 'red' ? 'red' : 'orange'
    }
    if (issue.kind === 'error' || issue.kind === 'missing' || (!issue.kind && issue.excerpt === null)) return 'red'
    return 'orange'
  }

  function getIssueColorLabel(issue) {
    return reviewColors.find(({ color }) => color === getIssueColor(issue))?.label ?? 'Weak'
  }

  $: showColorCounts = reviewColors.every(({ color }) => Number.isFinite(feedback?.colorCounts?.[color]))

  function setResultsTheme(theme) {
    resultsTheme = theme
    try {
      localStorage.setItem(`fixio_results_theme_${user.id}`, theme)
    } catch (error) {
      console.error('[ResultsPage] failed to save theme preference', error)
    }
  }

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
  let finishPhraseSequence = null

  function startAnalysisMessages() {
    phraseIndex = 0
    return new Promise((resolve) => {
      finishPhraseSequence = resolve
      phraseTimer = setInterval(() => {
        if (phraseIndex === phrases.length - 1) {
          finishAnalysisMessages()
        } else {
          phraseIndex += 1
        }
      }, 3000)
    })
  }

  function finishAnalysisMessages() {
    clearInterval(phraseTimer)
    phraseTimer = null
    finishPhraseSequence?.()
    finishPhraseSequence = null
  }

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
    try {
      const savedTheme = localStorage.getItem(`fixio_results_theme_${user.id}`)
      if (savedTheme === 'light' || savedTheme === 'dark') resultsTheme = savedTheme
    } catch (error) {
      console.error('[ResultsPage] failed to load theme preference', error)
    }

    const file = getPendingResume()
    roleMeta = getPendingMeta()
    if (!file) {
      stage = 'loading'
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
    stage = 'processing'
    const messagesComplete = startAnalysisMessages()
    const { data: uploadData, error: uploadErr } = await uploadResume(user.id, file)
    clearPendingResume()

    if (uploadErr || !uploadData?.path) {
      finishAnalysisMessages()
      stage = 'error'
      uploadError = 'Upload failed. Please try again.'
      console.error(uploadErr)
      return
    }

    trackEvent('resume_uploaded_success')

    const { data, error: fnError } = await supabase.functions.invoke('analyze-resume', {
      body: { role: roleMeta?.role, level: roleMeta?.level, resumePath: uploadData.path },
    })

    if (fnError || !data?.ok) {
      finishAnalysisMessages()
      stage = 'error'
      uploadError = errorMessages[data?.reason] || 'Something went wrong. Please try again.'
      console.error(fnError || data)
      trackEvent('feedback_failed', { reason: data?.reason || 'invoke_error' })
      return
    }

    if (!Array.isArray(data.result?.issues)) {
      finishAnalysisMessages()
      stage = 'error'
      uploadError = 'Resume feedback could not be displayed because the analysis service needs an update. Please try again later.'
      console.error('[ResultsPage] analysis response is missing structured issues', data.result)
      trackEvent('feedback_failed', { reason: 'missing_structured_issues' })
      return
    }

    await messagesComplete
    feedback = data.result
    stage = 'done'
    await tick()
    onTourReady()
    trackEvent('feedback_shown', { role: roleMeta?.role })
  })

  onDestroy(finishAnalysisMessages)
</script>

<svelte:window on:keydown={handlePurchaseDialogKeydown} />

<section class="results-page" data-theme={resultsTheme}>
  <header class="results-header">
    <div class="results-header-inner">
      <a href="#results-top" class="results-brand" on:click|preventDefault={onHome}>
        <span class="results-brand-mark" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 400 400" fill="none">
            <rect width="400" height="400" rx="64" fill="currentColor"/>
            <path d="M120 110 L92 110 Q80 110 80 122 L80 278 Q80 290 92 290 L120 290" stroke="var(--lime)" stroke-width="16" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M280 110 L308 110 Q320 110 320 122 L320 278 Q320 290 308 290 L280 290" stroke="var(--lime)" stroke-width="16" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M152 205 L188 240 L252 165" stroke="var(--lime)" stroke-width="18" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
        <span>Fixio</span>
      </a>

      <div class="results-header-actions">
        <div class="theme-switch" role="group" aria-label="Results page color theme">
          <button
            type="button"
            class:active={resultsTheme === 'light'}
            aria-pressed={resultsTheme === 'light'}
            on:click={() => setResultsTheme('light')}
          >
            <Sun size={14} strokeWidth={2} aria-hidden="true" />
            Light
          </button>
          <button
            type="button"
            class:active={resultsTheme === 'dark'}
            aria-pressed={resultsTheme === 'dark'}
            on:click={() => setResultsTheme('dark')}
          >
            <Moon size={14} strokeWidth={2} aria-hidden="true" />
            Dark
          </button>
        </div>
        {#if stage === 'done' && !paymentPageOpen}
          <button type="button" class="header-text-button tour-button" on:click={onHelp} aria-label="Restart product tour">
            <span class="tour-full-label">Take a tour</span>
            <span class="tour-compact-label">Tour</span>
          </button>
        {/if}
        <button type="button" class="header-text-button signout-button" on:click={onSignOut}>Sign out</button>
      </div>
    </div>
  </header>

  <main class="results-main" id="results-top">
    <div class="results-back-row">
      {#if stage === 'done' && paymentPageOpen}
        <button type="button" class="back-button" on:click={() => (paymentPageOpen = false)}>
          <ArrowLeft size={16} strokeWidth={2} aria-hidden="true" />
          Back to your results
        </button>
      {:else}
        <button type="button" class="back-button" on:click={onHome}>
          <House size={16} strokeWidth={2} aria-hidden="true" />
          Back to home
        </button>
      {/if}
    </div>

  {#if stage === 'loading' || stage === 'processing' || stage === 'error'}
    <div class="state-wrap">
      <div class="state-card" class:processing-state={stage === 'processing'}>
        {#if stage === 'loading'}
          <p class="state-eyebrow">Your workspace</p>
          <h1>Loading your recent analysis</h1>

        {:else if stage === 'processing'}
          <div class="analysis-message-window" aria-live="polite" aria-atomic="true">
            {#key phraseIndex}
              <div
                class="analysis-message"
                in:fly={{ y: 26, duration: 500, delay: 450 }}
                out:fly={{ y: -26, duration: 450 }}
              >
                <span class="analysis-step-icon" aria-hidden="true">
                  <Check size={18} strokeWidth={2.5} />
                </span>
                <span class="analysis-step-label">{phrases[phraseIndex]}</span>
              </div>
            {/key}
          </div>

        {:else if stage === 'error'}
          <p class="state-eyebrow error-eyebrow">We couldn’t finish your review</p>
          <h1>{uploadError}</h1>
          <button type="button" on:click={onRetry} class="primary-button">
            Upload another resume
          </button>
        {/if}
      </div>
    </div>

  {:else if stage === 'done'}
    {#if paymentPageOpen}
      <div class="checkout-content">
          <div>
            <p class="eyebrow">Fixio Roadmap</p>
            <h1 class="checkout-title">Choose your roadmap</h1>
            <p class="checkout-description">
              Choose the roadmap that fits you.
            </p>
          </div>

          <div class="checkout-grid">
            <section class="checkout-plan featured-plan">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <p class="plan-kicker">For students</p>
                  <h2 class="plan-title">Portfolio Roadmap</h2>
                </div>
              </div>

              <div class="plan-price">
                <span>₹199</span>
                <small>INR</small>
              </div>
              <p class="plan-description">
                A prioritised roadmap to help you build a strong portfolio and improve your chances of getting more interviews.
              </p>
              <div class="order-summary">
                <p>Order summary</p>
                <div class="order-row">
                  <span>Student Portfolio Roadmap</span>
                  <span class="font-semibold">₹199</span>
                </div>
                {#if user?.email}
                  <div class="order-account">
                    Account: {user.email}
                  </div>
                {/if}
              </div>

              <ul class="plan-features">
                <li><span aria-hidden="true">✓</span>Personalised learning priorities</li>
                <li><span aria-hidden="true">✓</span>Portfolio-building project guidance</li>
                <li><span aria-hidden="true">✓</span>Recommendations matched to your target role</li>
              </ul>

              <button
                type="button"
                on:click={recordStudentPurchaseClick}
                class="primary-button plan-action"
              >
                Buy for ₹199
              </button>
            </section>

            <section class="checkout-plan">
              <p class="plan-kicker college-kicker">For colleges</p>
              <h2 class="plan-title">Campus Plan</h2>
              <div class="plan-price custom-price">
                <span>Custom pricing</span>
              </div>
              <p class="plan-description">
                Help your students build stronger portfolios with role-focused roadmaps at scale.
              </p>

              <ul class="plan-features">
                <li><span aria-hidden="true">✓</span>Roadmaps for your student community</li>
                <li><span aria-hidden="true">✓</span>Designed around career-ready skills</li>
                <li><span aria-hidden="true">✓</span>Talk with us about your requirements</li>
              </ul>

              <a
                href="mailto:samuelfernandis25@gmail.com?subject=Fixio%20college%20roadmap%20pricing"
                on:click={trackCollegeContact}
                class="secondary-button plan-action"
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
                    style="background: var(--lime); color: #202126;"
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
    {:else}
      <section class="review-intro">
        <div>
          <p class="eyebrow"><span class="eyebrow-dot"></span> Resume review complete</p>
          <h1>{firstName ? `Here's your review, ${firstName}` : 'Your resume review is ready'}</h1>
        </div>
        {#if roleMeta?.role || roleMeta?.level}
          <div class="role-chip">
            <span>Target role</span>
            <strong>{roleMeta?.role || 'Not specified'}{roleMeta?.level ? ` · ${roleMeta.level === 'fresher' ? 'Fresher' : 'Career switcher'}` : ''}</strong>
          </div>
        {/if}
      </section>

      <section class="review-summary" aria-label="Review summary">
        <span class="summary-icon" aria-hidden="true">
          {#if feedback.issues.length}
            <span class="summary-count-icon">{feedback.issues.length}</span>
          {:else}
            ✓
          {/if}
        </span>
        <div class="summary-copy">
          {#if showColorCounts}
            <h2>Review breakdown</h2>
            <div class="summary-color-legend" aria-label="Review color counts">
              {#each reviewColors as { color, label }}
                <span class="summary-color-count">
                  <i class="color-dot {color}" aria-hidden="true"></i>
                  <strong>{feedback.colorCounts[color]}</strong>
                  <span>{label}</span>
                </span>
              {/each}
            </div>
          {:else}
            <h2>{feedback.issues.length ? `${feedback.issues.length} ${feedback.issues.length === 1 ? 'area' : 'areas'} to strengthen` : 'No specific issues identified'}</h2>
          {/if}
        </div>
        <div class="summary-strengths">
          <strong>{feedback.strengths.length}</strong>
          <span>{feedback.strengths.length === 1 ? 'strength' : 'strengths'}</span>
        </div>
      </section>

      <section class="review-layout" aria-label="Resume and review notes">
        <div class="resume-column">
          <ResumePreview file={resumeFile} issues={feedback.issues} items={feedback.items ?? []} bind:activeIssue />
        </div>

        <div class="review-sidebar">
          <section data-tour="issues" class="review-card issues-card">
            <div class="section-heading">
              <div>
                <h2>Review notes</h2>
              </div>
              <span class="note-count">
                {feedback.issues.length} {feedback.issues.length === 1 ? 'note' : 'notes'}
              </span>
            </div>

            {#if feedback.issues.length}
              <div class="issue-list">
                {#each feedback.issues as issue, i}
                  <button
                    type="button"
                    aria-expanded={activeIssue === i}
                    on:click={() => (activeIssue = activeIssue === i ? null : i)}
                    class:active={activeIssue === i}
                    class="issue-card-item"
                  >
                    <span class="issue-heading">
                      <span class="issue-number">{i + 1}</span>
                      <span class="issue-section">{issue.section}</span>
                      <span class="issue-color-label">
                        <i class="issue-color-marker {getIssueColor(issue)}" aria-hidden="true"></i>
                        {getIssueColorLabel(issue)}
                      </span>
                      <span class="issue-chevron" aria-hidden="true">{activeIssue === i ? '⌄' : '›'}</span>
                    </span>
                    <span class="issue-title">{issue.issue}</span>
                    {#if activeIssue === i}
                      <span class="issue-detail">
                        <span class="solution-label">Suggested improvement</span>
                        <span>{issue.solution}</span>
                      </span>
                    {/if}
                  </button>
                {/each}
              </div>
            {:else}
              <p class="empty-issues">No specific issues were identified for this resume.</p>
            {/if}
          </section>

          {#if feedback.strengths.length}
            <section data-tour="strengths" class="review-card strengths-card">
              <h2><span class="strength-check" aria-hidden="true">✓</span>What’s already working</h2>
              <div class="strength-list">
                {#each feedback.strengths as strength}
                  <span class="strength-tag">{strength}</span>
                {/each}
              </div>
            </section>
          {/if}
        </div>
      </section>

      <section data-tour="next-steps" class="review-card next-steps-card">
        {#if feedback.suggestions.length || feedback.issues.length}
          {#if feedback.suggestions.length}
            <div class="next-steps-heading">
              <span class="next-steps-icon" aria-hidden="true">↗</span>
              <div>
                <h2>Suggestions</h2>
              </div>
            </div>
            <ol class="next-steps-list">
              {#each feedback.suggestions as suggestion, i}
                <li><span class="step-number">{String(i + 1).padStart(2, '0')}</span><span>{suggestion}</span></li>
              {/each}
            </ol>
          {/if}
        {/if}

        <div data-tour="roadmap" class="roadmap-followup">
          <div class="roadmap-copy">
            <span class="roadmap-icon" aria-hidden="true">↗</span>
            <div>
              <h2>
                {feedback.suggestions.length || feedback.issues.length
                  ? 'Want a complete plan beyond these suggestions?'
                  : 'Want a complete plan for your target role?'}
              </h2>
            </div>
          </div>
          <button type="button" on:click={openPaymentPage} class="primary-button">
            Explore roadmap <span aria-hidden="true">→</span>
          </button>
        </div>
      </section>
      <p class="review-disclaimer">Your review is guidance to help you improve—not a hiring decision.</p>
    {/if}
  {/if}
  {#if stage === 'done'}
    <FeedbackSection {user} />
  {/if}
  </main>
</section>

<style>
  .results-page {
    --paper: #202126;
    --surface: #292a30;
    --surface-2: #303138;
    --ink: #f5f4ef;
    --ink-soft: #b2b2ba;
    --lime: #cfff3d;
    --lime-tint: rgb(207 255 61 / 14%);
    --indigo: #a99dff;
    --indigo-tint: rgb(169 157 255 / 16%);
    --coral: #ff8b7c;
    --coral-tint: rgb(255 139 124 / 15%);
    --line: #41424a;
    --accent: #8cc7bd;
    --accent-tint: #293b39;
    --warning: #ff9a8f;
    --warning-tint: #422e2e;
    --resume-canvas: #25262b;
    min-height: 100vh;
    background: var(--paper);
    color: var(--ink);
    transition: background-color .2s ease, color .2s ease;
  }

  .results-page[data-theme='light'] {
    --paper: #f4f3ef;
    --surface: #fff;
    --surface-2: #f8f8f6;
    --ink: #25272c;
    --ink-soft: #666a72;
    --lime: #cfff3d;
    --lime-tint: #f1f8d9;
    --indigo: #6554c0;
    --indigo-tint: #eeebff;
    --coral: #a94d40;
    --coral-tint: #fff0ec;
    --line: #e2e1dc;
    --accent: #286a67;
    --accent-tint: #eaf5f2;
    --warning: #a94d40;
    --warning-tint: #fff0ec;
    --resume-canvas: #eeede8;
  }

  .results-header {
    height: 68px;
    border-bottom: 1px solid var(--line);
    background: var(--surface);
  }

  .results-header-inner,
  .results-main {
    width: min(1280px, calc(100% - 64px));
    margin: 0 auto;
  }

  @media (min-width: 1100px) {
    .results-header-inner,
    .results-main {
      width: min(1440px, calc(100% - 80px));
    }
  }

  .results-header-inner {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
  }

  .results-brand {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    color: var(--ink);
    font-family: 'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif;
    font-size: 19px;
    font-weight: 700;
    letter-spacing: -.04em;
    text-decoration: none;
  }

  .results-brand-mark {
    width: 29px;
    height: 29px;
    display: grid;
    place-items: center;
    border-radius: 9px;
    background: var(--lime);
    color: #202126;
  }

  .results-header-actions {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .theme-switch {
    display: inline-flex;
    gap: 2px;
    padding: 3px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface-2);
  }

  .theme-switch button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 30px;
    padding: 0 10px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--ink-soft);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }

  .theme-switch button.active {
    background: var(--surface);
    color: var(--ink);
    box-shadow: 0 1px 4px rgb(0 0 0 / 13%);
  }

  .header-text-button,
  .back-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    border: 0;
    background: transparent;
    color: var(--ink-soft);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .header-text-button:hover,
  .back-button:hover {
    color: var(--ink);
  }

  .tour-compact-label {
    display: none;
  }

  .results-main {
    padding: 27px 0 56px;
  }

  .results-back-row {
    margin-bottom: 26px;
  }

  .back-button {
    padding: 5px 0;
  }

  .state-wrap {
    min-height: min(62vh, 580px);
    display: grid;
    place-items: center;
  }

  .state-card {
    width: min(100%, 580px);
    padding: 42px 36px;
    border: 1px solid var(--line);
    border-radius: 18px;
    background: var(--surface);
    text-align: center;
  }

  .state-card.processing-state {
    border-color: transparent;
    background: transparent;
    padding: 24px;
  }

  .state-eyebrow,
  .eyebrow {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 auto;
    color: var(--accent);
    font-size: 10px;
    font-weight: 750;
    letter-spacing: .12em;
    text-transform: uppercase;
  }

  .state-card .state-eyebrow {
    justify-content: center;
  }

  .state-card h1 {
    margin: 12px 0 0;
    font-family: 'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif;
    font-size: 24px;
    font-weight: 650;
    letter-spacing: -.035em;
    line-height: 1.3;
  }

  .error-eyebrow {
    color: var(--coral);
  }

  .analysis-message-window {
    display: grid;
    width: min(100%, 620px);
    height: 92px;
    margin: 0 auto;
    overflow: hidden;
    align-items: center;
  }

  .analysis-message {
    display: grid;
    grid-area: 1 / 1;
    grid-template-columns: 38px minmax(0, 1fr);
    align-items: center;
    gap: 22px;
    color: var(--ink);
    text-align: left;
  }

  .analysis-step-icon {
    display: grid;
    width: 38px;
    height: 38px;
    place-items: center;
    border: 2px solid currentColor;
    border-radius: 50%;
    color: var(--ink);
  }

  .analysis-step-label {
    font-family: 'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif;
    font-size: clamp(18px, 2.8vw, 25px);
    font-weight: 500;
    letter-spacing: -.025em;
    line-height: 1.25;
  }

  .review-intro {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 22px;
  }

  .eyebrow-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
  }

  .review-intro h1,
  .checkout-title {
    margin: 10px 0 8px;
    font-family: 'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif;
    font-size: clamp(29px, 3.1vw, 40px);
    font-weight: 700;
    letter-spacing: -.05em;
    line-height: 1.12;
  }

  .checkout-description {
    margin: 0;
    color: var(--ink-soft);
    font-size: 13px;
    line-height: 1.6;
  }

  .role-chip {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 13px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface);
    font-size: 11px;
  }

  .role-chip span {
    color: var(--ink-soft);
    font-size: 10px;
  }

  .role-chip strong {
    font-weight: 650;
  }

  .review-summary {
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 72px;
    margin-bottom: 17px;
    padding: 13px 17px;
    border: 1px solid var(--line);
    border-radius: 13px;
    background: var(--surface);
  }

  .summary-icon {
    width: 36px;
    height: 36px;
    flex: 0 0 36px;
    display: grid;
    place-items: center;
    border-radius: 10px;
    background: var(--accent-tint);
    color: var(--accent);
    font-size: 17px;
    font-weight: 750;
  }

  .summary-count-icon {
    font-size: 13px;
  }

  .summary-copy {
    flex: 1;
  }

  .summary-copy h2 {
    margin: 0 0 3px;
    font-size: 12px;
    font-weight: 700;
  }

  .summary-color-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 5px 12px;
  }

  .summary-color-count {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--ink-soft);
    font-size: 9px;
    line-height: 1.4;
  }

  .summary-color-count strong {
    color: var(--ink);
    font-size: 10px;
  }

  .color-dot,
  .issue-color-marker {
    width: 7px;
    height: 7px;
    flex: 0 0 7px;
    border-radius: 50%;
  }

  .color-dot.red,
  .issue-color-marker.red { background: #e52323; }
  .color-dot.orange,
  .issue-color-marker.orange { background: #e98a12; }
  .color-dot.green,
  .issue-color-marker.green { background: #218a31; }

  .summary-strengths {
    min-width: 78px;
    padding-left: 15px;
    border-left: 1px solid var(--line);
    color: var(--ink-soft);
    font-size: 10px;
    line-height: 1.45;
    text-align: right;
  }

  .summary-strengths strong {
    display: block;
    color: var(--ink);
    font-size: 13px;
  }

  .review-layout {
    display: grid;
    grid-template-columns: minmax(0, 1.12fr) minmax(350px, .88fr);
    align-items: start;
    gap: 17px;
  }

  .resume-column,
  .review-sidebar {
    min-width: 0;
  }

  .review-sidebar {
    display: grid;
    gap: 10px;
  }

  .review-card {
    border: 1px solid var(--line);
    border-radius: 13px;
    background: var(--surface);
  }

  .issues-card {
    padding: 17px;
  }

  .section-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .section-heading h2,
  .strengths-card h2,
  .next-steps-heading h2,
  .roadmap-copy h2 {
    margin: 0;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: -.01em;
  }

  .note-count {
    flex: 0 0 auto;
    padding: 5px 8px;
    border-radius: 20px;
    background: var(--warning-tint);
    color: var(--warning);
    font-size: 9px;
    font-weight: 700;
    white-space: nowrap;
  }

  .issue-list {
    display: grid;
    gap: 7px;
    margin-top: 14px;
  }

  .issue-card-item {
    width: 100%;
    padding: 10px 11px;
    border: 1px solid var(--line);
    border-radius: 9px;
    background: var(--surface-2);
    color: var(--ink);
    text-align: left;
    cursor: pointer;
    transition: border-color .15s ease, background-color .15s ease;
  }

  .issue-card-item:hover,
  .issue-card-item.active {
    border-color: color-mix(in srgb, var(--accent) 55%, var(--line));
    background: var(--surface);
  }

  .issue-heading {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 7px;
  }

  .issue-number {
    width: 19px;
    height: 19px;
    flex: 0 0 19px;
    display: grid;
    place-items: center;
    border-radius: 6px;
    background: var(--warning-tint);
    color: var(--warning);
    font-size: 9px;
    font-weight: 750;
  }

  .issue-section {
    color: var(--ink-soft);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: .06em;
    text-transform: uppercase;
  }

  .issue-color-label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--ink-soft);
    font-size: 9px;
    font-weight: 650;
    white-space: nowrap;
  }

  .issue-chevron {
    margin-left: auto;
    color: var(--ink-soft);
    font-size: 14px;
  }

  .issue-title {
    display: block;
    margin: 6px 0 0 26px;
    font-size: 10px;
    font-weight: 650;
    line-height: 1.5;
  }

  .issue-detail {
    display: block;
    margin: 10px 0 1px 26px;
    padding-top: 9px;
    border-top: 1px solid var(--line);
    color: var(--ink-soft);
    font-size: 10px;
    line-height: 1.55;
  }

  .solution-label {
    display: block;
    margin-bottom: 3px;
    color: var(--accent);
    font-size: 8px;
    font-weight: 750;
    letter-spacing: .08em;
    text-transform: uppercase;
  }

  .empty-issues {
    margin: 14px 0 0;
    padding: 12px;
    border-radius: 9px;
    background: var(--surface-2);
    color: var(--ink-soft);
    font-size: 11px;
    line-height: 1.5;
  }

  .strengths-card {
    padding: 14px 16px;
  }

  .strengths-card h2 {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
  }

  .strength-check {
    width: 19px;
    height: 19px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--accent-tint);
    color: var(--accent);
    font-size: 11px;
  }

  .strength-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
  }

  .strength-tag {
    padding: 5px 8px;
    border: 1px solid color-mix(in srgb, var(--accent) 20%, var(--line));
    border-radius: 6px;
    background: var(--accent-tint);
    color: var(--accent);
    font-size: 9px;
    line-height: 1.4;
  }

  .next-steps-card {
    margin-top: 17px;
    padding: 20px;
  }

  .next-steps-heading {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .next-steps-icon,
  .roadmap-icon {
    width: 31px;
    height: 31px;
    flex: 0 0 31px;
    display: grid;
    place-items: center;
    border-radius: 9px;
    background: var(--lime);
    color: #202126;
    font-size: 15px;
    font-weight: 700;
  }

  .next-steps-list {
    display: block;
    margin: 14px 0 0;
    padding: 0;
    list-style: none;
  }

  .next-steps-list li {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding: 12px 4px;
    border-bottom: 1px solid var(--line);
    color: var(--ink-soft);
    font-size: 9px;
    line-height: 1.5;
  }

  .next-steps-list li:last-child {
    border-bottom: 0;
  }

  .step-number {
    flex: 0 0 28px;
    color: var(--accent);
    font-size: 8px;
    font-weight: 750;
  }

  .roadmap-followup {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 20px;
    margin-top: 18px;
    padding: 18px;
    border: 1px solid var(--line);
    border-radius: 11px;
    background: var(--surface-2);
  }

  .roadmap-copy {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 11px;
    flex: 0 1 auto;
  }

  .roadmap-copy h2 {
    margin: 0;
    font-size: 13px;
    font-weight: 700;
  }

  .primary-button,
  .secondary-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 40px;
    padding: 0 15px;
    border: 0;
    border-radius: 9px;
    font-size: 11px;
    font-weight: 750;
    text-decoration: none;
    cursor: pointer;
    transition: transform .15s ease, filter .15s ease;
  }

  .primary-button {
    background: var(--lime);
    color: #202126;
  }

  .primary-button:hover {
    filter: brightness(.96);
    transform: translateY(-1px);
  }

  .secondary-button {
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
  }

  .review-disclaimer {
    margin: 11px 0 0;
    color: var(--ink-soft);
    font-size: 9px;
    text-align: center;
  }

  .checkout-content {
    width: min(100%, 920px);
    margin: 0 auto;
    padding: 4px 0 28px;
  }

  .checkout-content .eyebrow {
    color: var(--accent);
  }

  .checkout-title {
    margin-top: 9px;
  }

  .checkout-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    margin-top: 24px;
  }

  .checkout-plan {
    display: flex;
    flex-direction: column;
    padding: 23px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--surface);
  }

  .featured-plan {
    border-color: color-mix(in srgb, var(--lime) 62%, var(--line));
  }

  .plan-kicker {
    margin: 0;
    color: var(--accent);
    font-size: 9px;
    font-weight: 750;
    letter-spacing: .08em;
    text-transform: uppercase;
  }

  .college-kicker {
    color: var(--indigo);
  }

  .plan-title {
    margin: 6px 0 0;
    font-family: 'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif;
    font-size: 21px;
    letter-spacing: -.025em;
  }

  .plan-price {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-top: 20px;
    font-family: 'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif;
    font-size: 31px;
    font-weight: 800;
  }

  .plan-price small {
    color: var(--ink-soft);
    font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    font-size: 11px;
    font-weight: 500;
  }

  .custom-price {
    min-height: 38px;
    font-size: 21px;
  }

  .plan-description {
    margin: 9px 0 0;
    color: var(--ink-soft);
    font-size: 11px;
    line-height: 1.6;
  }

  .order-summary {
    margin-top: 16px;
    padding: 13px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--paper);
  }

  .order-summary > p {
    margin: 0;
    color: var(--ink-soft);
    font-size: 8px;
    font-weight: 750;
    letter-spacing: .08em;
    text-transform: uppercase;
  }

  .order-row {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin-top: 9px;
    font-size: 10px;
  }

  .order-account {
    margin-top: 9px;
    padding-top: 9px;
    border-top: 1px solid var(--line);
    color: var(--ink-soft);
    font-size: 9px;
    overflow-wrap: anywhere;
  }

  .plan-features {
    display: grid;
    gap: 10px;
    margin: 18px 0;
    padding: 0;
    list-style: none;
    font-size: 10px;
    line-height: 1.5;
  }

  .plan-features li {
    display: flex;
    gap: 8px;
  }

  .plan-features li span {
    color: var(--accent);
    font-weight: 800;
  }

  .plan-action {
    width: 100%;
    margin-top: auto;
  }

  .results-page :global([data-tour="resume-preview"]) {
    border-radius: 13px;
    box-shadow: 0 4px 16px rgb(0 0 0 / 9%);
  }

  .results-page :global(.resume-pages) {
    background: var(--resume-canvas);
  }

  .results-page :global(.resume-mark.active) {
    background: rgb(255 145 92 / 58%);
  }

  .results-page :global(.resume-mark:focus-visible) {
    outline-color: var(--accent);
  }

  .results-page :global(.solution-popover) {
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
    box-shadow: 0 8px 24px rgb(0 0 0 / 20%);
  }

  .results-page :global(.solution-popover p:first-child) {
    color: var(--accent);
  }

  @media (min-width: 1100px) {
    .role-chip {
      padding: 12px 15px;
      font-size: 12px;
    }

    .role-chip span {
      font-size: 11px;
    }

    .review-summary {
      min-height: 80px;
      padding: 15px 20px;
    }

    .summary-copy h2 {
      font-size: 14px;
    }

    .summary-strengths {
      font-size: 11px;
    }

    .summary-strengths strong {
      font-size: 15px;
    }

    .review-layout {
      grid-template-columns: minmax(0, 1.18fr) minmax(350px, .82fr);
      gap: 20px;
    }

    .issues-card {
      padding: 20px;
    }

    .section-heading h2,
    .strengths-card h2,
    .next-steps-heading h2,
    .roadmap-copy h2 {
      font-size: 15px;
    }

    .note-count {
      font-size: 10px;
    }

    .issue-card-item {
      padding: 12px 14px;
    }

    .issue-number {
      font-size: 10px;
    }

    .issue-section {
      font-size: 10px;
    }

    .issue-title,
    .issue-detail {
      font-size: 12px;
    }

    .solution-label {
      font-size: 9px;
    }

    .strengths-card h2 {
      font-size: 13px;
    }

    .strength-tag {
      font-size: 11px;
    }

    .next-steps-card {
      padding: 18px;
    }

    .next-steps-list li {
      font-size: 13px;
    }

    .step-number {
      font-size: 11px;
    }

    .roadmap-copy h2 {
      font-size: 14px;
    }

    .primary-button,
    .secondary-button {
      font-size: 13px;
    }

    .review-disclaimer {
      font-size: 10px;
    }
  }

  @media (max-width: 900px) {
    .review-layout {
      grid-template-columns: minmax(0, 1.05fr) minmax(320px, .95fr);
      gap: 13px;
    }
  }

  @media (max-width: 720px) {
    .results-header {
      height: 62px;
    }

    .results-header-inner,
    .results-main {
      width: calc(100% - 32px);
    }

    .results-header-actions {
      gap: 9px;
    }

    .tour-full-label {
      display: none;
    }

    .tour-compact-label {
      display: inline;
    }

    .header-text-button {
      font-size: 11px;
    }

    .theme-switch button {
      gap: 4px;
      min-height: 29px;
      padding: 0 7px;
      font-size: 10px;
    }

    .results-main {
      padding-top: 21px;
    }

    .results-back-row {
      margin-bottom: 19px;
    }

    .review-intro {
      display: block;
      margin-bottom: 17px;
    }

    .review-intro h1 {
      font-size: 30px;
    }

    .role-chip {
      display: inline-flex;
      margin-top: 12px;
    }

    .summary-strengths {
      display: none;
    }

    .review-layout {
      grid-template-columns: 1fr;
      gap: 12px;
    }

    .next-steps-card {
      margin-top: 12px;
    }

    .roadmap-followup {
      align-items: flex-start;
      flex-direction: column;
      gap: 16px;
      margin-top: 14px;
      padding: 14px;
    }

    .checkout-grid {
      grid-template-columns: 1fr;
    }

    .checkout-plan {
      padding: 19px;
    }
  }

  @media (max-width: 420px) {
    .results-header-inner,
    .results-main {
      width: calc(100% - 24px);
    }

    .results-header-actions {
      gap: 6px;
    }

    .results-brand {
      gap: 6px;
      font-size: 16px;
    }

    .results-brand-mark {
      width: 25px;
      height: 25px;
    }

    .theme-switch button {
      padding: 0 5px;
      font-size: 9px;
    }

    .signout-button {
      font-size: 10px;
    }

    .review-summary {
      gap: 10px;
      padding: 12px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .results-page,
    .results-page *,
    .results-page *::before,
    .results-page *::after {
      transition-duration: .01ms !important;
    }
  }
</style>
