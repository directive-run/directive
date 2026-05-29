<script lang="ts">
import { useDirective } from "@directive-run/svelte";
import { TestIds } from "../../../../shared/test-ids";
import { testModule } from "../../../../shared/test-module";

const {
  system: _system,
  facts: _facts,
  derived: _derived,
  events: _events,
  dispatch: _dispatch,
} = useDirective(testModule, {
  facts: ["count", "name"],
  derived: ["doubled"],
  history: { maxSnapshots: 50 },
});
</script>

<div>
  <span data-testid={TestIds.directiveFact}>{$_facts.count}</span>
  <span data-testid={TestIds.directiveDerived}>{$_derived.doubled}</span>
  <span data-testid={TestIds.directiveSystem}>{_system ? "valid" : "null"}</span>
  <button data-testid={TestIds.btnIncrement} on:click={() => _events.increment()}>
    inc
  </button>
</div>
