function toggleToc(this: HTMLElement) {
  this.classList.toggle("collapsed")
  this.setAttribute(
    "aria-expanded",
    this.getAttribute("aria-expanded") === "true" ? "false" : "true",
  )
  const content = this.nextElementSibling as HTMLElement | undefined
  if (!content) return
  content.classList.toggle("collapsed")
}

function setupToc() {
  for (const toc of document.getElementsByClassName("toc")) {
    const button = toc.querySelector(".toc-header")
    const content = toc.querySelector(".toc-content")
    if (!button || !content) return
    button.addEventListener("click", toggleToc)
    window.addCleanup(() => button.removeEventListener("click", toggleToc))
  }
}

// Scroll spy: highlight closest header to viewport top
function setupScrollSpy() {
  const headers = document.querySelectorAll("h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]")
  if (headers.length === 0) return

  let ticking = false

  function updateActiveHeader() {
    const scrollY = window.scrollY
    const viewportTop = scrollY + 100 // offset for fixed nav

    let activeHeader: Element | null = null
    let minDistance = Infinity

    // Find header closest to (but above) viewport top
    headers.forEach((header) => {
      const rect = header.getBoundingClientRect()
      const headerTop = rect.top + scrollY

      // Header must be above or at viewport top (with some tolerance)
      if (headerTop <= viewportTop + 50) {
        const distance = viewportTop - headerTop
        if (distance < minDistance) {
          minDistance = distance
          activeHeader = header
        }
      }
    })

    // If no header above viewport, use first header if near top
    if (!activeHeader && scrollY < 200) {
      activeHeader = headers[0]
    }

    // Update TOC links
    document.querySelectorAll(".toc a").forEach((link) => {
      link.classList.remove("active", "in-view")
    })

    if (activeHeader) {
      const slug = activeHeader.id
      const tocLink = document.querySelector(`.toc a[data-for="${slug}"]`)
      if (tocLink) {
        tocLink.classList.add("active")
      }
    }

    ticking = false
  }

  function onScroll() {
    if (!ticking) {
      requestAnimationFrame(updateActiveHeader)
      ticking = true
    }
  }

  window.addEventListener("scroll", onScroll, { passive: true })
  window.addCleanup(() => window.removeEventListener("scroll", onScroll))

  // Initial update
  updateActiveHeader()
}

document.addEventListener("nav", () => {
  setupToc()
  setupScrollSpy()
})
