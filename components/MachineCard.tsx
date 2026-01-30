import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "../quartz/components/types"

interface MachineCardOptions {
  showOnFolders?: boolean
}

const defaultOptions: MachineCardOptions = {
  showOnFolders: false,
}

export default ((_opts?: MachineCardOptions) => {
  const MachineCard: QuartzComponent = ({ fileData }: QuartzComponentProps) => {
    const fm = fileData.frontmatter

    // Don't render if no metadata
    if (!fm?.difficulty && !fm?.status && !fm?.platform && !fm?.vuln) {
      return null
    }

    // Auto-detect platform from path if not specified
    const slug = fileData.slug ?? ""
    let platform = fm.platform as string | undefined
    if (!platform) {
      if (slug.startsWith("BugForge/")) platform = "bugforge"
      else if (slug.startsWith("Hackthebox/")) platform = "hackthebox"
      else if (slug.startsWith("Pwnedlabs/")) platform = "pwnedlabs"
      else if (slug.startsWith("TryHackMe/")) platform = "tryhackme"
    }

    const difficulty = fm.difficulty as string | undefined
    const status = fm.status as string | undefined
    const vuln = fm.vuln as string | undefined

    // Map difficulty to color
    const difficultyColors: Record<string, string> = {
      easy: "#2ecc71",
      medium: "#f39c12",
      hard: "#e74c3c",
      insane: "#9b59b6",
    }
    const diffColor = difficulty ? difficultyColors[difficulty.toLowerCase()] || "#ffffff" : undefined

    // Map status
    const statusIcons: Record<string, string> = {
      completed: "✓",
      "in-progress": "◐",
      todo: "○",
    }
    const statusIcon = status ? statusIcons[status.toLowerCase()] || "" : ""

    return (
      <div class="machine-card">
        {platform && (
          <div class="machine-card-item">
            <span class="machine-card-label">Platform</span>
            <span class="machine-card-value platform">{platform}</span>
          </div>
        )}
        {difficulty && (
          <div class="machine-card-item">
            <span class="machine-card-label">Difficulty</span>
            <span class="machine-card-value difficulty" style={`color: ${diffColor}`}>
              {difficulty}
            </span>
          </div>
        )}
        {status && (
          <div class="machine-card-item">
            <span class="machine-card-label">Status</span>
            <span class="machine-card-value status">
              {statusIcon} {status}
            </span>
          </div>
        )}
        {vuln && (
          <div class="machine-card-item">
            <span class="machine-card-label">Vuln Type</span>
            <span class="machine-card-value vuln">{vuln}</span>
          </div>
        )}
      </div>
    )
  }

  MachineCard.css = `
.machine-card {
  display: flex;
  flex-wrap: wrap;
  gap: 0;
  margin: 1rem 0 1.5rem 0;
  border: 1px dashed rgba(255, 255, 255, 0.25);
  background: transparent;
  width: fit-content;
}

.machine-card-item {
  display: flex;
  flex-direction: column;
  padding: 0.75rem 1.25rem;
  border-right: 1px dashed rgba(255, 255, 255, 0.15);
}

.machine-card-item:last-child {
  border-right: none;
}

.machine-card-label {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 0.25rem;
}

.machine-card-value {
  font-size: 0.85rem;
  font-weight: 500;
  color: #ffffff;
  text-transform: capitalize;
}

.machine-card-value.difficulty {
  font-weight: 600;
}

.machine-card-value.vuln {
  color: #cda54b;
  text-transform: uppercase;
  font-size: 0.75rem;
  letter-spacing: 0.05em;
}

@media (max-width: 600px) {
  .machine-card {
    flex-direction: column;
    width: 100%;
  }

  .machine-card-item {
    border-right: none;
    border-bottom: 1px dashed rgba(255, 255, 255, 0.15);
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
  }

  .machine-card-item:last-child {
    border-bottom: none;
  }

  .machine-card-label {
    margin-bottom: 0;
  }
}
`

  return MachineCard
}) satisfies QuartzComponentConstructor
