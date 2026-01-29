import { pathToRoot } from "../quartz/util/path"
import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "../quartz/components/types"
import { classNames } from "../quartz/util/lang"

const HomeButton: QuartzComponent = ({ fileData, displayClass }: QuartzComponentProps) => {
  const baseDir = pathToRoot(fileData.slug!)
  return (
    <a href={baseDir} class={classNames(displayClass, "home-button")}>
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        <polyline points="9 22 9 12 15 12 15 22"/>
      </svg>
      <span>Commando Manual</span>
    </a>
  )
}

HomeButton.css = `
.home-button {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.65rem 1rem;
  margin-bottom: 0.75rem;
  background: transparent;
  border: 1px dashed rgba(255, 255, 255, 0.2);
  border-radius: 0;
  color: var(--secondary);
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  text-decoration: none;
  transition: border-color 200ms ease, color 200ms ease;
  box-shadow: none;
}

.home-button:hover {
  background: transparent;
  border-color: rgba(245, 240, 232, 0.5);
  color: #f5f0e8;
  box-shadow: none;
  transform: none;
}

.home-button svg {
  opacity: 0.7;
  flex-shrink: 0;
}

.home-button:hover svg {
  opacity: 1;
}

@media (max-width: 900px) {
  .home-button {
    display: none;
  }
}
`

export default (() => HomeButton) satisfies QuartzComponentConstructor
