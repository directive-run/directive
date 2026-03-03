import { AiArchitectureDiagram } from "@/components/AiArchitectureDiagram";
import { Callout } from "@/components/Callout";
import { ComparisonTable } from "@/components/ComparisonTable";
import { ConstraintDependencyDiagram } from "@/components/ConstraintDependencyDiagram";
import { ConstraintFlowDiagram } from "@/components/ConstraintFlowDiagram";
import { ConstraintPriorityDiagram } from "@/components/ConstraintPriorityDiagram";
import { DevToolsDemo } from "@/components/DevToolsDemo";
import { ModuleLifecycleDiagram } from "@/components/ModuleLifecycleDiagram";
import { OrchestratorDiagram } from "@/components/OrchestratorDiagram";
import { Playground, StackBlitzButton } from "@/components/Playground";
import { PluginLifecycleDiagram } from "@/components/PluginLifecycleDiagram";
import { QuickLink, QuickLinks } from "@/components/QuickLinks";
import { SecurityPipelineDiagram } from "@/components/SecurityPipelineDiagram";
import { UseCaseCards } from "@/components/UseCaseCards";

const tags = {
  "comparison-table": {
    render: ComparisonTable,
    selfClosing: true,
  },
  "constraint-flow-diagram": {
    render: ConstraintFlowDiagram,
    selfClosing: true,
  },
  callout: {
    attributes: {
      title: { type: String },
      type: {
        type: String,
        default: "note",
        matches: ["note", "warning"],
        errorLevel: "critical",
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
    render: ({ src, alt = "", caption }) => (
      <figure>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} />
        <figcaption>{caption}</figcaption>
      </figure>
    ),
  },
  "quick-links": {
    render: QuickLinks,
  },
  "quick-link": {
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
  "stackblitz-button": {
    render: StackBlitzButton,
    selfClosing: true,
    attributes: {
      projectId: { type: String },
      text: { type: String },
    },
  },
  "use-case-cards": {
    render: UseCaseCards,
    selfClosing: true,
  },
  "devtools-demo": {
    render: DevToolsDemo,
    selfClosing: true,
  },
  "module-lifecycle-diagram": {
    render: ModuleLifecycleDiagram,
    selfClosing: true,
  },
  "plugin-lifecycle-diagram": {
    render: PluginLifecycleDiagram,
    selfClosing: true,
  },
  "constraint-priority-diagram": {
    render: ConstraintPriorityDiagram,
    selfClosing: true,
  },
  "constraint-dependency-diagram": {
    render: ConstraintDependencyDiagram,
    selfClosing: true,
  },
  "ai-architecture-diagram": {
    render: AiArchitectureDiagram,
    selfClosing: true,
  },
  "security-pipeline-diagram": {
    render: SecurityPipelineDiagram,
    selfClosing: true,
  },
  "orchestrator-diagram": {
    render: OrchestratorDiagram,
    selfClosing: true,
  },
};

export default tags;
