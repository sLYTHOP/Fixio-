<script>
  import { onMount } from 'svelte'
  import Nav from './lib/Nav.svelte'
  import Hero from './lib/Hero.svelte'
  import HowItWorks from './lib/HowItWorks.svelte'
  import Pricing from './lib/Pricing.svelte'
  import Footer from './lib/Footer.svelte'
  import SignInModal from './lib/SignInModal.svelte'
  import { initAnalytics } from './lib/analytics.js'

  let modalOpen = false

  onMount(() => {
    initAnalytics()
  })

  function openModal() {
    modalOpen = true
  }
  function closeModal() {
    modalOpen = false
  }
</script>

<main>
  <Nav onSignIn={openModal} />
  <Hero onGetStarted={openModal} />
  <HowItWorks />
  <Pricing onGetStarted={openModal} />
  <Footer />
  <SignInModal open={modalOpen} onClose={closeModal} />
</main>
