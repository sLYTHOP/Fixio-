<script>
  import { reveal } from './reveal.js'

  const points = [
    { label: 'Most tools', text: 'Check if a scanner lets your resume through.' },
    { label: 'We talked to freshers first', text: 'Before writing a line of code.' },
    { label: 'The real problem', text: "Missing skills and thin projects — not keywords." },
  ]
</script>

<section class="py-24 px-6 border-t" style="border-color: var(--line);">
  <div class="max-w-6xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
    <div use:reveal>
      <span
        class="inline-block text-xs font-semibold px-3 py-1.5 rounded-full mb-5"
        style="background: var(--lime-tint); color: var(--lime);"
      >
        Why Fixio
      </span>
      <h2 class="font-display text-3xl sm:text-4xl font-bold tracking-tight">
        This isn't another ATS checker.
      </h2>
    </div>

    <div class="space-y-4">
      {#each points as p, i}
        <div
          use:reveal={{ delay: i * 100 }}
          class="rounded-2xl border p-5"
          style="border-color: var(--line); background: var(--surface);"
        >
          <p class="font-display font-semibold" style="color: var(--lime);">{p.label}</p>
          <p class="mt-1 text-sm" style="color: var(--ink-soft);">{p.text}</p>
        </div>
      {/each}
    </div>
  </div>
</section>
