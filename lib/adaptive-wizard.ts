import type {
  AdaptiveOptionState,
  AdaptiveQuestionPlanItem,
  AdaptiveWizardState,
  DecisionInput,
  WizardQuestion
} from "./types";
import { normalizeDecisionInput as normalize } from "./input-normalization";
import { candidateBasePatterns } from "./patterns";
import {
  ACTIONABLE_BEHAVIORS,
  HYBRID_TRIGGERS,
  hasAmbiguousWorkflowIntent,
  hasConfirmedWriteAction,
  hasAdvancedRagDocumentSource,
  hasExternalChannel,
  hasExternalUser,
  hasFabricSource,
  hasInternalUser,
  hasTeamsChannel,
  needsSemanticModelGuidance,
  wantsAdvancedRag,
  wantsFoundryLifecycle,
  wantsHybridOverlay,
  wantsModelCustomization,
  computeConfidenceLevel
} from "./rules";

export { normalizeDecisionInput } from "./input-normalization";

const EARLY_GATES = new Set(["users", "channels", "capabilities", "dataSources", "behaviors"]);
const BROAD_LATE_GATES = new Set(["lifecycleControls", "modelStrategy", "runtimePreferences", "securityControls", "networkControls"]);

const answered = (input: DecisionInput, question: WizardQuestion) =>
  question.id === "summary" || (question.isAnswered ? question.isAnswered(input) : false);

const hasDocIntent = (input: DecisionInput) =>
  input.capabilities.includes("document_rag") ||
  hasAdvancedRagDocumentSource(input);

const hasDocumentRepository = (input: DecisionInput) =>
  input.dataSources.some((source) => ["documents", "blob_storage", "sharepoint"].includes(source));

const advancedRagAnswered = (input: DecisionInput) =>
  (input.advancedRagRequirements ?? []).length > 0;

const hasConcreteActionableBehavior = (input: DecisionInput) =>
  input.behaviors.some((b) => ACTIONABLE_BEHAVIORS.includes(b)) ||
  input.writeBackConfirmed === true;

const hasWorkflowExecutionResponse = (input: DecisionInput) =>
  (input.workflowExecution ?? []).length > 0 || input.writeBackConfirmed === false;

const mentions = (input: DecisionInput, pattern: RegExp) =>
  pattern.test(input.summary ?? "") || pattern.test(input.notes ?? "") || pattern.test((input as any).userNotes ?? "");

const wantsM365SdkQuestion = (input: DecisionInput) =>
  hasTeamsChannel(input) &&
  (input.runtimePreferences.includes("m365_agents_sdk") ||
    input.capabilities.includes("custom_app") ||
    mentions(input, /sdk|extensibility|extension/i));

const mentionsModelStrategy = (input: DecisionInput) =>
  mentions(input, /fine[-\s]?tun|custom model|azure machine learning|azure ml|model catalog|bring your own model|byom|mlops|managed online endpoint|managed endpoint|open model|model registry|claude|anthropic|opus|grok|gtok|xai|x\.ai|\bmeta\b|mistral|cohere|nvidia|hugging\s*face|huggingface|non[-\s]?azure openai|not azure openai/i);

const wantsModelStrategyQuestion = (input: DecisionInput) =>
  mentionsModelStrategy(input) ||
  wantsModelCustomization(input) ||
  input.lifecycleControls.some((c) => ["model_versioning", "model_routing"].includes(c));

const wantsRuntimePreferenceQuestion = (input: DecisionInput) =>
  input.runtimePreferences.includes("unknown") ||
  input.runtimePreferences.some((r) => !["none", "unknown"].includes(r)) ||
  mentions(input, /foundry agent|custom backend|app service|container apps|aks|azure functions|runtime|orchestrat/i);

const hasSemanticModelResponse = (input: DecisionInput) =>
  (input.semanticModelConfirmations ?? []).length > 0;

const hasCitizenOrCustomer = (input: DecisionInput) =>
  input.users.some((user) => ["citizens", "external_customers"].includes(user));

const canClarifyFabricDataAgentRoute = (input: DecisionInput) =>
  hasFabricSource(input);

