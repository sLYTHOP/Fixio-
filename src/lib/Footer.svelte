<script>
  const year = new Date().getFullYear()
  const socials = [
    {
      label: 'LinkedIn',
      href: 'https://linkedin.com',
      path: 'M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 9h4v12H3V9zm7 0h3.8v1.7h.05c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.78 2.65 4.78 6.1V21h-4v-5.7c0-1.36-.02-3.1-1.89-3.1-1.9 0-2.19 1.48-2.19 3v5.8h-4V9z',
    },
    {
      label: 'Instagram',
      href: 'https://instagram.com',
      path: 'M7.5 2h9A5.5 5.5 0 0 1 22 7.5v9a5.5 5.5 0 0 1-5.5 5.5h-9A5.5 5.5 0 0 1 2 16.5v-9A5.5 5.5 0 0 1 7.5 2zm0 2A3.5 3.5 0 0 0 4 7.5v9A3.5 3.5 0 0 0 7.5 20h9a3.5 3.5 0 0 0 3.5-3.5v-9A3.5 3.5 0 0 0 16.5 4h-9zM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm5.25-3.25a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5z',
    },
    {
      label: 'X',
      href: 'https://x.com',
      path: 'M18.9 2H22l-7.6 8.7L23.3 22h-6.9l-5.4-6.9L4.8 22H1.6l8.1-9.3L1 2h7l4.9 6.3L18.9 2zm-1.2 18h1.9L6.4 4H4.4l13.3 16z',
    },
  ]
</script>

<footer class="py-12 px-6 border-t" style="border-color: var(--line);">
  <div class="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
    <div class="font-display font-semibold flex items-center gap-2">
      <span class="inline-block w-2.5 h-2.5 rounded-full" style="background: var(--lime);"></span>
      Fixio
    </div>
    <div class="flex items-center gap-4">
      {#each socials as s}
        <a
          href={s.href}
          target="_blank"
          rel="noreferrer"
          aria-label={s.label}
          class="w-9 h-9 rounded-full border flex items-center justify-center transition-colors hover:bg-[var(--ink)] hover:text-[var(--paper)]"
          style="border-color: var(--line); color: var(--ink-soft);"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d={s.path} />
          </svg>
        </a>
      {/each}
    </div>
    <p class="text-sm" style="color: var(--ink-soft);">© {year} Fixio. All rights reserved.</p>
  </div>
</footer>
