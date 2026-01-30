import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "../quartz/components/types"

export default (() => {
  const ReadingProgress: QuartzComponent = ({ fileData }: QuartzComponentProps) => {
    // Only show on content pages, not folder/index pages
    const slug = fileData.slug ?? ""
    if (slug === "index" || slug.endsWith("/index")) return null

    return <div class="reading-progress" id="reading-progress"></div>
  }

  ReadingProgress.css = `
.reading-progress {
  position: fixed;
  top: 0;
  left: 0;
  width: 0%;
  height: 2px;
  background: linear-gradient(90deg, #cda54b, #f4d03f);
  z-index: 1001;
  transition: width 50ms ease-out;
  pointer-events: none;
}
`

  ReadingProgress.afterDOMLoaded = `
document.addEventListener("nav", () => {
  const progressBar = document.getElementById("reading-progress")
  if (!progressBar) return

  let ticking = false

  function updateProgress() {
    const docHeight = document.documentElement.scrollHeight - window.innerHeight
    const scrolled = window.scrollY
    const progress = docHeight > 0 ? (scrolled / docHeight) * 100 : 0
    progressBar.style.width = Math.min(100, Math.max(0, progress)) + "%"
    ticking = false
  }

  function onScroll() {
    if (!ticking) {
      requestAnimationFrame(updateProgress)
      ticking = true
    }
  }

  window.addEventListener("scroll", onScroll, { passive: true })
  window.addCleanup(() => window.removeEventListener("scroll", onScroll))

  // Initial
  updateProgress()
})
`

  return ReadingProgress
}) satisfies QuartzComponentConstructor