const hasExternalAccessResponse = (input: DecisionInput) =>
  input.externalAccessConfirmed !== undefined ||
  input.externalAccessUnknown === true ||
  (hasExternalUser(input) &&
    hasExternalChannel(input) &&
    input.securityControls.some((control) => ["entra_external_id", "apim", "waf"].includes(control)));

const hasM365ExtensibilityResponse = (input: DecisionInput) =>
  input.m365ExtensibilityRequired !== undefined || input.m365ExtensibilityUnknown === true;

function needsQuestion(input: DecisionInput, id: string): boolean {
  if (id === "fabricAnalyticsIntent") {
    return canClarifyFabricDataAgentRoute(input) && !input.fabricAnalyticsIntent;
  }
  if (id === "fabricUserAccess") {
    return canClarifyFabricDataAgentRoute(input) && !input.fabricUserAccess;
  }
  if (id === "advancedRagRequirements") {
    return hasDocIntent(input) && !advancedRagAnswered(input);
  }
  if (id === "semanticModelConfirmations") {
    return needsSemanticModelGuidance(input) && !hasSemanticModelResponse(input);
  }
  if (id === "workflowExecution") {
    return (
      hasAmbiguousWorkflowIntent(input) &&
      !hasConcreteActionableBehavior(input) &&
      input.writeBackConfirmed === undefined &&
      !hasWorkflowExecutionResponse(input)
    );
  }
  if (id === "modelStrategy") {
    return wantsModelStrategyQuestion(input) && (input.modelStrategy ?? []).length === 0;
  }
  if (id === "externalAccessConfirmed") {
    return hasExternalUser(input) && hasExternalChannel(input) && !hasExternalAccessResponse(input);
  }
  if (id === "m365ExtensibilityRequired") {
    return wantsM365SdkQuestion(input) && !hasM365ExtensibilityResponse(input);
  }
  return false;
}

