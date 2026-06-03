import type { CallExpression } from "ts-morph";
import { SyntaxKind } from "ts-morph";
import type { Finding } from "../types.js";
import { type ExecutableRule, makeFindingId } from "./types.js";

const ID = "useState-alongside-facts";

export const rule: ExecutableRule = {
  metadata: {
    id: ID,
    severity: "warning",
    category: "react",
    title: "React useState alongside Directive useFact",
    explanation:
      "A React component using both useState and useFact for the same domain is almost always wrong: the local React state and the Directive fact will drift, and the LLM will struggle to reason about which is the source of truth. Pick one — usually useFact.",
    badExample: `function Counter() {
  const count = useFact("count");
  const [localCount, setLocalCount] = useState(0);
}`,
    goodExample: `function Counter() {
  const count = useFact("count");
  const { increment } = useEvents();
}`,
    executable: true,
    fixable: false,
  },

  check(sourceFile) {
    const findings: Finding[] = [];
    let hasUseFact = false;
    let useStateCall: CallExpression | undefined;
    for (const call of sourceFile.getDescendantsOfKind(
      SyntaxKind.CallExpression,
    )) {
      const callee = call.getExpression().getText();
      if (callee === "useFact" || callee === "useDerived") {
        hasUseFact = true;
      }
      if (callee === "useState" && !useStateCall) {
        useStateCall = call;
      }
    }
    if (hasUseFact && useStateCall) {
      const { line, column } = sourceFile.getLineAndColumnAtPos(
        useStateCall.getStart(),
      );
      findings.push({
        ruleId: ID,
        severity: "warning",
        line,
        column,
        message:
          "useState alongside useFact/useDerived — the two will drift. Move the state into a fact and read it with useFact.",
        suggestion:
          "Replace useState with a fact in the module schema; read via useFact.",
        findingId: makeFindingId(ID, line, column),
      });
    }
    return findings;
  },
};
