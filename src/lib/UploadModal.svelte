<script>
  import UploadPanel from './UploadPanel.svelte'

  export let open = false
  export let onClose = () => {}
  export let onFileReady = () => {}

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
      class="rounded-2xl max-w-md w-full p-8 relative"
      on:click|stopPropagation
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-labelledby="upload-title"
      style="background: var(--surface); color: var(--ink); border: 1px solid var(--line);"
    >
      <button
        on:click={onClose}
        aria-label="Close"
        class="absolute top-4 right-4 text-sm font-semibold w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--surface-2)]"
      >
        ✕
      </button>

      <h2 id="upload-title" class="font-display text-2xl font-bold tracking-tight">
        Let's see your resume
      </h2>
      <p class="mt-2 text-sm" style="color: var(--ink-soft);">
        Upload it, then sign in with Google to see your feedback.
      </p>

      <div class="mt-6">
        <UploadPanel {onFileReady} />
      </div>
    </div>
  </div>
{/if}
