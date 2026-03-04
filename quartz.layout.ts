import { PageLayout, SharedLayout } from "./quartz/cfg"
import * as Component from "./quartz/components"

// components shared across all pages
export const sharedPageComponents: SharedLayout = {
  head: Component.Head(),
  header: [
    Component.ReadingProgress(),
    Component.TopNav({
      links: [
        { label: "Home", href: "/" },
        { label: "Methodology", href: "/Methodology" },
        { label: "Brain Sharing", href: "/Brain-Sharing" },
        { label: "BugForge", href: "/BugForge" },
        { label: "Hackthebox", href: "/Hackthebox" },
        { label: "HackingHub", href: "/HackingHub" },
        { label: "Pwnedlabs", href: "/Pwnedlabs" },
      ],
    }),
  ],
  afterBody: [Component.Backlinks(), Component.BackToTop()],
  footer: Component.Footer({
    links: {
      GitHub: "https://github.com/c0tton-fluff",
    },
  }),
}

// components for pages that display a single page (e.g. a single note)
export const defaultContentPageLayout: PageLayout = {
  beforeBody: [
    Component.MachineCard(),
    Component.ConditionalRender({
      component: Component.Breadcrumbs(),
      condition: (page) => page.fileData.slug !== "index",
    }),
    Component.ArticleTitle(),
    Component.TagList(),
  ],
  left: [
    Component.Search(),
  ],
  right: [
    Component.DesktopOnly(Component.TableOfContents()),
  ],
}

// components for pages that display lists of pages (e.g. tags or folders)
export const defaultListPageLayout: PageLayout = {
  beforeBody: [
    Component.Breadcrumbs(),
    Component.ArticleTitle(),
  ],
  left: [
    Component.Search(),
  ],
  right: [],
}
