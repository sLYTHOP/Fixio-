<script>
  import { onMount } from 'svelte'
  import gsap from 'gsap'
  import { trackEvent } from './analytics.js'

  export let user = null
  export let onGetStarted = () => {}

  let windowEl
  let scanEl
  let rowEls = []

  onMount(() => {
    gsap.from(windowEl, { opacity: 0, y: 28, duration: 0.7, ease: 'power2.out', delay: 0.15 })

    const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.4, delay: 0.6 })
    tl.set(scanEl, { y: -6, opacity: 0 })
      .set(rowEls, { opacity: 0.35 })
      .to(scanEl, { opacity: 1, duration: 0.2 })
      .to(scanEl, { y: 210, duration: 1.5, ease: 'power1.inOut' })
      .to(rowEls[0], { opacity: 1, duration: 0.3 }, '-=1.2')
      .to(rowEls[1], { opacity: 1, duration: 0.3 }, '-=0.85')
      .to(rowEls[2], { opacity: 1, duration: 0.3 }, '-=0.5')
      .to(scanEl, { opacity: 0, duration: 0.2 })

    return () => tl.kill()
  })

  function handleClick(location) {
    if (user) return
    trackEvent('get_started_clicked', { location })
    onGetStarted()
  }

  function scrollToHowItWorks() {
    document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })
  }
</script>

<section id="top" class="relative pt-40 pb-28 px-6 overflow-hidden">
  <!-- soft ambient color, not a flat white page -->
  <div
    class="absolute inset-x-0 top-0 h-[560px] -z-10"
    style="background: radial-gradient(60% 60% at 50% 0%, color-mix(in srgb, var(--indigo) 10%, transparent), transparent 70%);"
  ></div>

  <div class="max-w-3xl mx-auto text-center relative z-10">
    <span
      class="inline-block text-xs font-semibold px-3 py-1.5 rounded-full mb-5"
      style="background: var(--indigo-tint); color: var(--indigo);"
    >
      Built for cybersecurity &amp; AI freshers
    </span>
    <h1 class="font-display text-5xl sm:text-6xl md:text-7xl font-extrabold tracking-tight leading-[1.02]">
      Let's get you<br />a job<span style="color: var(--indigo);">!</span>
    </h1>
    <p class="mt-6 text-lg max-w-xl mx-auto" style="color: var(--ink-soft);">
      Everyone chases an ATS score. We show you what's actually
      missing — the skills, projects and certs recruiters expect — so you
      close the real gap, not a fake one.
    </p>

    <div class="mt-9 flex flex-col sm:flex-row items-center justify-center gap-4">
      <button
        on:click={() => handleClick('hero_primary')}
        class="font-display font-semibold text-base px-7 py-4 rounded-full transition-all hover:-translate-y-0.5 hover:shadow-lg"
        style="background: var(--ink); color: var(--paper);"
      >
        {user ? "You're signed in — upload coming next" : 'Get started for free'}
      </button>
      <button
        on:click={scrollToHowItWorks}
        class="font-display font-semibold text-base px-7 py-4 rounded-full border transition-colors hover:bg-white"
        style="border-color: var(--ink); color: var(--ink);"
      >
        See how it works
      </button>
    </div>
  </div>

  <!-- evidence window: what the actual output looks like -->
  <div class="relative flex justify-center mt-16">
    <div
      bind:this={windowEl}
      class="relative z-10 w-full max-w-md rounded-2xl border shadow-xl overflow-hidden bg-white"
      style="border-color: var(--line);"
    >
      <div class="flex items-center gap-2 px-4 py-3 border-b" style="border-color: var(--line); background: #FAFAF9;">
        <span class="w-2.5 h-2.5 rounded-full" style="background: var(--coral);"></span>
        <span class="w-2.5 h-2.5 rounded-full" style="background: #F5C84C;"></span>
        <span class="w-2.5 h-2.5 rounded-full" style="background: var(--lime);"></span>
        <span class="ml-2 text-xs font-semibold tracking-wide" style="color: var(--ink-soft);">SKILL GAP REPORT · CYBERSECURITY</span>
      </div>

      <div class="relative px-6 py-6 text-left">
        <div bind:this={rowEls[0]} class="flex items-center justify-between">
          <span class="text-sm font-semibold">Network fundamentals</span>
          <span class="text-xs font-semibold px-2.5 py-1 rounded-full" style="background: var(--lime-tint); color: var(--ink);">Strong ✓</span>
        </div>
        <div bind:this={rowEls[1]} class="flex items-center justify-between mt-4">
          <span class="text-sm font-semibold">Hands-on labs / CTFs</span>
          <span class="text-xs font-semibold px-2.5 py-1 rounded-full" style="background: var(--coral-tint); color: var(--ink);">Missing</span>
        </div>
        <div bind:this={rowEls[2]} class="flex items-center justify-between mt-4">
          <span class="text-sm font-semibold">Security certification</span>
          <span class="text-xs font-semibold px-2.5 py-1 rounded-full" style="background: var(--coral-tint); color: var(--ink);">Missing</span>
        </div>

        <!-- scan line -->
        <div
          bind:this={scanEl}
          class="absolute left-0 right-0 h-10 pointer-events-none"
          style="top: 24px; background: linear-gradient(180deg, transparent, color-mix(in srgb, var(--indigo) 18%, transparent), transparent);"
        ></div>
      </div>
    </div>
  </div>
</section>
