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
  <!-- ambient glow, not a flat page -->
  <div
    class="absolute inset-x-0 top-0 h-[560px] -z-10"
    style="background: radial-gradient(55% 55% at 30% 0%, color-mix(in srgb, var(--lime) 8%, transparent), transparent 70%);"
  ></div>

  <div class="max-w-6xl mx-auto grid lg:grid-cols-2 gap-14 items-center">
    <div class="text-center lg:text-left">
      <h1 class="font-display text-5xl sm:text-6xl font-extrabold tracking-tight leading-[1.02]">
        Let's get you<br />a job<span style="color: var(--lime);">!</span>
      </h1>
      <p class="mt-6 text-lg max-w-md mx-auto lg:mx-0" style="color: var(--ink-soft);">
        Everyone chases an ATS score. We show you what's actually
        missing — the skills, projects and certs recruiters expect — so you
        close the real gap, not a fake one.
      </p>

      <div class="mt-9 flex flex-col sm:flex-row items-center lg:items-start justify-center lg:justify-start gap-4">
        <button
          on:click={() => handleClick('hero_primary')}
          class="font-display font-semibold text-base px-7 py-4 rounded-full transition-all hover:-translate-y-0.5 hover:shadow-lg"
          style="background: var(--lime); color: var(--paper);"
        >
          {user ? "You're signed in — upload coming next" : 'Get started for free'}
        </button>
        <button
          on:click={scrollToHowItWorks}
          class="font-display font-semibold text-base px-7 py-4 rounded-full border transition-colors hover:bg-[var(--surface)]"
          style="border-color: var(--line); color: var(--ink);"
        >
          See how it works
        </button>
      </div>
    </div>

    <!-- evidence window: what the actual output looks like -->
    <div class="relative flex justify-center lg:justify-end">
      <div
        bind:this={windowEl}
        class="relative z-10 w-full max-w-md rounded-2xl border shadow-xl overflow-hidden"
        style="border-color: var(--line); background: var(--surface);"
      >
        <div class="flex items-center gap-2 px-4 py-3 border-b" style="border-color: var(--line); background: var(--surface-2);">
          <span class="w-2.5 h-2.5 rounded-full" style="background: var(--coral);"></span>
          <span class="w-2.5 h-2.5 rounded-full" style="background: #F5C84C;"></span>
          <span class="w-2.5 h-2.5 rounded-full" style="background: var(--lime);"></span>
          <span class="ml-2 text-xs font-semibold tracking-wide" style="color: var(--ink-soft);">SKILL GAP REPORT · CYBERSECURITY</span>
        </div>

        <div class="relative px-6 py-6 text-left">
          <div bind:this={rowEls[0]} class="flex items-center justify-between">
            <span class="text-sm font-semibold">Network fundamentals</span>
            <span class="text-xs font-semibold px-2.5 py-1 rounded-full" style="background: var(--lime-tint); color: var(--lime);">Strong ✓</span>
          </div>
          <div bind:this={rowEls[1]} class="flex items-center justify-between mt-4">
            <span class="text-sm font-semibold">Hands-on labs / CTFs</span>
            <span class="text-xs font-semibold px-2.5 py-1 rounded-full" style="background: var(--coral-tint); color: var(--coral);">Missing</span>
          </div>
          <div bind:this={rowEls[2]} class="flex items-center justify-between mt-4">
            <span class="text-sm font-semibold">Security certification</span>
            <span class="text-xs font-semibold px-2.5 py-1 rounded-full" style="background: var(--coral-tint); color: var(--coral);">Missing</span>
          </div>

          <!-- scan line -->
          <div
            bind:this={scanEl}
            class="absolute left-0 right-0 h-10 pointer-events-none"
            style="top: 24px; background: linear-gradient(180deg, transparent, color-mix(in srgb, var(--lime) 22%, transparent), transparent);"
          ></div>
        </div>
      </div>
    </div>
  </div>
</section>
