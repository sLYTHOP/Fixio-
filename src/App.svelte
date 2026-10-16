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
  import { initAnalytics, identifyUser, trackEvent } from './lib/analytics.js'
  import { joinWaitlist, supabase, signOut } from './lib/supabase.js'
  import { stashPendingResume } from './lib/pendingResume.js'
  import {
    clearPendingWaitlistRole,
    getPendingWaitlistRole,
    stashPendingWaitlistRole,
  } from './lib/pendingWaitlist.js'

  let user = null
  let uploadPanel
  let uploadError = ''
  let roleModalOpen = false
  let signInModalOpen = false
  let view = 'landing' // 'landing' | 'results'
  let pendingFile = null // held in memory between upload and role questionnaire
  let waitlistRole = ''
  let waitlistNotice = ''
  let waitlistError = ''
  let savingWaitlist = false

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
    roleModalOpen = true
  }

  async function handleRoleSubmit(meta) {
    await stashPendingResume(pendingFile, meta)
    pendingFile = null
    roleModalOpen = false
    if (user) {
      view = 'results'
    } else {
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

{#if view === 'results' && user}
  <ResultsPage {user} onHome={returnHome} onRetry={retryUpload} />
{:else}
  <main>
    <Nav {user} onSignIn={openSignInDirect} onSignOut={signOut} />
    <Hero onGetStarted={openUploadFlow} />
    <WhyFixio />
    <HowItWorks />
    <Pricing onGetStarted={openUploadFlow} />
    <Footer />
  </main>
{/if}
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
/>
<SignInModal open={signInModalOpen} onClose={closeSignInModal} {waitlistRole} />
