<script>
  import { reveal } from './reveal.js'

  const steps = [
    {
      n: '01',
      title: 'Upload your resume',
      body: 'Drop in your resume — PDF or DOCX. No forms, no sign-in required yet.',
      tint: 'var(--indigo-tint)',
      accent: 'var(--indigo)',
    },
    {
      n: '02',
      title: 'Tell us your target role',
      body: 'Cybersecurity, AI/ML, or your own — so feedback is judged against what that role actually needs.',
      tint: 'var(--lime-tint)',
      accent: 'var(--lime)',
    },
    {
      n: '03',
      title: 'See exactly what\u2019s missing',
      body: 'We match your resume against a knowledge base built from handpicked real job descriptions for your role, then recommend specific fixes — skills, projects and certifications standing between you and the job.',
      tint: 'var(--coral-tint)',
      accent: 'var(--coral)',
    },
  ]
</script>

<section id="how-it-works" class="py-24 px-6 border-t" style="border-color: var(--line);">
  <div class="max-w-6xl mx-auto">
    <h2 class="font-display text-3xl sm:text-4xl font-bold tracking-tight max-w-lg" use:reveal>
      From resume to job-ready, in three steps
    </h2>

    <div class="mt-14 grid md:grid-cols-3 gap-6">
      {#each steps as step, i}
        <div
          use:reveal={{ delay: i * 100 }}
          class="rounded-2xl p-7 border"
          style="background: {step.tint}; border-color: var(--line);"
        >
          <div class="font-display text-sm font-bold" style="color: {step.accent};">{step.n}</div>
          <h3 class="font-display text-xl font-semibold mt-3">{step.title}</h3>
          <p class="mt-2 text-sm leading-relaxed" style="color: var(--ink-soft);">{step.body}</p>
        </div>
      {/each}
    </div>
  </div>
</section>
