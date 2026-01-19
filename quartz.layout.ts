import { PageLayout, SharedLayout } from "./quartz/cfg"
import * as Component from "./quartz/components"

// components shared across all pages
export const sharedPageComponents: SharedLayout = {
  head: Component.Head(),
  header: [],
  afterBody: [],
  footer: Component.Footer({
    links: {
      GitHub: "https://github.com/jackyzha0/quartz",
      "Discord Community": "https://discord.gg/cRFFHYye7t",
    },
  }),
}

// Simple sorter: pin "Methodology" first, then folders before files, then alphabetical
const pinMethodologyFirst = (a: any, b: any) => {
  const A = String(a.displayName ?? "").toLowerCase()
  const B = String(b.displayName ?? "").toLowerCase()

  if (A === "methodology" && B !== "methodology") return -1
  if (B === "methodology" && A !== "methodology") return 1

  if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1

  return String(a.displayName ?? "").localeCompare(String(b.displayName ?? ""), undefined, {
    numeric: true,
    sensitivity: "base",
  })
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
    Component.ProfileCard(),
    Component.PageTitle(),
    Component.MobileOnly(Component.Spacer()),
    Component.Flex({
      components: [
        { Component: Component.Search(), grow: true },
        { Component: Component.Darkmode() },
        { Component: Component.ReaderMode() },
      ],
    }),
    Component.Explorer({
      title: "Explore ...",
      folderClickBehavior: "link",
      sortFn: pinMethodologyFirst,
    }),
  ],
  right: [Component.DesktopOnly(Component.TableOfContents())],
}

// components for pages that display lists of pages (e.g. tags or folders)
export const defaultListPageLayout: PageLayout = {
  beforeBody: [Component.Breadcrumbs(), Component.ArticleTitle(), Component.ContentMeta()],
  left: [
    Component.ProfileCard(),
    Component.PageTitle(),
    Component.MobileOnly(Component.Spacer()),
    Component.Flex({
      components: [
        { Component: Component.Search(), grow: true },
        { Component: Component.Darkmode() },
      ],
    }),
    Component.Explorer({
      title: "Explore ...",
      folderClickBehavior: "link",
      sortFn: pinMethodologyFirst,
    }),
  ],
  right: [],
}
