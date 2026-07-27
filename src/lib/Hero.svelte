<script>
  import { onMount } from 'svelte'
  import gsap from 'gsap'
  import { trackEvent } from './analytics.js'

  export let user = null
  export let onGetStarted = () => {}

  let cardEl
  let scanEl
  let tagEls = []
  let floatEls = []

  const floatingCards = [
    { text: 'Frontend Dev · 2 skills to close', pos: 'top-10 left-2 sm:left-8 md:left-16' },
    { text: 'Data Analyst · Ready to apply ✓', pos: 'top-16 right-2 sm:right-8 md:right-16' },
    { text: 'Suggested: AWS Cloud Practitioner', pos: 'bottom-24 left-0 sm:left-4 md:left-8' },
    { text: 'Missing: SQL, Docker', pos: 'bottom-16 right-0 sm:right-4 md:right-8' },
  ]

  onMount(() => {
    const tl = gsap.timeline({ repeat: -1, repeatDelay: 1.1 })

    tl.set(scanEl, { y: -8, opacity: 0 })
      .set(tagEls, { opacity: 0, y: 6 })
      .to(scanEl, { opacity: 1, duration: 0.2 })
      .to(scanEl, { y: 224, duration: 1.6, ease: 'power1.inOut' })
      .to(tagEls[0], { opacity: 1, y: 0, duration: 0.35 }, '-=1.1')
      .to(tagEls[1], { opacity: 1, y: 0, duration: 0.35 }, '-=0.75')
      .to(tagEls[2], { opacity: 1, y: 0, duration: 0.35 }, '-=0.4')
      .to(scanEl, { opacity: 0, duration: 0.2 })
      .to(tagEls, { opacity: 0, y: 6, duration: 0.3 }, '+=1')

    gsap.from(cardEl, { opacity: 0, y: 24, duration: 0.7, ease: 'power2.out', delay: 0.1 })

    gsap.from(floatEls, {
      opacity: 0,
      y: 16,
      duration: 0.6,
      stagger: 0.12,
      ease: 'power2.out',
      delay: 0.2,
    })

    floatEls.forEach((el, i) => {
      if (!el) return
      gsap.to(el, {
        y: '+=10',
        duration: 2.4 + i * 0.3,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      })
    })

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
  <!-- floating skill-gap cards -->
  {#each floatingCards as fc, i}
    <div
      bind:this={floatEls[i]}
      class="hidden md:block absolute {fc.pos} text-xs font-semibold px-4 py-2.5 rounded-xl shadow-sm max-w-[190px]"
      style="background: var(--ink); color: var(--paper);"
    >
      {fc.text}
    </div>
  {/each}

  <div class="max-w-3xl mx-auto text-center relative z-10">
    <h1 class="font-display text-5xl sm:text-6xl md:text-7xl font-extrabold tracking-tight leading-[1.02]">
      Let's get you<br />a job<span style="color: var(--indigo);">!</span>
    </h1>
    <p class="mt-6 text-lg max-w-xl mx-auto" style="color: var(--ink-soft);">
      Upload your resume and find out exactly what's missing — then build the
      right skills to close the gap. Free to try, no card needed.
    </p>

    <div class="mt-9 flex flex-col sm:flex-row items-center justify-center gap-4">
      <button
        on:click={() => handleClick('hero_primary')}
        class="font-display font-semibold text-base px-7 py-4 rounded-full transition-transform hover:-translate-y-0.5"
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

  <div class="relative flex justify-center mt-16">
    <div
      bind:this={cardEl}
      class="relative z-10 w-72 rounded-2xl border shadow-sm overflow-hidden bg-white"
      style="border-color: var(--line);"
    >
      <div class="px-5 pt-5 pb-4 border-b" style="border-color: var(--line);">
        <div class="h-3 w-28 rounded-full" style="background: var(--ink);"></div>
        <div class="h-2 w-20 rounded-full mt-2" style="background: var(--line);"></div>
      </div>
      <div class="px-5 py-5 space-y-2.5">
        <div class="h-2 rounded-full w-full" style="background: var(--line);"></div>
        <div class="h-2 rounded-full w-11/12" style="background: var(--line);"></div>
        <div class="h-2 rounded-full w-4/5" style="background: var(--line);"></div>
        <div class="h-2 rounded-full w-full" style="background: var(--line);"></div>
        <div class="h-2 rounded-full w-3/4" style="background: var(--line);"></div>
      </div>

      <!-- scan line -->
      <div
        bind:this={scanEl}
        class="absolute left-0 right-0 h-9"
        style="top: 84px; background: linear-gradient(180deg, transparent, color-mix(in srgb, var(--lime) 55%, transparent), transparent);"
      ></div>

      <div class="px-5 pb-5 flex flex-wrap gap-2">
        <span
          bind:this={tagEls[0]}
          class="text-xs font-semibold px-2.5 py-1 rounded-full"
          style="background: color-mix(in srgb, var(--lime) 55%, white); color: var(--ink);"
        >React ✓</span>
        <span
          bind:this={tagEls[1]}
          class="text-xs font-semibold px-2.5 py-1 rounded-full"
          style="background: color-mix(in srgb, var(--lime) 55%, white); color: var(--ink);"
        >Git ✓</span>
        <span
          bind:this={tagEls[2]}
          class="text-xs font-semibold px-2.5 py-1 rounded-full"
          style="background: color-mix(in srgb, var(--coral) 22%, white); color: var(--ink);"
        >Missing: SQL</span>
      </div>
    </div>
  </div>
</section>
