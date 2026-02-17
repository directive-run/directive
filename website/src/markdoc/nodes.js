import { nodes as defaultNodes, Tag } from '@markdoc/markdoc'
import { slugifyWithCounter } from '@sindresorhus/slugify'
import yaml from 'js-yaml'

import { ChecklistItem } from '@/components/ChecklistItem'
import { DocumentLayout } from '@/components/DocumentLayout'
import { Fence } from '@/components/Fence'

let documentSlugifyMap = new Map()

// Validate frontmatter has required fields
function validateFrontmatter(frontmatter, filePath) {
  const errors = []

  if (!frontmatter) {
    errors.push('Missing frontmatter')
  } else {
    if (!frontmatter.title || typeof frontmatter.title !== 'string') {
      errors.push('Missing or invalid "title" in frontmatter')
    }
    if (!frontmatter.description || typeof frontmatter.description !== 'string') {
      errors.push('Missing or invalid "description" in frontmatter')
    }
  }

  if (errors.length > 0 && process.env.NODE_ENV === 'development') {
    console.warn(`\n⚠️  Frontmatter validation warnings${filePath ? ` in ${filePath}` : ''}:`)
    errors.forEach(err => console.warn(`   - ${err}`))
  }

  return errors
}

const nodes = {
  document: {
    ...defaultNodes.document,
    render: DocumentLayout,
    transform(node, config) {
      documentSlugifyMap.set(config, slugifyWithCounter())

      const frontmatter = yaml.load(node.attributes.frontmatter)
      validateFrontmatter(frontmatter, config?.file)

      return new Tag(
        this.render,
        {
          frontmatter,
          nodes: node.children,
        },
        node.transformChildren(config),
      )
    },
  },
  heading: {
    ...defaultNodes.heading,
    transform(node, config) {
      let slugify = documentSlugifyMap.get(config)
      let attributes = node.transformAttributes(config)
      let children = node.transformChildren(config)
      let text = children.filter((child) => typeof child === 'string').join(' ')
      let id = attributes.id ?? (text ? slugify(text) : `heading-${node.attributes.level}`)

      return new Tag(
        `h${node.attributes.level}`,
        { ...attributes, id },
        children,
      )
    },
  },
  th: {
    ...defaultNodes.th,
    attributes: {
      ...defaultNodes.th.attributes,
      scope: {
        type: String,
        default: 'col',
      },
    },
  },
  fence: {
    render: Fence,
    attributes: {
      language: {
        type: String,
      },
    },
  },
  item: {
    ...defaultNodes.item,
    render: ChecklistItem,
    transform(node, config) {
      let children = node.transformChildren(config)
      let first = children[0]

      if (typeof first === 'string') {
        let status = null
        if (first.startsWith('[x] ') || first === '[x]') {
          status = 'checked'
        } else if (first.startsWith('[-] ') || first === '[-]') {
          status = 'progress'
        } else if (first.startsWith('[ ] ') || first === '[ ]') {
          status = 'unchecked'
        }

        if (status !== null) {
          let stripped = first.replace(/^\[[ x\-]\]\s?/, '')
          let rest = stripped ? [stripped, ...children.slice(1)] : children.slice(1)

          return new Tag(this.render, { status }, rest)
        }
      }

      return new Tag('li', node.transformAttributes(config), children)
    },
  },
}

export default nodes
