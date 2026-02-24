import { Callout } from '@/components/Callout'
import { ComparisonTable } from '@/components/ComparisonTable'
import { ConstraintFlowDiagram } from '@/components/ConstraintFlowDiagram'
import { DagFlowDiagram } from '@/components/DagFlowDiagram'
import { ReflectLoopDiagram } from '@/components/ReflectLoopDiagram'
import { ResilienceCascadeDiagram } from '@/components/ResilienceCascadeDiagram'
import { QuickLink, QuickLinks } from '@/components/QuickLinks'
import { Playground, StackBlitzButton } from '@/components/Playground'
import { UseCaseCards } from '@/components/UseCaseCards'
import { DevToolsDemo } from '@/components/DevToolsDemo'

// Phase 3: ASCII art replacement diagrams
import { ReconciliationFlowDiagram } from '@/components/diagrams/ReconciliationFlowDiagram'
import { FivePhaseDiagram } from '@/components/diagrams/FivePhaseDiagram'
import { RagPipelineDiagram } from '@/components/diagrams/RagPipelineDiagram'
import { MessagePipelineDiagram } from '@/components/diagrams/MessagePipelineDiagram'
import { RequestLifecycleDiagram } from '@/components/diagrams/RequestLifecycleDiagram'
import { SecurityPipelineDiagram } from '@/components/diagrams/SecurityPipelineDiagram'
import { AiArchitectureDiagram } from '@/components/diagrams/AiArchitectureDiagram'
import { CoreApiPrimitivesDiagram } from '@/components/diagrams/CoreApiPrimitivesDiagram'

// Phase 4: New high-priority diagrams
import { ReconciliationCycleDiagram } from '@/components/diagrams/ReconciliationCycleDiagram'
import { SettlementStateMachineDiagram } from '@/components/diagrams/SettlementStateMachineDiagram'
import { DerivationDependencyGraphDiagram } from '@/components/diagrams/DerivationDependencyGraphDiagram'
import { MultiModuleArchitectureDiagram } from '@/components/diagrams/MultiModuleArchitectureDiagram'
import { ErrorBoundaryRecoveryDiagram } from '@/components/diagrams/ErrorBoundaryRecoveryDiagram'
import { PluginLifecycleTimelineDiagram } from '@/components/diagrams/PluginLifecycleTimelineDiagram'
import { ConstraintOrderingDagDiagram } from '@/components/diagrams/ConstraintOrderingDagDiagram'
import { ResolverRetryTimelineDiagram } from '@/components/diagrams/ResolverRetryTimelineDiagram'
import { BatchedNotificationsDiagram } from '@/components/diagrams/BatchedNotificationsDiagram'
import { AgentOrchestratorArchitectureDiagram } from '@/components/diagrams/AgentOrchestratorArchitectureDiagram'

// Phase 5: Medium-priority diagrams
import { ApprovalWorkflowDiagram } from '@/components/diagrams/ApprovalWorkflowDiagram'
import { MultiAgentExecutionDiagram } from '@/components/diagrams/MultiAgentExecutionDiagram'
import { GuardrailsPipelineDiagram } from '@/components/diagrams/GuardrailsPipelineDiagram'
import { ReduxVsDirectiveDiagram } from '@/components/diagrams/ReduxVsDirectiveDiagram'
import { ConstraintVsEventDrivenDiagram } from '@/components/diagrams/ConstraintVsEventDrivenDiagram'
import { EffectVsResolverDiagram } from '@/components/diagrams/EffectVsResolverDiagram'
import { TimeTravelTimelineDiagram } from '@/components/diagrams/TimeTravelTimelineDiagram'
import { BatchedResolutionDiagram } from '@/components/diagrams/BatchedResolutionDiagram'
import { ModuleLifecycleDiagram } from '@/components/diagrams/ModuleLifecycleDiagram'
import { ConstraintCompositionDiagram } from '@/components/diagrams/ConstraintCompositionDiagram'
import { DerivationCompositionDiagram } from '@/components/diagrams/DerivationCompositionDiagram'

