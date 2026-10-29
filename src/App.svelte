<script>
  import { onMount } from 'svelte'
  import Nav from './lib/Nav.svelte'
  import Hero from './lib/Hero.svelte'
  import WhyFixio from './lib/WhyFixio.svelte'
  import HowItWorks from './lib/HowItWorks.svelte'
  import Pricing from './lib/Pricing.svelte'
  import Footer from './lib/Footer.svelte'
  import SignInModal from './lib/SignInModal.svelte'
  import UploadPanel from './lib/UploadPanel.svelte'
  import RoleModal from './lib/RoleModal.svelte'
  import ResultsPage from './lib/ResultsPage.svelte'
  import FeedbackSection from './lib/FeedbackSection.svelte'
  import OnboardingTour from './lib/OnboardingTour.svelte'
  import { initAnalytics, identifyUser, trackEvent } from './lib/analytics.js'
  import { joinWaitlist, supabase, signOut } from './lib/supabase.js'
  import { hasPendingResume, stashPendingResume } from './lib/pendingResume.js'
  import {
    clearPendingWaitlistRole,
    getPendingWaitlistRole,
    stashPendingWaitlistRole,
  } from './lib/pendingWaitlist.js'

  let user = null
  let uploadPanel
  let uploadError = ''
  let roleModalOpen = false
  let rolePreparationError = ''
  let signInModalOpen = false
  let view = hasPendingResume() ? 'authenticating' : 'landing' // 'landing' | 'authenticating' | 'results'
  let preparingAnalysis = false
  let pendingFile = null // held in memory between upload and role questionnaire
  let waitlistRole = ''
  let waitlistNotice = ''
  let waitlistError = ''
  let savingWaitlist = false
  let tourOpen = false

  const tourSteps = [
    {
      selector: '[data-tour="resume-preview"]',
      title: 'Hover or tap red highlights to see fixes',
      description: 'Each red area marks an issue in your resume. Hover over it or tap it to see the suggested fix.',
    },
    {
      selector: '[data-tour="issues"]',
      title: 'Explore the issues',
      description: 'Select an issue to jump to its location in your resume and highlight the matching passage.',
    },
    {
      selector: '[data-tour="strengths"]',
      title: 'See what is already working',
      description: 'Your relevant strengths are collected here, so you know what to keep building on.',
    },
    {
      selector: '[data-tour="next-steps"]',
      title: 'Turn feedback into action',
      description: 'Find tailored recommendations and suggested fixes here.',
    },
    {
      selector: '[data-tour="roadmap"]',
      title: 'Get a learning roadmap',
      description: 'Explore roadmap options for a step-by-step plan to close your skill gaps.',
    },
  ]

  function startTour() {
    tourOpen = true
  }

  function completeTour() {
    tourOpen = false
    if (!user?.id) return

    localStorage.setItem(`fixio_tour_completed_${user.id}`, 'true')
    void persistTourCompletion()
  }

  async function persistTourCompletion() {
    try {
      const { error } = await supabase.auth.updateUser({
        data: { fixio_tour_completed: true },
      })
      if (error) console.error('[App] failed to save tour completion', error)
    } catch (error) {
      console.error('[App] failed to save tour completion', error)
    }
  }

  function startFirstTour() {
    if (
      user?.id &&
      user.user_metadata?.fixio_tour_completed !== true &&
      localStorage.getItem(`fixio_tour_completed_${user.id}`) !== 'true'
    ) {
      localStorage.setItem(`fixio_tour_completed_${user.id}`, 'true')
      startTour()
    }
  }

  async function savePendingWaitlist(authenticatedUser) {
    const role = getPendingWaitlistRole()
    if (!role || savingWaitlist) return

    waitlistRole = role
    view = 'landing'
    if (!authenticatedUser.email) {
      waitlistError = "We couldn't find an email address for your account. Please try another Google account."
      return
    }

    savingWaitlist = true
    waitlistError = ''
    const { error } = await joinWaitlist({
      email: authenticatedUser.email,
      role,
      source: 'role_not_ready',
      userId: authenticatedUser.id,
    })
    savingWaitlist = false

    if (error) {
      console.error('[App] failed to save waitlist signup', error)
      waitlistError = "Couldn't save your waitlist signup. Please try again."
      return
    }

    clearPendingWaitlistRole()
    waitlistRole = ''
    waitlistNotice = `You're on the waitlist for ${role}.`
    trackEvent('waitlist_joined', { role, source: 'role_not_ready' })
  }

  function handleAuthenticated(authenticatedUser) {
    user = authenticatedUser
    identifyUser(authenticatedUser)
    signInModalOpen = false
    if (preparingAnalysis) return
    if (hasPendingResume()) {
      clearPendingWaitlistRole()
      waitlistRole = ''
      view = 'results'
      return
    }
    if (getPendingWaitlistRole()) {
      waitlistNotice = ''
      waitlistError = ''
      waitlistRole = getPendingWaitlistRole()
      view = 'landing'
      setTimeout(() => void savePendingWaitlist(authenticatedUser), 0)
    } else if (waitlistNotice || waitlistError) {
      view = 'landing'
    } else {
      view = 'results'
    }
  }

  onMount(() => {
    initAnalytics()

    supabase.auth.getSession().then(({ data }) => {
      const authenticatedUser = data.session?.user ?? null
      if (authenticatedUser) {
        handleAuthenticated(authenticatedUser)
      } else if (hasPendingResume()) {
        view = 'authenticating'
        signInModalOpen = true
      } else if (getPendingWaitlistRole()) {
        waitlistRole = getPendingWaitlistRole()
        signInModalOpen = true
      }
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        handleAuthenticated(session.user)
      } else {
        user = null
        if (preparingAnalysis) return
        if (hasPendingResume()) {
          view = 'authenticating'
          return
        }
        view = 'landing'
        if (getPendingWaitlistRole()) {
          waitlistRole = getPendingWaitlistRole()
          signInModalOpen = true
        }
      }
    })

    return () => listener.subscription.unsubscribe()
  })

  // "Get started" / hero CTA -> ask for the resume first
  function openUploadFlow() {
    uploadError = ''
    uploadPanel.openPicker()
  }

  function handleFileReady(file) {
    pendingFile = file
    rolePreparationError = ''
    roleModalOpen = true
  }

  async function handleRoleSubmit(meta) {
    if (!pendingFile) {
      uploadError = 'We could not find the selected resume. Please choose it again.'
      return
    }

    preparingAnalysis = true
    rolePreparationError = ''
    try {
      await stashPendingResume(pendingFile, meta)
    } catch (error) {
      console.error('[App] failed to prepare resume analysis', error)
      preparingAnalysis = false
      rolePreparationError = 'We could not prepare your resume. Please try again.'
      return
    }

    pendingFile = null
    preparingAnalysis = false
    roleModalOpen = false
    if (user) {
      view = 'results'
    } else {
      view = 'authenticating'
      signInModalOpen = true
    }
  }

  function handleJoinWaitlist(role) {
    stashPendingWaitlistRole(role)
    waitlistRole = role
    waitlistNotice = ''
    waitlistError = ''
    roleModalOpen = false
    signInModalOpen = true
  }

  function closeSignInModal() {
    signInModalOpen = false
    clearPendingWaitlistRole()
    waitlistRole = ''
    if (view === 'authenticating') view = 'landing'
  }

  function retryWaitlistSave() {
    if (user) void savePendingWaitlist(user)
  }

  function openSignInDirect() {
    signInModalOpen = true
  }

  function returnHome() {
    view = 'landing'
  }

  function retryUpload() {
    returnHome()
    openUploadFlow()
  }
