<script>
  const steps = [
    {
      n: '01',
      title: 'Sign in & upload your resume',
      body: 'Sign in with Google, drop in your resume, and sit back — no forms to fill out.',
    },
    {
      n: '02',
      title: 'We read every line',
      body: "We go through your projects, skills and experience — the same way a hiring manager would.",
    },
    {
      n: '03',
      title: 'See exactly what\u2019s missing',
      body: 'Get a clear breakdown of the skills, tools and certifications standing between you and the role.',
    },
  ]
</script>

<section id="how-it-works" class="py-24 px-6 border-t" style="border-color: var(--line);">
  <div class="max-w-6xl mx-auto">
    <h2 class="font-display text-3xl sm:text-4xl font-bold tracking-tight max-w-lg">
      From resume to job-ready, in three steps
    </h2>

    <div class="mt-14 grid md:grid-cols-3 gap-10">
      {#each steps as step}
        <div>
          <div class="font-display text-sm font-semibold" style="color: var(--indigo);">{step.n}</div>
          <h3 class="font-display text-xl font-semibold mt-3">{step.title}</h3>
          <p class="mt-2 text-sm leading-relaxed" style="color: var(--ink-soft);">{step.body}</p>
        </div>
      {/each}
    </div>
  </div>
</section>