const tags = {
  'comparison-table': {
    render: ComparisonTable,
    selfClosing: true,
  },
  'constraint-flow-diagram': {
    render: ConstraintFlowDiagram,
    selfClosing: true,
  },
  'dag-flow-diagram': {
    render: DagFlowDiagram,
    selfClosing: true,
  },
  'reflect-loop-diagram': {
    render: ReflectLoopDiagram,
    selfClosing: true,
  },
  'resilience-cascade-diagram': {
    render: ResilienceCascadeDiagram,
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

  // Phase 3: ASCII art replacements
  'reconciliation-flow-diagram': {
    render: ReconciliationFlowDiagram,
    selfClosing: true,
  },
  'five-phase-diagram': {
    render: FivePhaseDiagram,
    selfClosing: true,
  },
  'rag-pipeline-diagram': {
    render: RagPipelineDiagram,
    selfClosing: true,
  },
  'message-pipeline-diagram': {
    render: MessagePipelineDiagram,
    selfClosing: true,
  },
  'request-lifecycle-diagram': {
    render: RequestLifecycleDiagram,
    selfClosing: true,
  },
  'security-pipeline-diagram': {
    render: SecurityPipelineDiagram,
    selfClosing: true,
  },
  'ai-architecture-diagram': {
    render: AiArchitectureDiagram,
    selfClosing: true,
  },
  'core-api-primitives-diagram': {
    render: CoreApiPrimitivesDiagram,
    selfClosing: true,
  },

  // Phase 4: New high-priority diagrams
  'reconciliation-cycle-diagram': {
    render: ReconciliationCycleDiagram,
    selfClosing: true,
  },
  'settlement-state-machine-diagram': {
    render: SettlementStateMachineDiagram,
    selfClosing: true,
  },
  'derivation-dependency-graph-diagram': {
    render: DerivationDependencyGraphDiagram,
    selfClosing: true,
  },
  'multi-module-architecture-diagram': {
    render: MultiModuleArchitectureDiagram,
    selfClosing: true,
  },
  'error-boundary-recovery-diagram': {
    render: ErrorBoundaryRecoveryDiagram,
    selfClosing: true,
  },
  'plugin-lifecycle-timeline-diagram': {
    render: PluginLifecycleTimelineDiagram,
    selfClosing: true,
  },
  'constraint-ordering-dag-diagram': {
    render: ConstraintOrderingDagDiagram,
    selfClosing: true,
  },
  'resolver-retry-backoff-timeline-diagram': {
    render: ResolverRetryTimelineDiagram,
    selfClosing: true,
  },
  'batched-notifications-diagram': {
    render: BatchedNotificationsDiagram,
    selfClosing: true,
  },
  'agent-orchestrator-architecture-diagram': {
    render: AgentOrchestratorArchitectureDiagram,
    selfClosing: true,
  },

  // Phase 5: Medium-priority diagrams
  'approval-workflow-diagram': {
    render: ApprovalWorkflowDiagram,
    selfClosing: true,
  },
  'multi-agent-execution-diagram': {
    render: MultiAgentExecutionDiagram,
    selfClosing: true,
  },
  'guardrails-pipeline-diagram': {
    render: GuardrailsPipelineDiagram,
    selfClosing: true,
  },
  'redux-vs-directive-diagram': {
    render: ReduxVsDirectiveDiagram,
    selfClosing: true,
  },
  'constraint-vs-event-driven-diagram': {
    render: ConstraintVsEventDrivenDiagram,
    selfClosing: true,
  },
  'effect-vs-resolver-diagram': {
    render: EffectVsResolverDiagram,
    selfClosing: true,
  },
  'time-travel-timeline-diagram': {
    render: TimeTravelTimelineDiagram,
    selfClosing: true,
  },
  'batched-resolution-diagram': {
    render: BatchedResolutionDiagram,
    selfClosing: true,
  },
  'module-lifecycle-diagram': {
    render: ModuleLifecycleDiagram,
    selfClosing: true,
  },
  'constraint-composition-diagram': {
    render: ConstraintCompositionDiagram,
    selfClosing: true,
  },
  'derivation-composition-diagram': {
    render: DerivationCompositionDiagram,
    selfClosing: true,
  },
}

export default tags