export function getQuestionRelevance(
  rawInput: DecisionInput,
  question: WizardQuestion
): AdaptiveQuestionPlanItem {
  const input = normalize(rawInput);
  if (question.showWhen && !question.showWhen(input)) {
    return {
      questionId: question.id,
      relevance: "hidden",
      priority: 900,
      reason: "The trigger for this conditional question is not present."
    };
  }

  if (question.id === "summary") {
    return {
      questionId: question.id,
      relevance: input.summary === undefined ? "optional_later" : "resolved",
      priority: 100,
      reason: "Summary is useful context but never blocks recommendation generation."
    };
  }

  if (EARLY_GATES.has(question.id)) {
    return {
      questionId: question.id,
      relevance: answered(input, question) ? "resolved" : "required_now",
      priority: ["users", "channels", "capabilities", "dataSources", "behaviors"].indexOf(question.id) + 1,
      reason: answered(input, question)
        ? "Answered."
        : "We need this to suggest the right option for you."
    };
  }

  if (question.id === "advancedRagRequirements") {
    if (!hasDocIntent(input)) {
      return { questionId: question.id, relevance: "hidden", priority: 900, reason: "No document or native knowledge intent is selected." };
    }
    if (advancedRagAnswered(input)) {
      return { questionId: question.id, relevance: "resolved", priority: 10, reason: "Advanced RAG route has already been clarified." };
    }
    return {
      questionId: question.id,
      relevance: "conditional_now",
      priority: 10,
      reason: "Document Q&A can use Copilot Studio native knowledge or Azure AI Search; this confirms which route is needed."
    };
  }

  if (question.id === "semanticModelConfirmations") {
    if (!needsSemanticModelGuidance(input)) return { questionId: question.id, relevance: "hidden", priority: 900, reason: "No Power BI Semantic Model source selected." };
    return {
      questionId: question.id,
      relevance: hasSemanticModelResponse(input) ? "resolved" : "conditional_now",
      priority: 11,
      reason: "Power BI Semantic Model requires permissions and Prep-for-AI confirmation."
    };
  }

  if (question.id === "fabricAnalyticsIntent") {
    if (!canClarifyFabricDataAgentRoute(input)) return { questionId: question.id, relevance: "hidden", priority: 900, reason: "No Fabric source selected." };
    return {
      questionId: question.id,
      relevance: input.fabricAnalyticsIntent ? "resolved" : "conditional_now",
      priority: 9,
      reason: "Confirm whether Fabric needs natural-language analytics or only governed reports, APIs, storage, or processing."
    };
  }

  if (question.id === "fabricUserAccess") {
    if (!canClarifyFabricDataAgentRoute(input)) return { questionId: question.id, relevance: "hidden", priority: 900, reason: "No Fabric source selected." };
    return {
      questionId: question.id,
      relevance: input.fabricUserAccess ? "resolved" : "conditional_now",
      priority: 10,
      reason: "Confirm the identity and permissions model for Fabric analytics, reports, APIs, or storage access."
    };
  }

  if (question.id === "workflowExecution") {
    if (hasWorkflowExecutionResponse(input)) return { questionId: question.id, relevance: "resolved", priority: 12, reason: "Workflow execution intent has already been clarified." };
    if (!needsQuestion(input, question.id)) return { questionId: question.id, relevance: "hidden", priority: 900, reason: "Workflow is either not selected or already confirmed as action-taking." };
    return { questionId: question.id, relevance: "conditional_now", priority: 12, reason: "Workflow intent needs clarification before choosing read-only versus transaction architecture." };
  }

  if (question.id === "externalAccessConfirmed") {
    if (!hasExternalUser(input) || !hasExternalChannel(input)) return { questionId: question.id, relevance: "hidden", priority: 900, reason: "No external user plus external channel route selected." };
    return {
      questionId: question.id,
      relevance: hasExternalAccessResponse(input) ? "resolved" : "conditional_now",
      priority: 13,
      reason: "External channels need edge posture confirmation for APIM/WAF."
    };
  }

  if (question.id === "m365ExtensibilityRequired") {
    if (!wantsM365SdkQuestion(input)) return { questionId: question.id, relevance: "hidden", priority: 900, reason: "Normal Teams/Copilot Studio scenarios do not need M365 Agents SDK clarification." };
    return {
      questionId: question.id,
      relevance: hasM365ExtensibilityResponse(input) ? "resolved" : "conditional_now",
      priority: 14,
      reason: "M365 Agents SDK is only relevant for explicit SDK or extensibility needs."
    };
  }

  if (BROAD_LATE_GATES.has(question.id)) {
    if (question.id === "lifecycleControls") {
      if (wantsFoundryLifecycle(input) || input.lifecycleControls.includes("unknown") || mentions(input, /evaluation|tracing|monitoring|governance/i)) {
        return { questionId: question.id, relevance: answered(input, question) ? "resolved" : "conditional_now", priority: 30, reason: "Foundry lifecycle controls were explicitly indicated or are ambiguous." };
      }
      return { questionId: question.id, relevance: "optional_later", priority: 70, reason: "Foundry lifecycle does not change this route unless explicitly required." };
    }
    if (question.id === "modelStrategy") {
      if (wantsModelStrategyQuestion(input)) {
        return {
          questionId: question.id,
          relevance: answered(input, question) ? "resolved" : "conditional_now",
          priority: 12,
          reason: "Model choices can add a multi-model portfolio across Azure OpenAI, Foundry model deployments, and Azure Machine Learning endpoints."
        };
      }
      return {
        questionId: question.id,
        relevance: "optional_later",
        priority: 69,
        reason: "Standard managed model deployment is sufficient unless multiple, custom, fine-tuned, Foundry, or Azure ML models are required."
      };
    }
    if (question.id === "runtimePreferences") {
      if (input.runtimePreferences.includes("unknown")) {
        return { questionId: question.id, relevance: "conditional_now", priority: 31, reason: "Runtime preference is unknown and could affect custom or Foundry routing." };
      }
      if (input.runtimePreferences.some((r) => !["none", "unknown"].includes(r))) {
        return { questionId: question.id, relevance: "resolved", priority: 31, reason: "Runtime preference is already explicit." };
      }
      if (mentions(input, /foundry agent|custom backend|app service|container apps|aks|azure functions|runtime|orchestrat/i)) {
        return { questionId: question.id, relevance: "conditional_now", priority: 31, reason: "Runtime choice can materially change custom app, external channel, advanced RAG, Fabric, or Foundry tool orchestration." };
      }
      return { questionId: question.id, relevance: "optional_later", priority: 71, reason: "Runtime can be derived from the likely managed pattern." };
    }
    if (question.id === "securityControls") {
      if (input.securityControls.includes("unknown")) {
        return { questionId: question.id, relevance: "conditional_now", priority: 32, reason: "Security controls are unknown and could affect the architecture." };
      }
      if (answered(input, question)) {
        return { questionId: question.id, relevance: "resolved", priority: 32, reason: "Security controls are already explicit." };
      }
      return { questionId: question.id, relevance: answered(input, question) ? "resolved" : "optional_later", priority: 72, reason: "Baseline identity and least-privilege controls can be derived." };
    }
    if (question.id === "networkControls") {
      if (input.networkControls.includes("unknown")) {
        return { questionId: question.id, relevance: "conditional_now", priority: 33, reason: "Network posture is unknown and could affect deployment architecture." };
      }
      if (wantsHybridOverlay(input)) {
        return {
          questionId: question.id,
          relevance: answered(input, question) ? "resolved" : "conditional_now",
          priority: 33,
          reason: answered(input, question)
            ? "Private, hybrid, regulated, or on-prem controls are already explicit."
            : "Private, hybrid, regulated, or on-prem intent was detected; network posture should be confirmed."
        };
      }
      return { questionId: question.id, relevance: "optional_later", priority: 73, reason: "No private/hybrid trigger is selected, so public SaaS/default deployment is sufficient." };
    }
  }

  return {
    questionId: question.id,
    relevance: answered(input, question) ? "resolved" : question.required ? "required_now" : "optional_later",
    priority: question.required ? 50 : 80,
    reason: question.required ? "Required by the static question model." : "Optional refinement."
  };
}

