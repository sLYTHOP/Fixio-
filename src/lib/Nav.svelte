<script>
  export let user = null
  export let onSignIn = () => {}
  export let onSignOut = () => {}

  $: avatarUrl = user?.user_metadata?.avatar_url
  $: firstName = (user?.user_metadata?.full_name || user?.email || '').split(' ')[0]
</script>

<header class="fixed top-0 inset-x-0 z-40 border-b" style="border-color: var(--line); background: color-mix(in srgb, var(--paper) 92%, transparent); backdrop-filter: blur(8px);">
  <nav class="max-w-6xl mx-auto flex items-center justify-between px-6 py-4">
    <a href="#top" class="font-display text-xl font-semibold tracking-tight flex items-center gap-2">
      <svg width="24" height="24" viewBox="0 0 400 400" fill="none">
        <rect width="400" height="400" rx="64" fill="#17181C"/>
        <path d="M120 110 L92 110 Q80 110 80 122 L80 278 Q80 290 92 290 L120 290" stroke="var(--lime)" stroke-width="22" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M280 110 L308 110 Q320 110 320 122 L320 278 Q320 290 308 290 L280 290" stroke="var(--lime)" stroke-width="22" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M152 205 L188 240 L252 165" stroke="var(--lime)" stroke-width="24" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Fixio
    </a>
    <div class="hidden sm:flex items-center gap-8 text-sm font-medium" style="color: var(--ink-soft);">
      <a href="#how-it-works" class="hover:text-[var(--ink)] transition-colors">How it works</a>
      <a href="#pricing" class="hover:text-[var(--ink)] transition-colors">Pricing</a>
    </div>

    {#if user}
      <div class="flex items-center gap-3">
        {#if avatarUrl}
          <img src={avatarUrl} alt="" class="w-8 h-8 rounded-full" referrerpolicy="no-referrer" />
        {/if}
        <span class="text-sm font-medium hidden sm:inline">{firstName}</span>
        <button
          on:click={onSignOut}
          class="text-sm font-semibold px-4 py-2 rounded-full border transition-colors hover:bg-[var(--surface-2)]"
          style="border-color: var(--line);"
        >
          Sign out
        </button>
      </div>
    {:else}
      <button
        on:click={onSignIn}
        class="text-sm font-semibold px-4 py-2 rounded-full transition-transform hover:-translate-y-0.5"
        style="background: var(--lime); color: var(--paper);"
      >
        Sign in
      </button>
    {/if}
  </nav>
</header>
