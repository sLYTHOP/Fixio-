<script>
  import { reveal } from './reveal.js'

  const points = [
    { label: 'Most tools', text: 'Check if a scanner lets your resume through.' },
    { label: 'We talked to freshers first', text: 'Before writing a line of code.' },
    { label: 'The real problem', text: "Missing skills and thin projects — not keywords." },
  ]
</script>

<section class="py-24 px-6 border-t" style="border-color: #dedee0; background: #F5F5F0; color: var(--paper);">
  <div class="max-w-6xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
    <div use:reveal>
      <span
        class="inline-block text-sm sm:text-base font-semibold px-4 py-2 rounded-full mb-5"
        style="background: var(--lime-tint); color: #394900;"
      >
        Why Fixio
      </span>
      <h2 class="font-display text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight">
        This isn't another ATS checker.
      </h2>
    </div>

    <div class="space-y-4">
      {#each points as p, i}
        <div
          use:reveal={{ delay: i * 100 }}
          class="rounded-2xl border p-5"
          style="border-color: #dedee0; background: #ffffff;"
        >
          <p class="font-display text-lg font-semibold">{p.label}</p>
          <p class="mt-1 text-sm sm:text-base" style="color: #5d5e66;">{p.text}</p>
        </div>
      {/each}
    </div>
  
  </div>
</section>
