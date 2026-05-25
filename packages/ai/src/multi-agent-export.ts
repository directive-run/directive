/**
 * Multi-agent orchestration subpath export.
 *
 * Tree-shakable entry for multi-agent patterns (parallel, sequential, supervisor,
 * dag, reflect, race, debate, goal), inter-agent communication, breakpoints,
 * checkpoints, reflection, goal utilities, and pattern visualization.
 *
 * @example
 * ```typescript
 * import { createMultiAgentOrchestrator, parallel } from "@directive-run/ai/multi-agent";
 * ```
 */

// Multi-agent orchestrator
export {
  createMultiAgentOrchestrator,
  Semaphore,
  parallel,
  sequential,
  supervisor,
  dag,
  reflect,
  race,
  debate,
  goal,
  allReadyStrategy,
  highestImpactStrategy,
  costEfficientStrategy,
  runDebate,
  selectAgent,
  runAgentRequirement,
  concatResults,
  pickBestResult,
  collectOutputs,
  aggregateTokens,
  composePatterns,
  findAgentsByCapability,
  capabilityRoute,
  spawnOnCondition,
  derivedConstraint,
  spawnPool,
  patternToJSON,
  patternFromJSON,
  getPatternStep,
  getCheckpointProgress,
  diffCheckpoints,
  forkFromCheckpoint,
  type MultiAgentOrchestrator,
  type MultiAgentOrchestratorOptions,
  type MultiAgentState,
  type TaskRegistration,
  type TaskContext,
  type AgentRegistration,
  type AgentRegistry,
  type ExecutionPattern,
  type ParallelPattern,
  type SequentialPattern,
  type SupervisorPattern,
  type ReflectPattern,
  type RacePattern,
  type RaceResult,
  type RaceSuccessEntry,
  type ReflectIterationRecord,
  type DebateConfig,
  type DebateResult,
  type DebatePattern,
  type GoalPattern,
  type GoalNode,
  type GoalResult,
  type GoalStepMetrics,
  type GoalMetrics,
  type AgentSelectionStrategy,
  type RelaxationTier,
  type RelaxationStrategy,
  type RelaxationRecord,
  type RelaxationContext,
  type SpawnOnConditionOptions,
  type SpawnPoolConfig,
  type SerializedPattern,
  type SerializedDagNode,
  type SerializedGoalNode,
  type HandoffRequest,
  type HandoffResult,
  type RunAgentRequirement,
  type MultiAgentRunCallOptions,
} from "./multi-agent-orchestrator.js";

// Pattern visualization
export {
  patternToMermaid,
  type MermaidOptions,
  type MermaidDirection,
  type MermaidNodeShapes,
} from "./pattern-mermaid.js";

// Agent communication
export {
  createMessageBus,
  createAgentNetwork,
  createResponder,
  createDelegator,
  createPubSub,
  type MessageBus,
  type MessageBusConfig,
  type AgentNetwork,
  type AgentNetworkConfig,
  type AgentInfo,
  type AgentMessage,
  type AgentMessageType,
  type TypedAgentMessage,
  type RequestMessage,
  type ResponseMessage,
  type DelegationMessage,
  type DelegationResultMessage,
  type QueryMessage,
  type InformMessage,
  type UpdateMessage,
  type MessageHandler,
  type Subscription,
  type MessageFilter,
} from "./communication.js";

// Checkpointing
export {
  createCheckpointId,
  validateCheckpoint,
  InMemoryCheckpointStore,
  type Checkpoint,
  type CheckpointStore,
  type CheckpointLocalState,
  type SingleAgentCheckpointLocalState,
  type MultiAgentCheckpointLocalState,
  type InMemoryCheckpointStoreOptions,
} from "./checkpoint.js";

// Breakpoints
export {
  matchBreakpoint,
  createBreakpointId,
  createInitialBreakpointState,
  MAX_BREAKPOINT_HISTORY,
  type BreakpointType,
  type MultiAgentBreakpointType,
  type BreakpointConfig,
  type BreakpointContext,
  type BreakpointRequest,
  type BreakpointModifications,
  type BreakpointState,
} from "./breakpoints.js";

// Reflection
export {
  withReflection,
  ReflectionExhaustedError,
  type ReflectionConfig,
  type ReflectionContext,
  type ReflectionEvaluation,
  type ReflectionEvaluator,
} from "./reflection.js";

// Goal Utilities
export {
  planGoal,
  validateGoal,
  getDependencyGraph,
  explainGoal,
  type GoalAgentDeclaration,
  type GoalDependencyEdge,
  type GoalDependencyGraph,
  type GoalValidationResult,
  type GoalPlanStep,
  type GoalExecutionPlan,
  type GoalExplanation,
  type GoalExplanationStep,
} from "./goal-utils.js";
