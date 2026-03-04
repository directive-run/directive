---
description: Create an animated React Flow diagram for the docs site
---

# New React Flow Diagram

Create an animated React Flow diagram using the shared diagram infrastructure. Use `ConstraintFlowDiagram.tsx` and `ModuleLifecycleDiagram.tsx` as reference implementations.

## Reference Files

Read these files before starting:

```
website/src/components/ConstraintFlowDiagram.tsx    # 2x2 grid layout example
website/src/components/ModuleLifecycleDiagram.tsx    # Zigzag multi-row layout example
website/src/components/diagrams/DiagramToolbar.tsx   # Shared toolbar (step indicators + play/pause)
website/src/components/diagrams/DiagramWrapper.tsx   # Shared ReactFlow wrapper
website/src/components/diagrams/nodes/StepNode.tsx   # Node component
website/src/components/diagrams/edges/LabeledEdge.tsx # Edge component with labels
website/src/components/diagrams/hooks/useAnimationLoop.ts # Animation hook
website/src/components/diagrams/types.ts             # StepNodeData, ColorScheme types
website/src/components/diagrams/theme.ts             # Color utilities
website/src/components/diagrams/index.ts             # All exports
```

## Step 1: Create the Component

Create `website/src/components/<Name>Diagram.tsx` following this pattern:

```tsx
'use client'

import { memo, useMemo, useCallback } from 'react'
import type { Node, Edge } from '@xyflow/react'
import {
  DiagramWrapper,
  DiagramToolbar,
  useAnimationLoop,
  diagramNodeTypes,
  diagramEdgeTypes,
  type StepNodeData,
} from './diagrams'

// 1. Define steps (toolbar indicators)
const STEPS = [
  { id: 'step1', label: 'Step 1', subtitle: 'description', colorScheme: 'primary' as const },
  { id: 'step2', label: 'Step 2', subtitle: 'description', colorScheme: 'amber' as const },
  // colorScheme options: 'primary' | 'amber' | 'violet' | 'emerald' | 'red' | 'slate'
] as const

// 2. Define animation sequence (steps interleaved with arrows)
const ANIMATION_STEPS = ['step1', 'arrow1', 'step2'] as const

export const <Name>Diagram = memo(function <Name>Diagram() {
  // 3. Animation hook
  const { phase, isPlaying, toggle } = useAnimationLoop({
    totalPhases: ANIMATION_STEPS.length,
    interval: 2400, // ms per phase
  })

  const currentStepName = phase >= 0 ? ANIMATION_STEPS[phase] : null

  const isStepActive = useCallback(
    (stepId: string) => currentStepName === stepId,
    [currentStepName],
  )

  const isArrowActive = useCallback(
    (arrowId: string) => currentStepName === arrowId,
    [currentStepName],
  )

  // 4. Define nodes – position is { x, y } in pixels
  const nodes = useMemo<Node[]>(() => [
    {
      id: 'step1',
      type: 'step',
      position: { x: 0, y: 0 },
      style: { width: 280 },
      data: {
        label: STEPS[0].label,
        subtitle: STEPS[0].subtitle,
        status: isStepActive('step1') ? 'active' : 'idle',
        colorScheme: STEPS[0].colorScheme,
        // icon: <IconComponent size={28} weight="duotone" />,  // optional
      } satisfies StepNodeData,
    },
  ], [isStepActive])

  // 5. Define edges
  const edges = useMemo<Edge[]>(() => [
    {
      id: 'step1->step2',
      source: 'step1',
      target: 'step2',
      type: 'labeled',
      data: { label: 'action', active: isArrowActive('arrow1'), colorScheme: 'primary' },
      // For non-default handles, add sourceHandle/targetHandle (see Handle Reference below)
    },
  ], [isArrowActive])

  return (
    <div className="<name>-diagram">
      <DiagramWrapper
        height={420}
        nodes={nodes}
        edges={edges}
        nodeTypes={diagramNodeTypes}
        edgeTypes={diagramEdgeTypes}
      />

      <DiagramToolbar
        steps={STEPS}
        activeStepId={phase >= 0 ? ANIMATION_STEPS[phase] ?? null : null}
        isPlaying={isPlaying}
        onToggle={toggle}
      />
    </div>
  )
})
```

### Handle Reference

StepNode provides these connection handles:

| Handle ID | Position | Direction |
|-----------|----------|-----------|
| (default) | right | source |
| (default) | left | target |
| `top` | top center | target |
| `bottom` | bottom center | source |
| `top-source` | top center | source (reverse) |
| `bottom-target` | bottom center | target (reverse) |
| `left-source` | left center | source (reverse) |
| `right-target` | right center | target (reverse) |

Default handles work for left-to-right flow. Use named handles for vertical or reverse-direction edges.

### Layout Patterns

**2x2 Grid** (ConstraintFlowDiagram):
```
position: { x: 0, y: 0 }      // top-left
position: { x: 440, y: 0 }    // top-right
position: { x: 440, y: 280 }  // bottom-right
position: { x: 0, y: 280 }    // bottom-left
```

**Zigzag** (ModuleLifecycleDiagram):
```
COL_GAP = 500, ROW_GAP = 300
Row 0: (0, 0) → (COL_GAP, 0)
Row 1: (0, ROW_GAP) → (COL_GAP, ROW_GAP)
Row 2: (0, ROW_GAP*2) → (COL_GAP, ROW_GAP*2)
```

**Linear horizontal**: All nodes at y=0, incrementing x by node width + gap.

**Linear vertical**: All nodes at x=0, incrementing y by row gap.

## Step 2: Register Markdoc Tag

Add to `website/src/markdoc/tags.js`:

```js
// Import at top
import { <Name>Diagram } from '@/components/<Name>Diagram'

// In tags object
'<name>-diagram': {
  render: <Name>Diagram,
  selfClosing: true,
},
```

## Step 3: Use in Markdown

In the target `.md` page:

```markdown
{% <name>-diagram /%}
```

## Step 4: Verify

1. `pnpm --filter directive-website dev` – check the page renders
2. Animation cycles through all steps
3. DiagramToolbar shows step indicators and play/pause
4. Nodes and edges look correct in both light and dark mode
5. `npx tsc --noEmit` passes

## Tips

- Keep node width consistent (280px is standard)
- DiagramWrapper `height` should be tall enough to contain all nodes with padding
- Animation `interval` of 2400-3000ms works well – faster feels rushed
- Use `colorScheme` on edges matching the source node's color for visual consistency
- Icons from `@phosphor-icons/react` with `size={28} weight="duotone"`
