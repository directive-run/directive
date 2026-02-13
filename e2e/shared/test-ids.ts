/** Shared data-testid constants for all framework fixtures */
export const TestIds = {
  // useFact
  factSingle: "fact-single",
  factMulti: "fact-multi",
  factMultiName: "fact-multi-name",

  // useDerived
  derivedSingle: "derived-single",
  derivedBool: "derived-bool",
  derivedMulti: "derived-multi",

  // useSelector
  selectorResult: "selector-result",

  // useDispatch
  dispatchResult: "dispatch-result",

  // useWatch
  watchPrev: "watch-prev",
  watchNew: "watch-new",
  watchCount: "watch-count",

  // useInspect
  inspectSettled: "inspect-settled",
  inspectWorking: "inspect-working",

  // useEvents
  eventsResult: "events-result",

  // useExplain
  explainResult: "explain-result",

  // useConstraintStatus
  constraintList: "constraint-list",
  constraintActive: "constraint-active",

  // useOptimisticUpdate
  optimisticPending: "optimistic-pending",
  optimisticValue: "optimistic-value",
  optimisticError: "optimistic-error",

  // useRequirementStatus
  reqStatusPending: "req-status-pending",
  reqStatusLoading: "req-status-loading",

  // useTimeTravel
  timeTravelCanUndo: "tt-can-undo",
  timeTravelCanRedo: "tt-can-redo",
  timeTravelIndex: "tt-index",
  timeTravelTotal: "tt-total",
  timeTravelEnabled: "tt-enabled",

  // useDirective
  directiveFact: "directive-fact",
  directiveDerived: "directive-derived",
  directiveSystem: "directive-system",

  // Action buttons
  btnIncrement: "btn-increment",
  btnDecrement: "btn-decrement",
  btnSetName: "btn-set-name",
  btnAddItem: "btn-add-item",
  btnReset: "btn-reset",
  btnTriggerLoad: "btn-trigger-load",
  btnUndo: "btn-undo",
  btnRedo: "btn-redo",
  btnMutate: "btn-mutate",
  btnRollback: "btn-rollback",
  btnDispatchIncrement: "btn-dispatch-increment",
} as const;
