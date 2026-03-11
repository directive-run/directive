import { useFact } from "@directive-run/solid";
import { useHistory } from "@directive-run/solid";
import { TestIds } from "../../../../shared/test-ids";
import { system } from "../system";

export function UseHistoryPage() {
  const count = useFact(system, "count");
  const history = useHistory(system);

  return (
    <div>
      <span data-testid={TestIds.factSingle}>{count()}</span>
      <span data-testid={TestIds.historyEnabled}>
        {String(history() !== null)}
      </span>
      <span data-testid={TestIds.historyCanUndo}>
        {String(history()?.canUndo ?? false)}
      </span>
      <span data-testid={TestIds.historyCanRedo}>
        {String(history()?.canRedo ?? false)}
      </span>
      <span data-testid={TestIds.historyIndex}>
        {history()?.currentIndex ?? -1}
      </span>
      <span data-testid={TestIds.historyTotal}>
        {history()?.totalSnapshots ?? 0}
      </span>
      <button
        data-testid={TestIds.btnIncrement}
        onClick={() => system.events.increment()}
      >
        inc
      </button>
      <button data-testid={TestIds.btnUndo} onClick={() => history()?.undo()}>
        undo
      </button>
      <button data-testid={TestIds.btnRedo} onClick={() => history()?.redo()}>
        redo
      </button>
    </div>
  );
}
