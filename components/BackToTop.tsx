import { QuartzComponent, QuartzComponentConstructor } from "../quartz/components/types"

export default (() => {
  const BackToTop: QuartzComponent = () => {
    return (
      <button class="back-to-top" id="back-to-top" aria-label="Back to top" title="Back to top">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="18 15 12 9 6 15"></polyline>
        </svg>
      </button>
    )
  }

  BackToTop.css = `
.back-to-top {
  position: fixed;
  bottom: 2rem;
  right: 2rem;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #0d0d0d;
  border: 1px dashed rgba(255, 255, 255, 0.25);
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  opacity: 0;
  visibility: hidden;
  transition: all 200ms ease;
  z-index: 999;
}

.back-to-top.visible {
  opacity: 1;
  visibility: visible;
}

.back-to-top:hover {
  border-color: rgba(255, 255, 255, 0.5);
  color: #ffffff;
  background: rgba(255, 255, 255, 0.05);
}

@media (max-width: 768px) {
  .back-to-top {
    bottom: 1rem;
    right: 1rem;
    width: 36px;
    height: 36px;
  }
}
`

  BackToTop.afterDOMLoaded = `
document.addEventListener("nav", () => {
  const btn = document.getElementById("back-to-top")
  if (!btn) return

  let ticking = false

  function updateVisibility() {
    if (window.scrollY > 500) {
      btn.classList.add("visible")
    } else {
      btn.classList.remove("visible")
    }
    ticking = false
  }

  function onScroll() {
    if (!ticking) {
      requestAnimationFrame(updateVisibility)
      ticking = true
    }
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  window.addEventListener("scroll", onScroll, { passive: true })
  btn.addEventListener("click", scrollToTop)

  window.addCleanup(() => {
    window.removeEventListener("scroll", onScroll)
    btn.removeEventListener("click", scrollToTop)
  })

  // Initial check
  updateVisibility()
})
`

  return BackToTop
}) satisfies QuartzComponentConstructor
