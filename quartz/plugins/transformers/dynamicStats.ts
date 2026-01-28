import { QuartzTransformerPlugin } from "../types"
import { visit } from "unist-util-visit"
import { Root, Element } from "hast"
import { h } from "hastscript"
import fs from "fs"
import path from "path"
import matter from "gray-matter"

export interface DynamicStatsOptions {
  contentPath?: string
}

const defaultOptions: DynamicStatsOptions = {
  contentPath: "content"
}

function countWriteupsAndTags(folderPath: string): { total: number; tagCounts: Record<string, number> } {
  const result = { total: 0, tagCounts: {} as Record<string, number> }

  // Vulnerability tags we want to track
  const vulnTags = new Set([
    'broken-access-control', 'idor', 'xxe', 'xss', 'sqli', 'business-logic',
    'ssrf', 'rce', 'lfi', 'csrf', 'auth-bypass', 'injection'
  ])

  try {
    const files = fs.readdirSync(folderPath)

    for (const file of files) {
      if (file.endsWith('.md') && file !== 'index.md') {
        result.total++ // Count ALL writeups regardless of tags

        const filePath = path.join(folderPath, file)
        const content = fs.readFileSync(filePath, 'utf-8')
        const { data } = matter(content)

        if (data.tags && Array.isArray(data.tags)) {
          for (const tag of data.tags) {
            const normalizedTag = tag.toLowerCase()
            // Only count vulnerability-specific tags
            if (vulnTags.has(normalizedTag)) {
              result.tagCounts[normalizedTag] = (result.tagCounts[normalizedTag] || 0) + 1
            }
          }
        }
      }
    }
  } catch (error) {
    console.error(`Error reading folder ${folderPath}:`, error)
  }

  return result
}

function formatTagLabel(tag: string): string {
  const labelMap: Record<string, string> = {
    'broken-access-control': 'BAC',
    'idor': 'IDOR',
    'xxe': 'XXE',
    'business-logic': 'Business Logic',
    'api-enumeration': 'API Enum',
    'websockets': 'WebSockets',
    'xss': 'XSS',
    'sqli': 'SQLi'
  }

  return labelMap[tag] || tag.toUpperCase()
}

export const DynamicStats: QuartzTransformerPlugin<DynamicStatsOptions> = (userOpts) => {
  const opts = { ...defaultOptions, ...userOpts }

  return {
    name: "DynamicStats",
    htmlPlugins() {
      return [
        () => {
          return async (tree: Root, file) => {
            // Only process BugForge index.md
            if (!file.data.filePath?.includes('BugForge/index.md')) {
              return
            }

            // Calculate the path to BugForge folder
            const rootPath = process.cwd()
            const bugforgePath = path.join(rootPath, opts.contentPath!, 'BugForge')

            // Count writeups and tags
            const { total, tagCounts } = countWriteupsAndTags(bugforgePath)

            // Sort tags by count and get top ones
            const sortedTags = Object.entries(tagCounts)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 3) // Show top 3 vulnerability types

            visit(tree, "element", (node: Element) => {
              // Find and replace the stats-header div
              if (node.tagName === "div" && node.properties?.className?.includes("stats-header")) {
                // Create new dynamic stats
                const statsItems = [
                  { value: total.toString(), label: "Writeups" },
                  ...sortedTags.map(([tag, count]) => ({
                    value: count.toString(),
                    label: formatTagLabel(tag)
                  }))
                ]

                // If we have less than 4 items, add a placeholder
                while (statsItems.length < 4) {
                  const remainingTags = Object.entries(tagCounts)
                    .filter(([tag]) => !sortedTags.some(([t]) => t === tag))

                  if (remainingTags.length > 0) {
                    const [tag, count] = remainingTags[0]
                    statsItems.push({
                      value: count.toString(),
                      label: formatTagLabel(tag)
                    })
                  } else {
                    break
                  }
                }

                // Replace the node's children with dynamic content
                node.children = statsItems.map(item =>
                  h("div", { className: "stat-item" }, [
                    h("span", { className: "stat-value" }, item.value),
                    h("span", { className: "stat-label" }, item.label)
                  ])
                )
              }
            })
          }
        }
      ]
    }
  }
}