export function getOptionStates(rawInput: DecisionInput, question: WizardQuestion): AdaptiveOptionState[] {
  const input = normalize(rawInput);
  const selected = new Set<string>(Array.isArray(question.read?.(input)) ? question.read?.(input) : [question.read?.(input)].filter(Boolean));
  return (question.options ?? []).map((option) => {
    let visible = true;
    let disabled = false;
    let reason = "";
    const id = option.id;

    if (question.id === "runtimePreferences") {
      if (id === "m365_agents_sdk" && !selected.has(id) && !wantsM365SdkQuestion(input)) {
        visible = false;
        reason = "M365 Agents SDK is only needed for explicit M365 extensibility or SDK scaffolding.";
      }
      if (id === "aks" && !selected.has(id) && !input.runtimePreferences.includes("custom_backend") && !input.capabilities.includes("custom_app")) {
        visible = false;
        reason = "AKS is only relevant when a custom code-first backend is needed.";
      }
    }
    if (question.id === "lifecycleControls" && id !== "none" && id !== "unknown" && !selected.has(id) && !wantsFoundryLifecycle(input)) {
      reason = "Only select this if Foundry lifecycle controls are explicitly required.";
    }
    if (question.id === "networkControls" && HYBRID_TRIGGERS.includes(id as any) && !selected.has(id) && !wantsHybridOverlay(input)) {
      reason = "Only select this if private, hybrid, regulated, or on-prem deployment is required.";
    }
    if (question.id === "advancedRagRequirements" && id !== "none" && id !== "unknown" && !selected.has(id)) {
      reason = "Select only when a dedicated Azure AI Search/custom RAG layer is required.";
    }
    if (question.id === "capabilities" && id === "document_rag" && !selected.has(id)) {
      reason = "Document Q&A/RAG intent; the next clarification decides native knowledge versus Azure AI Search.";
    }

    if (id === "unknown") {
      visible = true;
      disabled = false;
    }
    if (selected.has(id)) visible = true;

    return { optionId: id, visible, disabled, selected: selected.has(id), reason: reason || undefined };
  });
}

