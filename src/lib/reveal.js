export function reveal(node, options = {}) {
  const delay = options.delay || 0
  node.classList.add('reveal')
  node.style.transitionDelay = `${delay}ms`

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          node.classList.add('reveal-in')
          observer.unobserve(node)
        }
      })
    },
    { threshold: 0.15 }
  )
  observer.observe(node)

  return {
    destroy() {
      observer.disconnect()
    },
  }
}
