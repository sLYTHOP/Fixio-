<script>
  import { trackEvent } from './analytics.js'
  import { signInWithGoogle } from './supabase.js'

  export let open = false
  export let onClose = () => {}

  let loading = false
  let error = ''

  async function handleGoogle() {
    trackEvent('google_signin_clicked')
    loading = true
    error = ''
    const { error: authError } = await signInWithGoogle()
    if (authError) {
      error = 'Something went wrong signing in. Please try again.'
      loading = false
      console.error(authError)
    }
    // On success, Supabase redirects the browser to Google, so nothing else runs here.
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') onClose()
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center px-6"
    style="background: color-mix(in srgb, var(--ink) 45%, transparent);"
    on:click={onClose}
    role="presentation"
  >
    <div
      class="rounded-2xl max-w-sm w-full p-8 relative"
      on:click|stopPropagation
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-labelledby="signin-title"
      style="background: var(--surface); color: var(--ink); border: 1px solid var(--line);"
    >
      <button
        on:click={onClose}
        aria-label="Close"
        class="absolute top-4 right-4 text-sm font-semibold w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--surface-2)]"
      >
        ✕
      </button>

      <h2 id="signin-title" class="font-display text-2xl font-bold tracking-tight">
        One step away
      </h2>
      <p class="mt-2 text-sm" style="color: var(--ink-soft);">
        Sign in with Google to see your feedback.
      </p>

      <button
        on:click={handleGoogle}
        disabled={loading}
        class="mt-6 w-full flex items-center justify-center gap-3 font-semibold text-sm px-6 py-3.5 rounded-full border transition-colors hover:bg-[var(--surface-2)] disabled:opacity-60"
        style="border-color: var(--line);"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62Z"/>
          <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.95v2.33A9 9 0 0 0 9 18Z"/>
          <path fill="#FBBC05" d="M3.95 10.7a5.4 5.4 0 0 1 0-3.4V4.97H.95a9 9 0 0 0 0 8.06l3-2.33Z"/>
          <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.42 0 9 0A9 9 0 0 0 .95 4.97l3 2.33C4.66 5.17 6.65 3.58 9 3.58Z"/>
        </svg>
        {loading ? 'Redirecting to Google…' : 'Continue with Google'}
      </button>

      {#if error}
        <p class="mt-3 text-xs text-center" style="color: var(--coral);">{error}</p>
      {/if}


      <p class="mt-4 text-xs text-center" style="color: var(--ink-soft);">
        By continuing, you agree to our Terms and Privacy Policy.
      </p>
    </div>
  </div>
{/if}
