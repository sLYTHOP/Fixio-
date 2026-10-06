<script>
  import { onMount } from 'svelte'
  import { UploadCloud, FileText } from '@lucide/svelte'
  import { trackEvent } from './analytics.js'

  export let onFileReady = () => {}
  export let autoOpen = true

  let dragOver = false
  let error = ''
  let inputEl
  let selectedFile = null

  onMount(() => {
    // Skip the extra click: open the native file picker immediately.
    // If the person cancels it, the dropzone below is still there as a fallback.
    if (autoOpen) setTimeout(() => inputEl?.click(), 50)
  })

  const MAX_SIZE = 8 * 1024 * 1024 // 8MB
  const ACCEPTED_EXT = ['.pdf', '.docx']

  function formatSize(bytes) {
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  }

  function validate(file) {
    const nameOk = ACCEPTED_EXT.some(ext => file.name.toLowerCase().endsWith(ext))
    if (!nameOk) return 'Please upload a PDF or DOCX file.'
    if (file.size > MAX_SIZE) return 'File is too large — max 8MB.'
    return ''
  }

  function handleFile(file) {
    const err = validate(file)
    if (err) {
      error = err
      trackEvent('resume_upload_rejected', { reason: err })
      return
    }
    error = ''
    selectedFile = file
    trackEvent('resume_upload_selected', { size: file.size, type: file.type })
    // brief confirmation beat before handing off, feels less abrupt than an instant modal swap
    setTimeout(() => onFileReady(file), 450)
  }

  function onDrop(e) {
    e.preventDefault()
    dragOver = false
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  function onInputChange(e) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }
</script>

<div
  role="button"
  tabindex="0"
  on:click={() => !selectedFile && inputEl.click()}
  on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && !selectedFile && inputEl.click()}
  on:dragover={(e) => { e.preventDefault(); dragOver = true }}
  on:dragleave={() => (dragOver = false)}
  on:drop={onDrop}
  class="cursor-pointer rounded-2xl border-2 border-dashed px-8 py-12 text-center transition-all duration-200"
  style="border-color: {dragOver ? 'var(--lime)' : selectedFile ? 'var(--lime)' : 'var(--line)'};
         background: {dragOver ? 'var(--lime-tint)' : selectedFile ? 'var(--lime-tint)' : 'var(--surface-2)'};
         transform: {dragOver ? 'scale(1.01)' : 'scale(1)'};
         color: var(--ink);"
>
  <input
    bind:this={inputEl}
    type="file"
    accept=".pdf,.docx"
    class="hidden"
    on:change={onInputChange}
  />

  {#if selectedFile}
    <div class="flex items-center justify-center">
      <div class="w-11 h-11 rounded-full flex items-center justify-center" style="background: var(--lime);">
        <FileText size={20} color="var(--paper)" />
      </div>
    </div>
    <p class="font-display font-semibold text-lg mt-3">{selectedFile.name}</p>
    <p class="mt-1 text-sm" style="color: var(--ink-soft);">{formatSize(selectedFile.size)} · looking good</p>
  {:else}
    <div class="flex items-center justify-center">
      <div
        class="w-11 h-11 rounded-full flex items-center justify-center transition-transform"
        style="background: var(--lime-tint); transform: {dragOver ? 'translateY(-3px)' : 'translateY(0)'};"
      >
        <UploadCloud size={20} color="var(--lime)" />
      </div>
    </div>
    <p class="font-display font-semibold text-lg mt-3">Drop your resume here</p>
    <p class="mt-1 text-sm" style="color: var(--ink-soft);">or click to browse — PDF or DOCX, up to 8MB</p>
  {/if}

  {#if error}
    <p class="mt-4 text-sm font-medium" style="color: var(--coral);">{error}</p>
  {/if}
</div>
