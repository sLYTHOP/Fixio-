<script>
  const points = [
    {
      heading: 'Most tools',
      text: 'Only check your resume’s formatting and keywords. We help you understand how well your profile matches your target role.',
    },
    {
      heading: 'Built on real insights',
      text: 'We evaluate your profile against a curated knowledge base built from multiple job descriptions and insights from industry experts.',
    },
    {
      heading: 'Beyond identifying gaps',
      text: 'We recommend relevant courses and resources to help you close your skill gaps.',
    },
  ]

  function fadeUp(node) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    node.classList.add('why-enter')
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        node.classList.add('why-entered')
        observer.unobserve(node)
      }
    }, { threshold: 0.15 })

    observer.observe(node)

    return {
      destroy() {
        observer.disconnect()
      },
    }
  }
</script>

<section class="relative z-10 -mt-16 rounded-t-3xl px-6 pt-12 pb-24 border-t" style="border-color: #dedee0; background: #F5F5F0; color: var(--paper);">
  <div use:fadeUp class="max-w-6xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
    <div>
      <span
        class="inline-block text-sm sm:text-base font-semibold px-4 py-2 rounded-full mb-5"
        style="background: var(--lime-tint); color: #394900;"
      >
        Why Fixio?
      </span>
      <h2 class="font-display text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight">
        This isn't another ATS checker.
      </h2>
    </div>

    <div class="space-y-4">
      {#each points as point}
        <div
          class="rounded-2xl border p-5"
          style="border-color: #dedee0; background: #ffffff;"
        >
          <p class="font-display text-base font-semibold leading-snug">{point.heading}</p>
          <p class="mt-2 text-sm sm:text-base leading-relaxed" style="color: #5d5e66;">{point.text}</p>
        </div>
      {/each}
    </div>
  
  </div>
</section>

<style>
  :global(.why-enter) {
    opacity: 0.94;
    transform: translateY(8px);
  }

  :global(.why-enter.why-entered) {
    opacity: 1;
    transform: translateY(0);
    transition: opacity 350ms ease-out, transform 350ms ease-out;
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.why-enter),
    :global(.why-enter.why-entered) {
      opacity: 1;
      transform: none;
      transition: none;
    }
  }
</style>
