<script>
  import { ChevronDown } from '@lucide/svelte'
  import { trackEvent } from './analytics.js'

  export let open = false
  export let onClose = () => {}
  /** @type {(meta: { role: string, level: string }) => void} */
  export let onSubmit = () => {}
  /** @type {(role: string) => void} */
  export let onJoinWaitlist = () => {}

  let submittedUnsupportedRole = false
  let step = 1

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
  $: canContinue =
    (selectedRole === 'Other' ? otherRole.trim().length > 0 : !!selectedRole) &&
    (!needsSubRole || !!subRole)
  $: canSubmit = !!level

  /** @param {KeyboardEvent} e */
  function handleKeydown(e) {
    if (e.key === 'Escape') close()
  }

  /** @param {KeyboardEvent} e */
  function handleDialogKeydown(e) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      close()
    }
  }

  function close() {
    step = 1
    submittedUnsupportedRole = false
    onClose()
  }

  function continueToExperience() {
    if (canContinue) step = 2
  }

  function goBack() {
    step = 1
  }

  function submit() {
    const role = selectedRole === 'Other' ? otherRole.trim() : (subRole || selectedRole)

    trackEvent('role_questionnaire_submitted', { role, level })
    if (role !== 'SOC Analyst') {
      submittedUnsupportedRole = true
      trackEvent('role_waitlist_prompt_shown', { role })
      return
    }

    onSubmit({ role, level })
  }

  function startWaitlistSignup() {
    const role = selectedRole === 'Other' ? otherRole.trim() : (subRole || selectedRole)
    trackEvent('role_waitlist_signup_started', { role })
    onJoinWaitlist(role)
    close()
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto px-4 py-4 sm:items-center sm:px-6 sm:py-6"
    style="background: color-mix(in srgb, var(--ink) 45%, transparent);"
    on:click={close}
    role="presentation"
  >
    <div
      class="relative my-auto max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl p-5 sm:max-h-[calc(100dvh-3rem)] sm:p-8"
      on:click|stopPropagation
      on:keydown={handleDialogKeydown}
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-labelledby="role-title"
      style="background: var(--surface); color: var(--ink); border: 1px solid var(--line);"
    >
      <button
        on:click={close}
        aria-label="Close"
        class="absolute top-4 right-4 text-sm font-semibold w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--surface-2)]"
      >
        ✕
      </button>

      {#if submittedUnsupportedRole}
        <h2 class="text-center font-display text-2xl font-bold tracking-tight">Coming soon</h2>
        <p class="mt-2 text-center text-sm" style="color: var(--ink-soft);">
          We’re still building support for this role. Join the waitlist to be notified when it becomes available.
        </p>
        <button
          on:click={startWaitlistSignup}
          class="mt-6 w-full font-display font-semibold text-sm px-6 py-3.5 rounded-full transition-all hover:-translate-y-0.5"
          style="background: var(--lime); color: var(--paper);"
        >
          Join Waitlist
        </button>
      {:else}
        <div class="mb-6 pr-10">
          <p class="mb-2 text-xs font-semibold uppercase tracking-wider" style="color: var(--ink-soft);">
            Question {step} of 2
          </p>
          <div class="mb-4 flex gap-2" aria-hidden="true">
            <span class="h-1.5 flex-1 rounded-full" style="background: var(--lime);"></span>
            <span class="h-1.5 flex-1 rounded-full" style="background: {step === 2 ? 'var(--lime)' : 'var(--line)'};"></span>
          </div>
          <h2 id="role-title" class="font-display text-2xl font-bold tracking-tight">
            {step === 1 ? 'What role are you aiming for?' : 'Where are you at?'}
          </h2>
        </div>

        {#if step === 1}
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
              class="mt-3 w-full rounded-xl border px-4 py-3 text-sm outline-none transition-colors focus:border-[var(--lime)]"
              style="border-color: var(--line); background: var(--surface-2); color: var(--ink);"
            />
          {/if}

          {#if needsSubRole}
            <p class="mt-4 text-sm font-semibold">Which part of cybersecurity?</p>
            <div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {#each cyberSubRoles as s}
                <button
                  type="button"
                  on:click={() => (subRole = s.label)}
                  class="relative rounded-xl border px-3 py-3 text-left text-sm font-medium transition-colors"
                  style="border-color: {subRole === s.label ? 'var(--lime)' : 'var(--line)'};
                         background: {subRole === s.label ? 'var(--lime-tint)' : 'var(--surface-2)'};
                         color: {s.ready ? 'var(--ink)' : 'var(--ink-soft)'};"
                >
                  {s.label}
                  {#if !s.ready}
                    <span class="mt-0.5 block text-xs" style="color: var(--coral);">Coming soon</span>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}

          <button
            type="button"
            on:click={continueToExperience}
            disabled={!canContinue}
            class="mt-7 w-full rounded-full px-6 py-3.5 text-sm font-semibold transition-all hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-none"
            style="background: var(--lime); color: var(--paper);"
          >
            Continue
          </button>
        {:else}
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label
              class="cursor-pointer rounded-xl border px-4 py-4 text-center text-sm font-medium transition-colors"
              style="border-color: {level === 'fresher' ? 'var(--lime)' : 'var(--line)'}; background: {level === 'fresher' ? 'var(--lime-tint)' : 'var(--surface-2)'}; color: var(--ink);"
            >
              <input type="radio" name="level" value="fresher" bind:group={level} class="sr-only" />
              Fresher
            </label>
            <label
              class="cursor-pointer rounded-xl border px-4 py-4 text-center text-sm font-medium transition-colors"
              style="border-color: {level === 'switcher' ? 'var(--lime)' : 'var(--line)'}; background: {level === 'switcher' ? 'var(--lime-tint)' : 'var(--surface-2)'}; color: var(--ink);"
            >
              <input type="radio" name="level" value="switcher" bind:group={level} class="sr-only" />
              Career switcher
            </label>
          </div>

          <div class="mt-7 flex flex-col-reverse gap-3 sm:flex-row">
            <button
              type="button"
              on:click={goBack}
              class="w-full rounded-full border px-6 py-3.5 text-sm font-semibold transition-colors hover:bg-[var(--surface-2)] sm:w-auto sm:flex-1"
              style="border-color: var(--line); color: var(--ink);"
            >
              Back
            </button>
            <button
              type="button"
              on:click={submit}
              disabled={!canSubmit}
              class="w-full rounded-full px-6 py-3.5 text-sm font-semibold transition-all hover:-translate-y-0.5 hover:shadow-lg disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:shadow-none sm:flex-1"
              style="background: var(--lime); color: var(--paper);"
            >
              Submit
            </button>
          </div>
        {/if}
      {/if}
    </div>
  </div>
{/if}