export function canGenerateRecommendation(rawInput: DecisionInput): {
  ready: boolean;
  reason: string;
  missingQuestionIds: string[];
} {
  const input = normalize(rawInput);
  const missing: string[] = [];
  for (const id of ["users", "channels", "capabilities", "dataSources", "behaviors"]) {
    if (((input as any)[id] ?? []).length === 0) missing.push(id);
  }
  if (input.capabilities.includes("document_rag") && !hasDocumentRepository(input) && !missing.includes("dataSources")) {
    missing.push("dataSources");
  }
  for (const id of ["fabricAnalyticsIntent", "fabricUserAccess", "advancedRagRequirements", "semanticModelConfirmations", "workflowExecution", "externalAccessConfirmed", "m365ExtensibilityRequired"]) {
    if (needsQuestion(input, id)) missing.push(id);
  }
  if (needsQuestion(input, "modelStrategy")) missing.push("modelStrategy");
  if (missing.length > 0) {
    return { ready: false, reason: "Answer a few more questions and we'll show your recommendation.", missingQuestionIds: missing };
  }
  const candidates = candidateBasePatterns(input);
  if (candidates.length === 0) {
    return { ready: false, reason: "Tell us a little more so we can suggest the right option.", missingQuestionIds: ["capabilities"] };
  }
  if ((input.advancedRagRequirements ?? []).includes("unknown")) {
    return { ready: true, reason: "Ready to show. We assumed standard document search — you can confirm that later.", missingQuestionIds: [] };
  }
  if ((input.workflowExecution ?? []).includes("unknown")) {
    return { ready: true, reason: "Ready to show. We assumed it only guides people rather than making changes — you can confirm that later.", missingQuestionIds: [] };
  }
  if (input.fabricAnalyticsIntent === "unknown" || input.fabricUserAccess === "unknown") {
    return { ready: true, reason: "Ready to show. We made a safe assumption about your data access — you can confirm that later.", missingQuestionIds: [] };
  }
  return { ready: true, reason: "We have enough to recommend the right option for you.", missingQuestionIds: [] };
}

export function buildAdaptiveWizardState(rawInput: DecisionInput): AdaptiveWizardState {
  const normalizedInput = normalize(rawInput);
  const candidates = candidateBasePatterns(normalizedInput);
  const readiness = canGenerateRecommendation(normalizedInput);

  const confidence = computeConfidenceLevel(
    normalizedInput,
    candidates,
    readiness.missingQuestionIds.length
  );

  return {
    normalizedInput,
    candidateBasePatterns: candidates,
    likelyBasePattern: candidates[0],
    confidence,
    unresolvedCriticalQuestions: readiness.missingQuestionIds,
    optionalQuestions: [],
    hiddenQuestions: [],
    optionStates: {},
    canGenerateRecommendation: readiness.ready,
    recommendationReadinessReason: readiness.reason,
    skippedCount: 0
  };
}

export function classifyAdaptiveQuestions(
  rawInput: DecisionInput,
  questions: WizardQuestion[]
): AdaptiveWizardState {
  const base = buildAdaptiveWizardState(rawInput);
  const plans = questions.map((q) => getQuestionRelevance(base.normalizedInput, q));
  const actualCritical = plans
    .filter((p) => ["required_now", "conditional_now"].includes(p.relevance))
    .filter((p) => {
      const q = questions.find((item) => item.id === p.questionId);
      return q ? !answered(base.normalizedInput, q) || needsQuestion(base.normalizedInput, q.id) : true;
    })
    .sort((a, b) => a.priority - b.priority)
    .map((p) => p.questionId);
  const optionalQuestions = plans
    .filter((p) => p.relevance === "optional_later")
    .sort((a, b) => a.priority - b.priority)
    .map((p) => p.questionId);
  const hiddenQuestions = plans.filter((p) => p.relevance === "hidden" || p.relevance === "blocked" || p.relevance === "optional_later");
  const optionStates = Object.fromEntries(questions.map((q) => [q.id, getOptionStates(base.normalizedInput, q)]));
  const nextId = actualCritical[0] ?? (base.canGenerateRecommendation ? undefined : optionalQuestions[0]);
  const nextPlan = nextId ? plans.find((p) => p.questionId === nextId) : undefined;
  return {
    ...base,
    unresolvedCriticalQuestions: actualCritical,
    optionalQuestions: base.canGenerateRecommendation ? [] : optionalQuestions,
    hiddenQuestions,
    optionStates,
    skippedCount: hiddenQuestions.length,
    nextQuestionReason: nextPlan?.reason
  };
}
