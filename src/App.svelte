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
  import { initAnalytics, identifyUser } from './lib/analytics.js'
  import { supabase, signOut } from './lib/supabase.js'
  import { stashPendingResume, hasPendingResume } from './lib/pendingResume.js'

  let user = null
  let uploadPanel
  let uploadError = ''
  let roleModalOpen = false
  let signInModalOpen = false
  let view = 'landing' // 'landing' | 'results'
  let pendingFile = null // held in memory between upload and role questionnaire

  onMount(() => {
    initAnalytics()

    supabase.auth.getSession().then(({ data }) => {
      user = data.session?.user ?? null
      if (user) identifyUser(user)
      if (user && hasPendingResume()) view = 'results'
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      user = session?.user ?? null
      if (user) {
        identifyUser(user)
        signInModalOpen = false
        if (hasPendingResume()) view = 'results'
      } else {
        view = 'landing'
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
<RoleModal open={roleModalOpen} onClose={() => (roleModalOpen = false)} onSubmit={handleRoleSubmit} />
<SignInModal open={signInModalOpen} onClose={() => (signInModalOpen = false)} />
