<script>
  const year = new Date().getFullYear()
  const socials = [
    { label: 'LinkedIn', href: 'https://linkedin.com' },
    { label: 'Instagram', href: 'https://instagram.com' },
    { label: 'X', href: 'https://x.com' },
  ]
</script>

<footer class="py-12 px-6 border-t" style="border-color: var(--line);">
  <div class="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
    <div class="font-display font-semibold flex items-center gap-2">
      <span class="inline-block w-2.5 h-2.5 rounded-full" style="background: var(--lime);"></span>
      Fixio
    </div>
    <div class="flex items-center gap-6 text-sm font-medium" style="color: var(--ink-soft);">
      {#each socials as s}
        <a href={s.href} target="_blank" rel="noreferrer" class="hover:text-[var(--ink)] transition-colors">{s.label}</a>
      {/each}
    </div>
    <p class="text-sm" style="color: var(--ink-soft);">© {year} Fixio. All rights reserved.</p>
  </div>
</footer>
