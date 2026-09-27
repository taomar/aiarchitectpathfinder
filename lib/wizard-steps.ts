import type { DecisionInput, WizardQuestion } from "./types";
import { applicableQuestions } from "./questions";

export type WizardStepId =
  | "scenario"
  | "access"
  | "work"
  | "knowledge"
  | "build"
  | "security";

export type WizardStep = {
  id: WizardStepId;
  title: string;
  shortTitle: string;
  description: string;
  questionIds: string[];
};

export type ApplicableWizardStep = WizardStep & {
  questions: WizardQuestion[];
};

export const WIZARD_VERSION = "7.0";

export const WIZARD_STEPS: WizardStep[] = [
  {
    id: "scenario",
    title: "Tell us the scenario",
    shortTitle: "Scenario",
    description: "Start with a short description. This helps the recommendation read like your real use case.",
    questionIds: ["summary"]
  },
  {
    id: "access",
    title: "Users and access",
    shortTitle: "Users",
    description: "Define who uses the assistant and where they will open it.",
    questionIds: ["users", "channels", "externalAccessConfirmed"]
  },
  {
    id: "work",
    title: "What it should do",
    shortTitle: "Work",
    description: "Choose the jobs the assistant performs, including whether it only answers or also takes action.",
    questionIds: ["capabilities", "behaviors", "workflowExecution"]
  },
  {
    id: "knowledge",
    title: "Data and knowledge",
    shortTitle: "Data",
    description: "Select the information sources and answer any Fabric, document, or semantic-model follow-ups.",
    questionIds: [
      "dataSources",
      "advancedRagRequirements",
      "fabricAnalyticsIntent",
      "fabricUserAccess",
      "semanticModelConfirmations"
    ]
  },
  {
    id: "build",
    title: "Build choices",
    shortTitle: "Build",
    description: "Add known implementation choices only when they are already required.",
    questionIds: ["runtimePreferences", "lifecycleControls", "modelStrategy", "m365ExtensibilityRequired"]
  },
  {
    id: "security",
    title: "Security and deployment",
    shortTitle: "Security",
    description: "Capture required identity, security, private network, and deployment constraints.",
    questionIds: ["securityControls", "networkControls"]
  }
];

export function stepForQuestionId(questionId: string): WizardStep | undefined {
  return WIZARD_STEPS.find((step) => step.questionIds.includes(questionId));
}

export function applicableWizardSteps(input: DecisionInput): ApplicableWizardStep[] {
  const questions = applicableQuestions(input);
  const byId = new Map(questions.map((question) => [question.id, question]));
  return WIZARD_STEPS.map((step) => ({
    ...step,
    questions: step.questionIds
      .map((id) => byId.get(id))
      .filter((question): question is WizardQuestion => Boolean(question))
  })).filter((step) => step.questions.length > 0);
}