<script>
  import { onMount } from 'svelte'
  import gsap from 'gsap'
  import { trackEvent } from './analytics.js'

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
    trackEvent('get_started_clicked', { location })
    onGetStarted()
  }

  function scrollToHowItWorks() {
    document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })
  }
</script>

<section id="top" class="relative overflow-hidden px-6 pb-24 pt-36 sm:pt-40">
  <!-- ambient glow, not a flat page -->
  <div
    class="absolute inset-x-0 top-0 h-[560px] -z-10"
    style="background: radial-gradient(55% 55% at 30% 0%, color-mix(in srgb, var(--lime) 8%, transparent), transparent 70%);"
  ></div>

  <div class="mx-auto flex max-w-4xl flex-col items-center text-center">
    <div>
      <h1 class="font-display text-5xl font-extrabold tracking-tight leading-[1.02] sm:text-6xl lg:text-7xl">
        Let's get you<br />a job<span style="color: var(--lime);">!</span>
      </h1>
      <p class="mx-auto mt-6 max-w-2xl text-lg sm:text-xl" style="color: var(--ink-soft);">
        Everyone chases an ATS score. We show you what's actually missing:
        the skills, projects and certs recruiters expect, so you close real gaps.
      </p>

      <div class="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
        <div class="flex flex-col items-center gap-2">
          <button
            on:click={() => handleClick('hero_primary')}
            class="flex min-h-14 flex-col items-center justify-center rounded-full px-8 py-3 font-display transition-all hover:-translate-y-0.5 hover:shadow-lg"
            style="background: var(--lime); color: #202126;"
          >
            <span class="text-base font-semibold leading-tight">Upload resume</span>
            <span class="mt-0.5 text-xs font-medium leading-tight">PDF only, up to 5 MB</span>
          </button>
        </div>
        <button
          on:click={scrollToHowItWorks}
          class="rounded-full border px-7 py-4 font-display text-base font-semibold transition-colors hover:bg-[var(--surface)]"
          style="border-color: var(--line); color: var(--ink);"
        >
          See how it works
        </button>
      </div>
    </div>

    <!-- Evidence window: what the actual output looks like -->
    <div class="relative mt-14 flex w-full justify-center sm:mt-16">
      <div
        bind:this={windowEl}
        class="relative z-10 w-full max-w-xl overflow-hidden rounded-2xl border shadow-xl"
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
