<script>
  import { trackEvent } from './analytics.js'

  export let onFileReady = () => {}

  let dragOver = false
  let error = ''
  let inputEl

  const MAX_SIZE = 8 * 1024 * 1024 // 8MB
  const ACCEPTED = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
  const ACCEPTED_EXT = ['.pdf', '.docx']

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
    trackEvent('resume_upload_selected', { size: file.size, type: file.type })
    onFileReady(file)
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
  on:click={() => inputEl.click()}
  on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && inputEl.click()}
  on:dragover={(e) => { e.preventDefault(); dragOver = true }}
  on:dragleave={() => (dragOver = false)}
  on:drop={onDrop}
  class="cursor-pointer rounded-2xl border-2 border-dashed px-8 py-12 text-center transition-colors"
  style="border-color: {dragOver ? 'var(--indigo)' : 'var(--line)'}; background: {dragOver ? 'color-mix(in srgb, var(--indigo) 6%, white)' : 'white'};"
>
  <input
    bind:this={inputEl}
    type="file"
    accept=".pdf,.docx"
    class="hidden"
    on:change={onInputChange}
  />
  <p class="font-display font-semibold text-lg">Drop your resume here</p>
  <p class="mt-1 text-sm" style="color: var(--ink-soft);">or click to browse — PDF or DOCX, up to 8MB</p>

  {#if error}
    <p class="mt-4 text-sm font-medium" style="color: var(--coral);">{error}</p>
  {/if}
</div>
