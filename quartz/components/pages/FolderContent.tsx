import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "../types"

import style from "../styles/listPage.scss"
import { PageList, SortFn } from "../PageList"
import { Root } from "hast"
import { htmlToJsx } from "../../util/jsx"
import { QuartzPluginData } from "../../plugins/vfile"
import { ComponentChildren } from "preact"
import { concatenateResources } from "../../util/resources"
import { trieFromAllFiles } from "../../util/ctx"

const VULN_TAGS = ["idor", "xss", "sqli", "xxe", "ssrf", "rce", "bac", "business-logic", "auth-bypass", "lfi", "deserialization"]

interface FolderContentOptions {
  /**
   * Whether to display number of folders
   */
  showFolderCount: boolean
  showSubfolders: boolean
  sort?: SortFn
}

const defaultOptions: FolderContentOptions = {
  showFolderCount: true,
  showSubfolders: true,
}

export default ((opts?: Partial<FolderContentOptions>) => {
  const options: FolderContentOptions = { ...defaultOptions, ...opts }

  const FolderContent: QuartzComponent = (props: QuartzComponentProps) => {
    const { tree, fileData, allFiles, cfg } = props

    const trie = (props.ctx.trie ??= trieFromAllFiles(allFiles))
    const folder = trie.findNode(fileData.slug!.split("/"))
    if (!folder) {
      return null
    }

    const allPagesInFolder: QuartzPluginData[] =
      folder.children
        .map((node) => {
          // regular file, proceed
          if (node.data) {
            return node.data
          }

          if (node.isFolder && options.showSubfolders) {
            // folders that dont have data need synthetic files
            const getMostRecentDates = (): QuartzPluginData["dates"] => {
              let maybeDates: QuartzPluginData["dates"] | undefined = undefined
              for (const child of node.children) {
                if (child.data?.dates) {
                  // compare all dates and assign to maybeDates if its more recent or its not set
                  if (!maybeDates) {
                    maybeDates = { ...child.data.dates }
                  } else {
                    if (child.data.dates.created > maybeDates.created) {
                      maybeDates.created = child.data.dates.created
                    }

                    if (child.data.dates.modified > maybeDates.modified) {
                      maybeDates.modified = child.data.dates.modified
                    }

                    if (child.data.dates.published > maybeDates.published) {
                      maybeDates.published = child.data.dates.published
                    }
                  }
                }
              }
              return (
                maybeDates ?? {
                  created: new Date(),
                  modified: new Date(),
                  published: new Date(),
                }
              )
            }

            return {
              slug: node.slug,
              dates: getMostRecentDates(),
              frontmatter: {
                title: node.displayName,
                tags: [],
              },
            }
          }
        })
        .filter((page) => page !== undefined) ?? []
    const cssClasses: string[] = fileData.frontmatter?.cssclasses ?? []
    const classes = cssClasses.join(" ")
    const listProps = {
      ...props,
      sort: options.sort,
      allFiles: allPagesInFolder,
    }

    const content = (
      (tree as Root).children.length === 0
        ? fileData.description
        : htmlToJsx(fileData.filePath!, tree)
    ) as ComponentChildren
    const showFolderIntro =
      (tree as Root).children.length === 0 && !fileData.description

    // Collect available vuln tags from pages in folder
    const availableTags = new Set<string>()
    allPagesInFolder.forEach(page => {
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
    const sortedTags = Array.from(availableTags).sort()
    const showTagFilter = sortedTags.length > 0

    return (
      <div class="popover-hint">
        <article class={classes}>{content}</article>
        {showTagFilter && (
          <div class="tag-filter">
            <button class="tag-filter-btn active" data-tag="all">All</button>
            {sortedTags.map(tag => (
              <button class="tag-filter-btn" data-tag={tag}>{tag.toUpperCase()}</button>
            ))}
          </div>
        )}
        <div class="page-listing">
          {showFolderIntro && (
            <div class="folder-intro">
              Explore the writeups below.
            </div>
          )}
          <div>
            <PageList {...listProps} />
          </div>
        </div>
      </div>
    )
  }

  FolderContent.css = concatenateResources(style, PageList.css, `
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
`)

  FolderContent.afterDOMLoaded = `
document.addEventListener("nav", () => {
  const filterBtns = document.querySelectorAll(".tag-filter-btn")
  if (filterBtns.length === 0) return

  filterBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const tag = btn.getAttribute("data-tag")

      filterBtns.forEach(b => b.classList.remove("active"))
      btn.classList.add("active")

      const items = document.querySelectorAll(".section-li")
      items.forEach(item => {
        if (tag === "all") {
          item.classList.remove("tag-hidden")
          return
        }
        const itemTags = item.getAttribute("data-tags")?.toLowerCase() || ""
        if (itemTags.includes(tag)) {
          item.classList.remove("tag-hidden")
        } else {
          item.classList.add("tag-hidden")
        }
      })
    })
  })
})
`

  return FolderContent
}) satisfies QuartzComponentConstructor
