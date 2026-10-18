<script>
  import { afterUpdate, onDestroy, tick } from 'svelte'

  export let open = false
  export let steps = []
  export let onComplete = () => {}

  let activeSteps = []
  let stepIndex = 0
  let targetRect = null
  let tooltipStyle = ''
  let wasOpen = false
  let tooltipEl
  let previouslyFocused
  let positionTimer

  $: currentStep = activeSteps[stepIndex]

  function findTarget() {
    return currentStep ? document.querySelector(currentStep.selector) : null
  }

  function updatePosition() {
    const target = findTarget()
    if (!target) {
      targetRect = null
      return
    }

    const rect = target.getBoundingClientRect()
    const padding = 8
    const left = Math.max(8, rect.left - padding)
    const top = Math.max(8, rect.top - padding)
    const right = Math.min(window.innerWidth - 8, rect.right + padding)
    const bottom = Math.min(window.innerHeight - 8, rect.bottom + padding)
    targetRect = { left, top, right, bottom }

    const tooltipHeight = tooltipEl?.getBoundingClientRect().height ?? 220
    const tooltipWidth = Math.min(360, window.innerWidth - 32)
    const tooltipLeft = Math.max(16, Math.min(window.innerWidth - tooltipWidth - 16, rect.left + (rect.width - tooltipWidth) / 2))
    const placeBelow = rect.bottom + tooltipHeight + 24 < window.innerHeight
    const tooltipTop = placeBelow
      ? Math.min(window.innerHeight - tooltipHeight - 16, bottom + 16)
      : Math.max(16, top - tooltipHeight - 16)
    tooltipStyle = `left: ${tooltipLeft}px; top: ${tooltipTop}px; width: ${tooltipWidth}px;`
  }

  async function showStep(index) {
    stepIndex = index
    await tick()
    updatePosition()
    findTarget()?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
    clearTimeout(positionTimer)
    positionTimer = setTimeout(updatePosition, 280)
  }

  async function begin() {
    previouslyFocused = document.activeElement
    activeSteps = steps.filter((step) => document.querySelector(step.selector))
    if (!activeSteps.length) {
      onComplete()
      return
    }
    await showStep(0)
    await tick()
    tooltipEl?.querySelector('.tour-skip')?.focus()
  }

  function next() {
    if (stepIndex === activeSteps.length - 1) {
      onComplete()
      return
    }
    void showStep(stepIndex + 1)
  }

  function back() {
    if (stepIndex > 0) void showStep(stepIndex - 1)
  }

  function handleKeydown(event) {
    if (!open) return
    if (event.key === 'Escape') {
      onComplete()
      return
    }
    if (event.key === 'Tab') {
      const buttons = [...(tooltipEl?.querySelectorAll('button:not(:disabled)') ?? [])]
      const first = buttons[0]
      const last = buttons[buttons.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
  }

  afterUpdate(() => {
    if (open && !wasOpen) {
      wasOpen = true
      void begin()
    } else if (!open && wasOpen) {
      wasOpen = false
      activeSteps = []
      targetRect = null
      previouslyFocused?.focus?.()
    }
  })

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('keydown', handleKeydown)
  }

  onDestroy(() => {
    clearTimeout(positionTimer)
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('keydown', handleKeydown)
    }
  })
</script>

{#if open && currentStep && targetRect}
  <div class="tour-shade tour-top" style="height: {targetRect.top}px;"></div>
  <div
    class="tour-shade tour-left"
    style="top: {targetRect.top}px; width: {targetRect.left}px; height: {targetRect.bottom - targetRect.top}px;"
  ></div>
  <div
    class="tour-shade tour-right"
    style="top: {targetRect.top}px; left: {targetRect.right}px; height: {targetRect.bottom - targetRect.top}px;"
  ></div>
  <div class="tour-shade tour-bottom" style="top: {targetRect.bottom}px;"></div>
  <div
    class="tour-highlight"
    style="left: {targetRect.left}px; top: {targetRect.top}px; width: {targetRect.right - targetRect.left}px; height: {targetRect.bottom - targetRect.top}px;"
    aria-hidden="true"
  ></div>

  <div
    bind:this={tooltipEl}
    class="tour-card"
    style={tooltipStyle}
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-labelledby="tour-title"
    aria-describedby="tour-description"
  >
    <div class="flex items-center justify-between gap-4">
      <span class="text-xs font-semibold uppercase tracking-[0.16em]" style="color: var(--lime);">
        Product tour
      </span>
      <button type="button" class="tour-skip" on:click={onComplete}>Skip tour</button>
    </div>

    <h2 id="tour-title" class="mt-3 font-display text-xl font-semibold">{currentStep.title}</h2>
    <p id="tour-description" class="mt-2 text-sm leading-relaxed" style="color: var(--ink-soft);">
      {currentStep.description}
    </p>

    <div class="mt-5 flex items-center gap-3">
      <div class="flex flex-1 gap-1.5" aria-label="Step {stepIndex + 1} of {activeSteps.length}">
        {#each activeSteps as _, index}
          <span class:current={index === stepIndex} class="tour-progress-segment"></span>
        {/each}
      </div>
      <span class="text-xs font-medium" style="color: var(--ink-soft);">{stepIndex + 1} / {activeSteps.length}</span>
    </div>

    <div class="mt-5 flex items-center justify-between gap-3">
      <button type="button" class="tour-back" on:click={back} disabled={stepIndex === 0}>Back</button>
      <button type="button" class="tour-next" on:click={next}>
        {stepIndex === activeSteps.length - 1 ? 'Finish' : 'Next'}
      </button>
    </div>
  </div>
{/if}

<style>
  .tour-shade {
    position: fixed;
    z-index: 80;
    background: rgb(10 11 14 / 72%);
  }

  .tour-top,
  .tour-bottom {
    inset-inline: 0;
  }

  .tour-bottom {
    bottom: 0;
  }

  .tour-left {
    left: 0;
  }

  .tour-right {
    right: 0;
  }

  .tour-highlight {
    position: fixed;
    z-index: 81;
    border: 2px solid var(--lime);
    border-radius: 12px;
    box-shadow: 0 0 0 3px rgb(207 255 61 / 20%), 0 0 24px rgb(207 255 61 / 20%);
    pointer-events: none;
    transition: all 180ms ease;
  }

  .tour-card {
    position: fixed;
    z-index: 82;
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 20px;
    background: var(--surface);
    color: var(--ink);
    box-shadow: 0 18px 60px rgb(0 0 0 / 40%);
    max-height: calc(100vh - 32px);
    overflow-y: auto;
  }

  .tour-skip,
  .tour-back {
    border-radius: 999px;
    padding: 8px 12px;
    color: var(--ink-soft);
    font-size: 13px;
    font-weight: 600;
    transition: color 160ms ease, background 160ms ease;
  }

  .tour-skip:hover,
  .tour-back:not(:disabled):hover {
    background: var(--surface-2);
    color: var(--ink);
  }

  .tour-back:disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }

  .tour-next {
    border-radius: 999px;
    padding: 9px 18px;
    background: var(--lime);
    color: var(--paper);
    font-size: 13px;
    font-weight: 700;
    transition: transform 160ms ease;
  }

  .tour-next:hover {
    transform: translateY(-1px);
  }

  .tour-progress-segment {
    height: 4px;
    flex: 1;
    border-radius: 999px;
    background: var(--line);
  }

  .tour-progress-segment.current {
    background: var(--lime);
  }

  @media (max-width: 480px) {
    .tour-card {
      padding: 16px;
    }
  }
</style>
