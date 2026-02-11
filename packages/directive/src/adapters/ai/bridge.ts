/**
 * AI Bridge — Syncs AI adapter state into a Directive system.
 *
 * Eliminates manual state sync boilerplate when using createAgentStack()
 * alongside createSystem().
 *
 * @example Using with AgentStack directly
 * ```typescript
 * const syncAI = createAISyncer(stack, (state) => {
 *   system.events.chat.updateAIState({
 *     totalTokens: state.totalTokens,
 *     estimatedCost: state.estimatedCost,
 *     circuitState: state.circuitState,
 *   });
 * });
 * syncAI();
 * ```
 *
 * @example Using with a wrapper that has getState()
 * ```typescript
 * const syncAI = createAISyncer(myAIWrapper, (state) => {
 *   system.events.chat.updateAIState({ ... });
 * });
 * syncAI();
 * ```
 */

/**
 * Any object with a getState() method.
 * Works with AgentStack, or any wrapper that exposes getState().
 */
export interface Syncable<S> {
	getState(): S;
}

/**
 * Create a sync function that reads the latest state from a source and
 * passes it to a callback (typically dispatching events into a Directive system).
 *
 * Call the returned function after any AI operation to push state updates.
 */
export function createAISyncer<S>(
	source: Syncable<S>,
	syncFn: (state: S) => void,
): () => void {
	return function sync() {
		syncFn(source.getState());
	};
}
