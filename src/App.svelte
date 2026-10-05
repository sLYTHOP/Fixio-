<script>
  import { onMount } from 'svelte'
  import Nav from './lib/Nav.svelte'
  import Hero from './lib/Hero.svelte'
  import WhyFixio from './lib/WhyFixio.svelte'
  import HowItWorks from './lib/HowItWorks.svelte'
  import Pricing from './lib/Pricing.svelte'
  import Footer from './lib/Footer.svelte'
  import SignInModal from './lib/SignInModal.svelte'
  import UploadModal from './lib/UploadModal.svelte'
  import RoleModal from './lib/RoleModal.svelte'
  import ResultsPage from './lib/ResultsPage.svelte'
  import { initAnalytics, identifyUser } from './lib/analytics.js'
  import { supabase, signOut } from './lib/supabase.js'
  import { stashPendingResume, hasPendingResume } from './lib/pendingResume.js'

  let user = null
  let uploadModalOpen = false
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
    if (user) return // already signed in, nothing to do yet (upload flow phase 2)
    uploadModalOpen = true
  }

  function handleFileReady(file) {
    pendingFile = file
    uploadModalOpen = false
    roleModalOpen = true
  }

  async function handleRoleSubmit(meta) {
    await stashPendingResume(pendingFile, meta)
    pendingFile = null
    roleModalOpen = false
    signInModalOpen = true
  }

  function openSignInDirect() {
    signInModalOpen = true
  }
</script>

{#if view === 'results' && user}
  <ResultsPage {user} />
{:else}
  <main>
    <Nav {user} onSignIn={openSignInDirect} onSignOut={signOut} />
    <Hero {user} onGetStarted={openUploadFlow} />
    <WhyFixio />
    <HowItWorks />
    <Pricing onGetStarted={openUploadFlow} />
    <Footer />
  </main>
{/if}

<UploadModal open={uploadModalOpen} onClose={() => (uploadModalOpen = false)} onFileReady={handleFileReady} />
<RoleModal open={roleModalOpen} onClose={() => (roleModalOpen = false)} onSubmit={handleRoleSubmit} />
<SignInModal open={signInModalOpen} onClose={() => (signInModalOpen = false)} />
