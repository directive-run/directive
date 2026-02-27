'use client'

import { useSelector } from '@directive-run/react'
import { useDevToolsSystem } from '../DevToolsSystemContext'
import { EmptyState } from '../EmptyState'
import { KeyValueListView } from './KeyValueListView'

export function DerivationsView() {
  const system = useDevToolsSystem()
  const connected = useSelector(system, (s) => s.facts.runtime.connected)
  const derivations = useSelector(system, (s) => s.facts.runtime.derivations)
  const derivationCount = useSelector(system, (s) => s.derive.runtime.derivationCount)

  if (!connected) {
    return <EmptyState message="No Directive system connected" />
  }

  return (
    <KeyValueListView
      title="Derivations"
      filterLabel="Filter derivations"
      count={derivationCount}
      data={derivations}
      keyColorClass="text-violet-600 dark:text-violet-400"
      emptyMessage="No derivations in system"
      noMatchMessage={(f) => `No derivations matching "${f}"`}
    />
  )
}
