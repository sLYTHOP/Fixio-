<script>
  import { ChevronDown } from '@lucide/svelte'
  import { trackEvent } from './analytics.js'

  export let open = false
  export let onClose = () => {}
  export let onSubmit = () => {} // (meta: { role, level }) => void

  const roles = [
    'Cybersecurity',
    'AI / Machine Learning',
    'Web Development',
    'Data Science',
    'Cloud / DevOps',
    'Product Management',
    'Other',
  ]

  let selectedRole = ''
  let otherRole = ''
  let level = ''

  $: canSubmit = (selectedRole === 'Other' ? otherRole.trim().length > 0 : !!selectedRole) && !!level

  function handleKeydown(e) {
    if (e.key === 'Escape') onClose()
  }

  function submit() {
    const role = selectedRole === 'Other' ? otherRole.trim() : selectedRole
    trackEvent('role_questionnaire_submitted', { role, level })
    onSubmit({ role, level })
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
      class="bg-white rounded-2xl max-w-md w-full p-8 relative"
      on:click|stopPropagation
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-labelledby="role-title"
    >
      <button
        on:click={onClose}
        aria-label="Close"
        class="absolute top-4 right-4 text-sm font-semibold w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--paper)]"
      >
        ✕
      </button>

      <h2 id="role-title" class="font-display text-2xl font-bold tracking-tight">
        What role are you aiming for?
      </h2>
      <p class="mt-2 text-sm" style="color: var(--ink-soft);">
        We'll compare your resume against what this specific role actually needs.
        <span class="block mt-1 font-medium" style="color: var(--indigo);">Deepest coverage right now: Cybersecurity &amp; AI/ML.</span>
      </p>

      <div class="mt-6">
        <label for="role-select" class="text-sm font-semibold">Target role</label>
        <div class="relative mt-2">
          <select
            id="role-select"
            bind:value={selectedRole}
            class="w-full appearance-none rounded-xl border px-4 py-3 text-sm font-medium bg-white outline-none transition-colors focus:border-[var(--indigo)]"
            style="border-color: var(--line);"
          >
            <option value="" disabled selected>Choose a role</option>
            {#each roles as r}
              <option value={r}>{r}</option>
            {/each}
          </select>
          <ChevronDown size={16} class="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2" style="color: var(--ink-soft);" />
        </div>

        {#if selectedRole === 'Other'}
          <input
            type="text"
            placeholder="Type your target role"
            bind:value={otherRole}
            class="w-full mt-3 rounded-xl border px-4 py-3 text-sm outline-none transition-colors focus:border-[var(--indigo)]"
            style="border-color: var(--line);"
          />
        {/if}
      </div>

      <p class="mt-6 text-sm font-semibold">Where are you at?</p>
      <div class="mt-3 grid grid-cols-2 gap-2">
        <label
          class="text-center rounded-xl border px-4 py-3 cursor-pointer text-sm font-medium transition-colors"
          style="border-color: {level === 'fresher' ? 'var(--indigo)' : 'var(--line)'}; background: {level === 'fresher' ? 'var(--indigo-tint)' : 'white'};"
        >
          <input type="radio" name="level" value="fresher" bind:group={level} class="hidden" />
          Fresher
        </label>
        <label
          class="text-center rounded-xl border px-4 py-3 cursor-pointer text-sm font-medium transition-colors"
          style="border-color: {level === 'switcher' ? 'var(--indigo)' : 'var(--line)'}; background: {level === 'switcher' ? 'var(--indigo-tint)' : 'white'};"
        >
          <input type="radio" name="level" value="switcher" bind:group={level} class="hidden" />
          Career switcher
        </label>
      </div>

      <button
        on:click={submit}
        disabled={!canSubmit}
        class="mt-7 w-full font-display font-semibold text-sm px-6 py-3.5 rounded-full transition-all hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-none"
        style="background: var(--ink); color: var(--paper);"
      >
        Continue
      </button>
    </div>
  </div>
{/if}
