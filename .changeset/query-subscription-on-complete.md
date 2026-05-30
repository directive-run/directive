---
"@directive-run/query": minor
---

`createSubscription` gains an `onComplete` callback for stream-terminal signalling.

Push-based subscriptions previously had no way to say "the stream is done"
distinct from "another value just arrived." Every `onData` call set
`status: "success"` / `isFetching: false`, so streaming consumers couldn't
tell a partial chunk from the final one. AI streaming code that finalised
on the first success status would tear the underlying transport down after
one or two tokens.

```ts
const chat = createSubscription({
  name: "reply",
  key: (f) => (f.prompt ? { prompt: f.prompt } : null),
  subscribe: (params, { onData, onError, onComplete, signal }) => {
    const es = new EventSource(`/api/chat?prompt=${params.prompt}`);
    es.onmessage = (e) => {
      const frame = JSON.parse(e.data);
      if (frame.type === "done") {
        onComplete();
        es.close();
      } else {
        onData((prev) => (prev ?? "") + frame.text);
      }
    };
    es.onerror = () => onError(new Error("stream error"));
    signal.addEventListener("abort", () => es.close());
  },
});
```

`ResourceState<T>` now carries an `isComplete: boolean` flag:

- `isSuccess && !isComplete` – data updated, more chunks may arrive
- `isComplete` – stream ended cleanly, no further values will be pushed

The flag is reset to `false` whenever the subscription is re-keyed.

Also fixes a long-standing bug where the subscription effect re-ran on its
own writes, firing the cleanup and aborting the live `AbortController` on
the first emission. Prev-key bookkeeping now lives in a closure
`WeakMap<facts, string>` instead of in the fact store, and prev state
reads are untracked. The auto-tracked deps now match what `keyFn(facts)`
reads, which is the right identity for a subscription.

For one-shot queries and mutations, `isComplete` is always `false`.
