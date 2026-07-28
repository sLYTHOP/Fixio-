<script>
  import { onMount } from 'svelte'
  import Nav from './lib/Nav.svelte'
  import Hero from './lib/Hero.svelte'
  import HowItWorks from './lib/HowItWorks.svelte'
  import Pricing from './lib/Pricing.svelte'
  import Footer from './lib/Footer.svelte'
  import SignInModal from './lib/SignInModal.svelte'
  import UploadModal from './lib/UploadModal.svelte'
  import ResultsPage from './lib/ResultsPage.svelte'
  import { initAnalytics } from './lib/analytics.js'
  import { supabase, signOut } from './lib/supabase.js'
  import { stashPendingResume, hasPendingResume } from './lib/pendingResume.js'

  let user = null
  let uploadModalOpen = false
  let signInModalOpen = false
  let view = 'landing' // 'landing' | 'results'

  onMount(() => {
    initAnalytics()

    supabase.auth.getSession().then(({ data }) => {
      user = data.session?.user ?? null
      if (user && hasPendingResume()) view = 'results'
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      user = session?.user ?? null
      if (user) {
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

  async function handleFileReady(file) {
    await stashPendingResume(file)
    uploadModalOpen = false
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
    <HowItWorks />
    <Pricing onGetStarted={openUploadFlow} />
    <Footer />
  </main>
{/if}

<UploadModal open={uploadModalOpen} onClose={() => (uploadModalOpen = false)} onFileReady={handleFileReady} />
<SignInModal open={signInModalOpen} onClose={() => (signInModalOpen = false)} />
