import { Callout } from '@/components/Callout'
import { ComparisonTable } from '@/components/ComparisonTable'
import { ConstraintFlowDiagram } from '@/components/ConstraintFlowDiagram'
import { ModuleLifecycleDiagram } from '@/components/ModuleLifecycleDiagram'
import { QuickLink, QuickLinks } from '@/components/QuickLinks'
import { Playground, StackBlitzButton } from '@/components/Playground'
import { UseCaseCards } from '@/components/UseCaseCards'
import { DevToolsDemo } from '@/components/DevToolsDemo'

const tags = {
  'comparison-table': {
    render: ComparisonTable,
    selfClosing: true,
  },
  'constraint-flow-diagram': {
    render: ConstraintFlowDiagram,
    selfClosing: true,
  },
  callout: {
    attributes: {
      title: { type: String },
      type: {
        type: String,
        default: 'note',
        matches: ['note', 'warning'],
        errorLevel: 'critical',
      },
    },
    render: Callout,
  },
  figure: {
    selfClosing: true,
    attributes: {
      src: { type: String },
      alt: { type: String },
      caption: { type: String },
    },
    render: ({ src, alt = '', caption }) => (
      <figure>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} />
        <figcaption>{caption}</figcaption>
      </figure>
    ),
  },
  'quick-links': {
    render: QuickLinks,
  },
  'quick-link': {
    selfClosing: true,
    render: QuickLink,
    attributes: {
      title: { type: String },
      description: { type: String },
      icon: { type: String },
      href: { type: String },
    },
  },
  playground: {
    render: Playground,
    selfClosing: true,
    attributes: {
      projectId: { type: String },
      title: { type: String },
      file: { type: String },
      height: { type: Number },
      view: { type: String },
    },
  },
  'stackblitz-button': {
    render: StackBlitzButton,
    selfClosing: true,
    attributes: {
      projectId: { type: String },
      text: { type: String },
    },
  },
  'use-case-cards': {
    render: UseCaseCards,
    selfClosing: true,
  },
  'devtools-demo': {
    render: DevToolsDemo,
    selfClosing: true,
  },
  'module-lifecycle-diagram': {
    render: ModuleLifecycleDiagram,
    selfClosing: true,
  },
}

export default tags
