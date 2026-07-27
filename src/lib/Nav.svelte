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
      <span class="inline-block w-2.5 h-2.5 rounded-full" style="background: var(--lime);"></span>
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
          class="text-sm font-semibold px-4 py-2 rounded-full border transition-colors hover:bg-[var(--ink)] hover:text-[var(--paper)]"
          style="border-color: var(--ink);"
        >
          Sign out
        </button>
      </div>
    {:else}
      <button
        on:click={onSignIn}
        class="text-sm font-semibold px-4 py-2 rounded-full border transition-colors hover:bg-[var(--ink)] hover:text-[var(--paper)]"
        style="border-color: var(--ink);"
      >
        Sign in
      </button>
    {/if}
  </nav>
</header>
