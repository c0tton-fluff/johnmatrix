import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "../quartz/components/types"

interface NavLink {
  label: string
  href: string
}

interface TopNavOptions {
  links?: NavLink[]
}

const defaultLinks: NavLink[] = [
  { label: "Home", href: "/" },
  { label: "Methodology", href: "/Methodology" },
  { label: "BugForge", href: "/BugForge" },
  { label: "Hackthebox", href: "/Hackthebox" },
]

export default ((opts?: TopNavOptions) => {
  const links = opts?.links ?? defaultLinks

  const TopNav: QuartzComponent = ({ displayClass, fileData }: QuartzComponentProps) => {
    const currentSlug = "/" + (fileData.slug === "index" ? "" : fileData.slug ?? "")

    return (
      <nav class={`top-nav ${displayClass ?? ""}`}>
        <div class="top-nav-links">
          {links.map((link) => {
            const isActive = currentSlug === link.href ||
              (link.href !== "/" && currentSlug.startsWith(link.href))
            return (
              <a href={link.href} class={`top-nav-link ${isActive ? "active" : ""}`}>
                {link.label}
              </a>
            )
          })}
        </div>
        <div class="top-nav-right">
          <button class="top-nav-search" id="top-nav-search-btn" aria-label="Search">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          </button>
        </div>
      </nav>
    )
  }

  TopNav.css = `
.top-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 2rem;
  background: #0d0d0d;
  border-bottom: 1px dashed rgba(255, 255, 255, 0.1);
  position: sticky;
  top: 0;
  z-index: 1000;
  width: 100%;
  box-sizing: border-box;
}

.top-nav-links {
  display: flex;
  gap: 2rem;
  align-items: center;
}

.top-nav-link {
  color: #e8e6e3;
  text-decoration: none;
  font-size: 0.85rem;
  font-weight: 500;
  letter-spacing: 0.05em;
  transition: color 150ms ease;
  background: none !important;
  padding: 0 !important;
}

.top-nav-link:hover {
  color: #f5f0e8;
}

.top-nav-link.active {
  color: #ffffff;
  border-bottom: 1px dashed rgba(255, 255, 255, 0.5);
  padding-bottom: 2px;
}

.top-nav-right {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.top-nav-search {
  background: transparent;
  border: none;
  color: #e8e6e3;
  cursor: pointer;
  padding: 0.5rem;
  transition: color 150ms ease;
}

.top-nav-search:hover {
  color: #f5f0e8;
}

@media (max-width: 600px) {
  .top-nav {
    padding: 0.75rem 1rem;
  }

  .top-nav-links {
    gap: 1rem;
  }

  .top-nav-link {
    font-size: 0.75rem;
  }
}
`

  TopNav.afterDOMLoaded = `
document.getElementById('top-nav-search-btn')?.addEventListener('click', () => {
  const searchContainer = document.getElementById('search-container')
  if (searchContainer) {
    searchContainer.classList.add('active')
    const input = searchContainer.querySelector('input')
    if (input) input.focus()
  }
})
`

  return TopNav
}) satisfies QuartzComponentConstructor