</script>

{#if (view === 'results' || hasPendingResume()) && user}
  <ResultsPage {user} onHome={returnHome} onRetry={retryUpload} onHelp={startTour} onSignOut={signOut} onTourReady={startFirstTour} />
{:else if view === 'authenticating' || hasPendingResume()}
  <main class="flex min-h-screen items-center justify-center px-6 text-center">
    <p class="font-display text-xl font-semibold">Signing in to start your analysis...</p>
  </main>
{:else}
  <main>
    {#if !roleModalOpen}
      <Nav {user} onSignIn={openSignInDirect} onSignOut={signOut} />
    {/if}
    <Hero onGetStarted={openUploadFlow} />
    <WhyFixio />
    <HowItWorks />
    <Pricing onGetStarted={openUploadFlow} />
    <FeedbackSection {user} />
    <Footer />
  </main>
{/if}
<OnboardingTour open={tourOpen} steps={tourSteps} onComplete={completeTour} />
{#if waitlistNotice || waitlistError}
  <div
    class="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl px-5 py-3 text-sm font-medium shadow-lg"
    style="background: var(--surface); color: {waitlistError ? 'var(--coral)' : 'var(--ink)'}; border: 1px solid var(--line);"
    role={waitlistError ? 'alert' : 'status'}
  >
    {waitlistError || waitlistNotice}
    {#if waitlistError && user && getPendingWaitlistRole()}
      <button class="ml-3 underline" on:click={retryWaitlistSave} disabled={savingWaitlist}>
        {savingWaitlist ? 'Saving...' : 'Try again'}
      </button>
    {/if}
  </div>
{/if}
<UploadPanel bind:this={uploadPanel} onFileReady={handleFileReady} onError={(error) => (uploadError = error)} />
{#if uploadError}
  <div
    class="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-xl px-5 py-3 text-sm font-medium shadow-lg"
    style="background: var(--surface); color: var(--coral); border: 1px solid var(--line);"
    role="alert"
  >
    {uploadError}
  </div>
{/if}
<RoleModal
  open={roleModalOpen}
  onClose={() => (roleModalOpen = false)}
  onSubmit={handleRoleSubmit}
  onJoinWaitlist={handleJoinWaitlist}
  preparationError={rolePreparationError}
/>
<SignInModal open={signInModalOpen} onClose={closeSignInModal} {waitlistRole} />
