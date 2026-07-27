<script>
  import { onMount } from 'svelte'
  import Nav from './lib/Nav.svelte'
  import Hero from './lib/Hero.svelte'
  import HowItWorks from './lib/HowItWorks.svelte'
  import Pricing from './lib/Pricing.svelte'
  import Footer from './lib/Footer.svelte'
  import SignInModal from './lib/SignInModal.svelte'
  import { initAnalytics } from './lib/analytics.js'
  import { supabase, signOut } from './lib/supabase.js'

  let modalOpen = false
  let user = null

  onMount(() => {
    initAnalytics()

    supabase.auth.getSession().then(({ data }) => {
      user = data.session?.user ?? null
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      user = session?.user ?? null
      if (user) modalOpen = false
    })

    return () => listener.subscription.unsubscribe()
  })

  function openModal() {
    modalOpen = true
  }
  function closeModal() {
    modalOpen = false
  }
</script>

<main>
  <Nav {user} onSignIn={openModal} onSignOut={signOut} />
  <Hero {user} onGetStarted={openModal} />
  <HowItWorks />
  <Pricing onGetStarted={openModal} />
  <Footer />
  <SignInModal open={modalOpen} onClose={closeModal} />
</main>
