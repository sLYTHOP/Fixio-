<script>
  import { reveal } from './reveal.js'
  export let onGetStarted = () => {}

  // Placeholder tiers — swap in real pricing whenever it's decided.
  const tiers = [
    {
      name: 'Free',
      price: '₹0',
      period: '',
      tagline: 'See your skill gap, no strings attached.',
      features: [
        '1 resume scan',
        'Skill-gap summary',
        'Suggested courses & certifications',
      ],
      cta: 'Get started for free',
      highlight: false,
    },
    {
      name: 'Pro',
      price: '₹199',
      period: '/mo',
      tagline: 'For freshers actively applying.',
      features: [
        'Unlimited resume scans',
        'Role-specific gap analysis',
        'Prioritized learning roadmap',
        'Track progress over time',
      ],
      cta: 'Start free, upgrade anytime',
      highlight: true,
    },
  ]
</script>

<section id="pricing" class="py-24 px-6 border-t" style="border-color: var(--line);">
  <div class="max-w-6xl mx-auto">
    <h2 class="font-display text-3xl sm:text-4xl font-bold tracking-tight max-w-lg" use:reveal>
      Start free. Upgrade when you're serious.
    </h2>

    <div class="mt-14 grid md:grid-cols-2 gap-6 max-w-3xl">
      {#each tiers as tier, i}
        <div
          use:reveal={{ delay: i * 100 }}
          class="rounded-2xl p-8 border flex flex-col transition-transform hover:-translate-y-1"
          style="border-color: {tier.highlight ? 'var(--lime)' : 'var(--line)'}; background: {tier.highlight ? 'var(--ink)' : 'var(--surface)'}; color: {tier.highlight ? 'var(--paper)' : 'var(--ink)'};"
        >
          <div class="font-display text-lg font-semibold">{tier.name}</div>
          <div class="mt-4 flex items-baseline gap-1">
            <span class="font-display text-4xl font-extrabold">{tier.price}</span>
            {#if tier.period}<span class="text-sm opacity-70">{tier.period}</span>{/if}
          </div>
          <p class="mt-2 text-sm opacity-80">{tier.tagline}</p>

          <ul class="mt-6 space-y-3 text-sm flex-1">
            {#each tier.features as f}
              <li class="flex items-start gap-2">
                <span class="mt-1 w-1.5 h-1.5 rounded-full shrink-0" style="background: {tier.highlight ? 'var(--lime)' : 'var(--indigo)'};"></span>
                {f}
              </li>
            {/each}
          </ul>

          <button
            on:click={onGetStarted}
            class="mt-8 font-display font-semibold text-sm px-6 py-3 rounded-full transition-transform hover:-translate-y-0.5"
            style="background: {tier.highlight ? 'var(--lime)' : 'var(--ink)'}; color: {tier.highlight ? 'var(--ink)' : 'var(--paper)'};"
          >
            {tier.cta}
          </button>
        </div>
      {/each}
    </div>
  </div>
</section>
