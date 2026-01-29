import { QuartzComponent, QuartzComponentConstructor, QuartzComponentProps } from "./types"

const Header: QuartzComponent = ({ children }: QuartzComponentProps) => {
  return children.length > 0 ? <header class="page-header-nav">{children}</header> : null
}

Header.css = `
.page-header-nav {
  display: block;
  width: 100%;
  margin: 0;
  padding: 0;
}
`

export default (() => Header) satisfies QuartzComponentConstructor
