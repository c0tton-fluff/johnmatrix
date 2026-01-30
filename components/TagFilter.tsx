import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "../quartz/components/types"

const VULN_TAGS = ["idor", "xss", "sqli", "xxe", "ssrf", "rce", "bac", "business-logic", "auth-bypass", "lfi", "deserialization"]

export default (() => {
  const TagFilter: QuartzComponent = ({ fileData, allFiles }: QuartzComponentProps) => {
    // Only show on folder pages
    const slug = fileData.slug ?? ""
    const isFolderPage = slug.endsWith("index") || !slug.includes("/") ||
      ["BugForge", "Hackthebox", "Pwnedlabs", "TryHackMe"].some(f => slug === f)

    if (!isFolderPage) return null

    // Collect tags from pages in this folder
    const folderPrefix = slug.replace(/\/index$/, "").replace(/index$/, "")
    const pagesInFolder = allFiles.filter(f => {
      const pageSlug = f.slug ?? ""
      if (folderPrefix === "") return true
      return pageSlug.startsWith(folderPrefix + "/") && pageSlug !== folderPrefix + "/index"
    })

    const availableTags = new Set<string>()
    pagesInFolder.forEach(page => {
      const tags = page.frontmatter?.tags as string[] | undefined
      const vuln = page.frontmatter?.vuln as string | undefined
      if (tags) {
        tags.forEach(t => {
          if (VULN_TAGS.includes(t.toLowerCase())) {
            availableTags.add(t.toLowerCase())
          }
        })
      }
      if (vuln && VULN_TAGS.includes(vuln.toLowerCase())) {
        availableTags.add(vuln.toLowerCase())
      }
    })

    if (availableTags.size === 0) return null

    const sortedTags = Array.from(availableTags).sort()

    return (
      <div class="tag-filter">
        <button class="tag-filter-btn active" data-tag="all">All</button>
        {sortedTags.map(tag => (
          <button class="tag-filter-btn" data-tag={tag}>{tag.toUpperCase()}</button>
        ))}
      </div>
    )
  }

  TagFilter.css = `
.tag-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 1.5rem 0;
  justify-content: center;
}

.tag-filter-btn {
  background: transparent;
  border: 1px dashed rgba(255, 255, 255, 0.2);
  color: rgba(255, 255, 255, 0.6);
  padding: 0.4rem 0.8rem;
  font-size: 0.7rem;
  font-family: 'JetBrains Mono', monospace;
  letter-spacing: 0.05em;
  cursor: pointer;
  transition: all 150ms ease;
}

.tag-filter-btn:hover {
  border-color: rgba(255, 255, 255, 0.4);
  color: #ffffff;
}

.tag-filter-btn.active {
  border-color: #cda54b;
  color: #cda54b;
  background: rgba(205, 165, 75, 0.1);
}

.section-li.tag-hidden {
  display: none !important;
}
`

  TagFilter.afterDOMLoaded = `
document.addEventListener("nav", () => {
  const filterBtns = document.querySelectorAll(".tag-filter-btn")
  if (filterBtns.length === 0) return

  filterBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const tag = btn.getAttribute("data-tag")

      // Update active state
      filterBtns.forEach(b => b.classList.remove("active"))
      btn.classList.add("active")

      // Filter items
      const items = document.querySelectorAll(".section-li")
      items.forEach(item => {
        if (tag === "all") {
          item.classList.remove("tag-hidden")
          return
        }

        // Check data-tags attribute or link text
        const link = item.querySelector("a")
        const itemTags = item.getAttribute("data-tags")?.toLowerCase() || ""
        const linkText = link?.textContent?.toLowerCase() || ""

        // Match against tag
        if (itemTags.includes(tag) || linkText.includes(tag)) {
          item.classList.remove("tag-hidden")
        } else {
          item.classList.add("tag-hidden")
        }
      })
    })
  })
})
`

  return TagFilter
}) satisfies QuartzComponentConstructor
