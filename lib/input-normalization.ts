import type { DecisionInput } from "./types";
import {
  DIRECT_ACTIONABLE_BEHAVIORS,
  DIRECT_ACTIONABLE_CAPABILITIES,
  HYBRID_TRIGGERS,
  hasConfirmedSemanticModelReadiness
} from "./rules";

const ACTION_CAPABILITIES = new Set(DIRECT_ACTIONABLE_CAPABILITIES);
const ACTION_BEHAVIORS = new Set(DIRECT_ACTIONABLE_BEHAVIORS);

const ARRAY_FIELDS: Array<keyof Pick<
  DecisionInput,
  | "users"
  | "channels"
  | "capabilities"
  | "dataSources"
  | "behaviors"
  | "lifecycleControls"
  | "modelStrategy"
  | "runtimePreferences"
  | "securityControls"
  | "networkControls"
>> = [
  "users",
  "channels",
  "capabilities",
  "dataSources",
  "behaviors",
  "lifecycleControls",
  "modelStrategy",
  "runtimePreferences",
  "securityControls",
  "networkControls"
];

function cleanMulti<T extends string>(values: T[] | undefined): T[] {
  const unique = Array.from(new Set(values ?? []));
  const concrete = unique.filter((v) => v !== "unknown" && v !== "none");
  if (concrete.length > 0) return concrete;
  return unique;
}

export function normalizeDecisionInput(input: DecisionInput): DecisionInput {
  const next: DecisionInput = { ...input };
  for (const field of ARRAY_FIELDS) {
    (next as any)[field] = cleanMulti((input as any)[field]);
  }
  next.advancedRagRequirements = cleanMulti(input.advancedRagRequirements);

  if (next.users.includes("mixed") && next.users.length > 1) {
    next.users = next.users.filter((u) => u !== "mixed");
  }
  if (next.channels.includes("multiple") && next.channels.length > 1) {
    next.channels = next.channels.filter((c) => c !== "multiple");
  }

  const privateNetwork = new Set(HYBRID_TRIGGERS);
  if (next.networkControls.some((n) => privateNetwork.has(n))) {
    next.networkControls = next.networkControls.filter((n) => n !== "public");
  }
  if (input.semanticModelConfirmations !== undefined) {
    next.semanticModelSecurityKnown = hasConfirmedSemanticModelReadiness(input.semanticModelConfirmations);
  }
  if (next.writeBackConfirmed === false) {
    next.capabilities = next.capabilities.filter((capability) => !ACTION_CAPABILITIES.has(capability));
    next.behaviors = next.behaviors.filter((behavior) => !ACTION_BEHAVIORS.has(behavior));
    // Removing the action semantics must not collapse the whole scenario to "unknown".
    // A "looks up records but must not write" agent is still a well-formed read-only
    // assistant, so backfill a baseline read-only behavior/capability when the strip
    // emptied them — this keeps the recommendation specific instead of low-confidence.
    if (next.behaviors.length === 0) next.behaviors = ["qa"];
    if (next.capabilities.length === 0) {
      const operationalSources = new Set(["azure_sql", "dataverse", "apis", "erp_crm", "on_prem"]);
      next.capabilities = next.dataSources.some((source) => operationalSources.has(source))
        ? ["operational_query"]
        : ["employee_assistant"];
    }
  }
  return next;
}
