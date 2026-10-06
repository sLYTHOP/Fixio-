<script>
  import { ChevronDown } from '@lucide/svelte'
  import { trackEvent } from './analytics.js'

  export let open = false
  export let onClose = () => {}
  export let onSubmit = () => {} // (meta: { role, level }) => void

  let waitlisted = false

  const roles = [
    'Cybersecurity',
    'AI / Machine Learning',
    'Web Development',
    'Data Science',
    'Cloud / DevOps',
    'Product Management',
    'Other',
  ]

  // Sub-roles only exist for Cybersecurity right now. Only SOC Analyst has a
  // real, grounded knowledge base behind it — everything else is honest "not yet."
  const cyberSubRoles = [
    { label: 'SOC Analyst', ready: true },
    { label: 'Pentest / VAPT', ready: false },
    { label: 'IAM / PAM', ready: false },
    { label: 'GRC', ready: false },
  ]

  let selectedRole = ''
  let otherRole = ''
  let subRole = ''
  let level = ''

  $: needsSubRole = selectedRole === 'Cybersecurity'
  $: subRoleIsReady = !needsSubRole || cyberSubRoles.find(s => s.label === subRole)?.ready
  $: canSubmit =
    (selectedRole === 'Other' ? otherRole.trim().length > 0 : !!selectedRole) &&
    (!needsSubRole || !!subRole) &&
    !!level

  function handleKeydown(e) {
    if (e.key === 'Escape') onClose()
  }

  function submit() {
    const role = selectedRole === 'Other' ? otherRole.trim() : (subRole || selectedRole)

    if (needsSubRole && !subRoleIsReady) {
      trackEvent('roadmap_interest_clicked', { role, source: 'role_modal_not_ready' })
      waitlisted = true
      return
    }

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
      class="rounded-2xl max-w-md w-full p-8 relative"
      on:click|stopPropagation
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-labelledby="role-title"
      style="background: var(--surface); color: var(--ink); border: 1px solid var(--line);"
    >
      <button
        on:click={onClose}
        aria-label="Close"
        class="absolute top-4 right-4 text-sm font-semibold w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--surface-2)]"
      >
        ✕
      </button>

      {#if waitlisted}
        <h2 class="font-display text-2xl font-bold tracking-tight">You're on the list</h2>
        <p class="mt-2 text-sm" style="color: var(--ink-soft);">
          We don't have a validated skill-gap model for this track yet — we'll email you the moment we do.
        </p>
        <button
          on:click={onClose}
          class="mt-7 w-full font-display font-semibold text-sm px-6 py-3.5 rounded-full transition-all hover:-translate-y-0.5"
          style="background: var(--lime); color: var(--paper);"
        >
          Got it
        </button>
      {:else}
      <h2 id="role-title" class="font-display text-2xl font-bold tracking-tight">
        What role are you aiming for?
      </h2>
      <p class="mt-2 text-sm" style="color: var(--ink-soft);">
        We'll compare your resume against what this specific role actually needs.
      </p>

      <div class="mt-6">
        <label for="role-select" class="text-sm font-semibold">Target role</label>
        <div class="relative mt-2">
          <select
            id="role-select"
            bind:value={selectedRole}
            on:change={() => (subRole = '')}
            class="w-full appearance-none rounded-xl border px-4 py-3 text-sm font-medium outline-none transition-colors focus:border-[var(--lime)]"
            style="border-color: var(--line); background: var(--surface-2); color: var(--ink);"
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
            class="w-full mt-3 rounded-xl border px-4 py-3 text-sm outline-none transition-colors focus:border-[var(--lime)]"
            style="border-color: var(--line); background: var(--surface-2); color: var(--ink);"
          />
        {/if}

        {#if needsSubRole}
          <p class="text-sm font-semibold mt-4">Which part of cybersecurity?</p>
          <div class="mt-2 grid grid-cols-2 gap-2">
            {#each cyberSubRoles as s}
              <button
                type="button"
                on:click={() => (subRole = s.label)}
                class="text-left rounded-xl border px-3 py-2.5 text-xs font-medium transition-colors relative"
                style="border-color: {subRole === s.label ? 'var(--lime)' : 'var(--line)'};
                       background: {subRole === s.label ? 'var(--lime-tint)' : 'var(--surface-2)'};
                       color: {s.ready ? 'var(--ink)' : 'var(--ink-soft)'};"
              >
                {s.label}
                {#if !s.ready}
                  <span class="block mt-0.5 text-[10px]" style="color: var(--coral);">Coming soon</span>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <p class="mt-6 text-sm font-semibold">Where are you at?</p>
      <div class="mt-3 grid grid-cols-2 gap-2">
        <label
          class="text-center rounded-xl border px-4 py-3 cursor-pointer text-sm font-medium transition-colors"
          style="border-color: {level === 'fresher' ? 'var(--lime)' : 'var(--line)'}; background: {level === 'fresher' ? 'var(--lime-tint)' : 'var(--surface-2)'}; color: var(--ink);"
        >
          <input type="radio" name="level" value="fresher" bind:group={level} class="hidden" />
          Fresher
        </label>
        <label
          class="text-center rounded-xl border px-4 py-3 cursor-pointer text-sm font-medium transition-colors"
          style="border-color: {level === 'switcher' ? 'var(--lime)' : 'var(--line)'}; background: {level === 'switcher' ? 'var(--lime-tint)' : 'var(--surface-2)'}; color: var(--ink);"
        >
          <input type="radio" name="level" value="switcher" bind:group={level} class="hidden" />
          Career switcher
        </label>
      </div>

      <button
        on:click={submit}
        disabled={!canSubmit}
        class="mt-7 w-full font-display font-semibold text-sm px-6 py-3.5 rounded-full transition-all hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-none"
        style="background: var(--lime); color: var(--paper);"
      >
        {needsSubRole && subRole && !subRoleIsReady ? 'Join the waitlist instead' : 'Continue'}
      </button>
      {/if}
    </div>
  </div>
{/if}
