import {
  AdvancedRagRequirement,
  AgentBehavior,
  Capability,
  Channel,
  DataSource,
  DecisionInput,
  FabricAnalyticsIntent,
  LifecycleControl,
  ModelStrategy,
  NetworkControl,
  RuntimePreference,
  SecurityControl,
  UserType,
  emptyInput
} from "./types";
import { normalizeDecisionInput } from "./input-normalization";
import { DIRECT_ACTIONABLE_BEHAVIORS, DIRECT_ACTIONABLE_CAPABILITIES } from "./rules";

const add = <T extends string>(items: T[], value: T) => {
  if (!items.includes(value)) items.push(value);
};

const has = (text: string, pattern: RegExp) => pattern.test(text);

const NEGATION_CUE =
  /\bnot\b|\bno\b|\bnever\b|\bwithout\b|\bavoids?\b|\bavoiding\b|\bdon'?t\b|\bdoes\s+not\b|\bdo\s+not\b|\bwon'?t\b|\bwill\s+not\b|\bcannot\b|\bcan'?t\b|\bno\s+need\b|\brather\s+than\b|\binstead\s+of\b|\bother\s+than\b|\bexcept\b/i;

/**
 * True only when `pattern` matches AND at least one match is NOT preceded by a
 * negation cue in the same clause. Prevents phrases like "do not update client
 * records" or "not provide transaction advice" from inferring action capabilities
 * (record_update / transaction / approval) that would wrongly route a read-only
 * scenario to an action-taking agent.
 */
function hasUnnegated(text: string, pattern: RegExp): boolean {
  const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
  const re = new RegExp(pattern.source, flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const windowStart = Math.max(0, match.index - 40);
    const preceding = text.slice(windowStart, match.index);
    // Only consider negation within the same clause (no sentence break in between).
    const clause = preceding.split(/[.;\n]|\bbut\b|\bhowever\b/i).at(-1) ?? "";
    if (!NEGATION_CUE.test(clause)) return true;
    if (re.lastIndex === match.index) re.lastIndex++;
  }
  return false;
}

function hasM365TenantContext(text: string) {
  return has(text, /\b(?:microsoft\s*365|m365|office\s*365|office365|sharepoint|share point|teams)\b/i);
}

function hasM365LicenseOnlyContext(text: string) {
  return has(text, /\b(?:company|agency|customer|tenant|organization|org|we|i|they|the team)\s+(?:already\s+)?(?:has|have|uses|use|owns|own)\s+(?:an?\s+)?(?:office\s*365|office365|microsoft\s*365|m365)\s+licen[cs]es?\b/i) ||
    has(text, /\b(?:company|agency|customer|tenant|organization|org|we|i|they|the team)\s+(?:already\s+)?(?:has|have|uses|use|owns|own)\s+(?:an?\s+)?(?:office\s*365|office365|microsoft\s*365|m365)\b/i) ||
    has(text, /\b(?:office\s*365|office365|microsoft\s*365|m365)\s+licen[cs]es?\b/i);
}

function hasExplicitM365Experience(text: string) {
  return has(text, /\b(?:in|inside|within|from|through)\s+(?:microsoft\s*365|m365|office\s*365|office365|microsoft\s*365\s*copilot|m365\s*copilot)\b/i) ||
    has(text, /\b(?:microsoft\s*365|m365)\s+copilot\b|\bteams\b/i);
}

function hasSimplePathSignal(text: string) {
  return has(text, /\b(?:simple|simplest|easiest|easy|quick|native|built[-\s]?in|out[-\s]?of[-\s]?the[-\s]?box|existing)\b/i) ||
    has(text, /\b(?:already\s+have|have|has|using|existing)\s+(?:an?\s+)?(?:office\s*365|office365|microsoft\s*365|m365)\s+licen[cs]e\b/i) ||
    has(text, /\b(?:office\s*365|office365|microsoft\s*365|m365)\s+licen[cs]e\b/i);
}

function inferUsers(text: string): UserType[] {
  const users: UserType[] = [];
  // Developers: software / dev roles only (so "quality engineers" is NOT a developer).
  const devRole = has(text, /\b(developers?|dev team|software\s+engineers?|software\s+developers?|ml\s+engineers?|data\s+engineers?|engineering\s+team|sdk)\b/i);
  // Internal employees: explicit employee/staff terms.
  if (has(text, /\b(employee|employees|staff|worker|workers|internal|colleague|colleagues|analyst|analysts|executive|executives|hr|sales team|underwriters?|controllers?|technicians?|operators?|associates?|clinicians?|practitioners?)\b/i)) add(users, "internal_employees");
  // Possessive professional roles ("our quality engineers", "our 620 sales managers",
  // "our controllers") are internal employees — unless they are explicitly software/dev.
  const domainProfessional = has(text, /\b(?:our|their|its)\s+(?:[\w,]+[-\s]+){0,3}(engineers?|technicians?|operators?|controllers?|underwriters?|specialists?|consultants?|advisors?|representatives?|clinicians?|practitioners?|managers?|agents?|professionals?|workforce)\b/i);
  if (!devRole && domainProfessional) add(users, "internal_employees");
  const customerOrgReference = has(text, /\b(?:my|our|a|the|this)\s+customer\s+(?:is|has|wants|needs|asked|interested|will|would|who)\b|\bcustomer\s+(?:is interested|has|wants|needs|asked)\b/i);
  const explicitExternalEndUsers = has(text, /\b(?:their|its|the)\s+customers?\b|\bcustomer'?s\s+customers?\b|\bend\s+users?\b|\bpolicyholders?\b/i);
  // "members" and "client(s)" are intentionally NOT treated as unconditional external
  // users: "team members", "staff members", and "our client" are usually internal.
  // External membership is only inferred from the explicit "members of the public" phrase.
  const externalCustomerUsers = has(text, /\bexternal\s+customers?\b|\bcustomers?\s+(?:use|uses|will use|need|needs|can|should|ask|asks|chat|chats|open|opens|access|accesses)\b|\bclients?\s+(?:use|uses|will use|need|needs|can|should|ask|asks|chat|chats|open|opens|access|accesses)\b|\b(?:customer'?s\s+customers?|end\s+users?|policyholders?|consumers?)\b|\bmembers\s+of\s+the\s+public\b/i);
  if (explicitExternalEndUsers || (externalCustomerUsers && !customerOrgReference)) add(users, "external_customers");
  if (has(text, /\b(citizen|citizens|resident|residents|public users?|public audience)\b/i)) add(users, "citizens");
  // Partners: "partner(s)" / "b2b" / "reseller(s)" / "distributor(s)", OR supplier/vendor
  // ONLY when described as actors ("suppliers log in", "onboard suppliers") — never from
  // "supplier documents" / "vendor records", which are data ABOUT suppliers, not users.
  const partnerWord = has(text, /\b(partner|partners|b2b|reseller|resellers|distributor|distributors)\b/i);
  const supplierActor =
    has(text, /\b(?:supplier|suppliers|vendor|vendors)\s+(?:use|uses|using|log|logs|login|access|accesses|sign|signs|submit|submits|self[-\s]?service|can|should|will|would|need|needs|ask|asks|onboard|register)\b/i) ||
    has(text, /\b(?:onboard|onboarding|register|registering|invite|inviting)\s+(?:our\s+|new\s+|the\s+)?(?:suppliers|vendors)\b/i);
  if (partnerWord || supplierActor) add(users, "partners");
  if (has(text, /\b(admin|admins|administrator|administrators|it admin|tenant admin)\b/i)) add(users, "admins");
  if (devRole) add(users, "developers");
  if (users.length === 0 && hasM365TenantContext(text)) add(users, "internal_employees");
  return users.length ? users : ["unknown"];
}

function inferChannels(text: string, users: UserType[]): Channel[] {
  const channels: Channel[] = [];
  if (has(text, /\bmicrosoft\s*365\s*copilot\b|\bm365\s*copilot\b/i)) add(channels, "m365_copilot");
  if (has(text, /\bteams\b|\bms teams\b/i)) add(channels, "teams");
  if (has(text, /\bmicrosoft\s*365\b|\bm365\b|\boffice\s*365\b|\boffice365\b/i)) add(channels, "m365");
  // "search the web" / "web search" describes internet grounding, not a web delivery channel.
  const webSearchGrounding = has(text, /\b(?:search|searching|searches|browse|browsing|crawl)\s+(?:the\s+)?(?:public\s+)?(?:web|internet)\b|\bweb\s+search\b|\binternet\s+search\b/i);
  if (has(text, /\bwebsite\b|\bweb\s?app\b|\bwebapp\b|\bchatbot\b|\bpublic page\b/i) || (!webSearchGrounding && has(text, /\bweb\b/i))) add(channels, "web");
  if (has(text, /\bmobile\b|\bios\b|\bandroid\b/i)) add(channels, "mobile");
  if (has(text, /\bportal\b/i)) add(channels, "portal");
  if (has(text, /\bapi\b|\bapis\b/i)) add(channels, "api");
  if (has(text, /\bembedded\b|\bembed\b|\bin another app\b/i)) add(channels, "embedded");

  if (channels.length === 0 && users.some((user) => ["external_customers", "citizens", "partners"].includes(user))) {
    if (has(text, /\bwebsite\b|\bweb\s*app\b|\bportal\b|\bpublic\s+page\b|\bbrowser\b/i)) add(channels, "web");
  }
  if (channels.length === 0 && users.includes("citizens")) add(channels, "web");
  if (channels.length === 0 && users.includes("internal_employees") && has(text, /\bassistant\b|\bagent\b|\bcopilot\b|\bask\b|\bquestions?\b/i)) {
    add(channels, "teams");
  }
  if (channels.includes("m365") && hasM365LicenseOnlyContext(text) && !hasExplicitM365Experience(text) && users.some((user) => ["external_customers", "citizens", "partners"].includes(user))) {
    const withoutM365 = channels.filter((channel) => channel !== "m365");
    if (withoutM365.length > 0) return withoutM365;
    if (users.includes("citizens") || has(text, /\bpublic\b/i)) return ["web"];
    return ["unknown"];
  }
  return channels.length ? channels : ["unknown"];
}

function inferDataSources(text: string): DataSource[] {
  const sources: DataSource[] = [];
  const deniesFabric = has(text, /\b(?:no|without|not using|not use|does not use|don't use|do not use)\s+(?:fabric|fabric\s+or\s+power\s*bi|power\s*bi\s+or\s+fabric)\b/i);
  const deniesPowerBi = has(text, /\b(?:no|without|not using|not use|does not use|don't use|do not use)\s+(?:power\s*bi|semantic\s+model|fabric\s+or\s+power\s*bi|power\s*bi\s+or\s+fabric)\b/i);
  if (has(text, /\bgraph\b|\bmicrosoft graph\b|\bm365 content\b|\bmail\b|\boutlook\b|\bcalendar\b/i)) add(sources, "m365_graph");
  if (has(text, /\bsharepoint\b|\bshare point\b/i)) add(sources, "sharepoint");
  if (!deniesFabric && has(text, /\bonelake\b|\bone lake\b/i)) add(sources, "fabric_onelake");
  if (!deniesFabric && has(text, /\blakehouse\b/i)) add(sources, "fabric_lakehouse");
  if (!deniesFabric && hasUnnegated(text, /\bfabric\b[^.;\n]{0,50}\bwarehouse\b/i)) add(sources, "fabric_warehouse");
  if (!deniesPowerBi && hasUnnegated(text, /\bpower\s*bi\b|\bsemantic model\b|\bsemantic-model\b/i)) add(sources, "powerbi_semantic_model");
  if (!deniesFabric && has(text, /\bkql\b|\beventhouse\b|\bevent house\b|\bkusto\b/i)) add(sources, "kql_eventhouse");
  if (has(text, /\bpdf\b|\bpdfs\b|\bdoc\b|\bdocs\b|\bdocument\b|\bdocuments\b|\bfile\b|\bfiles\b|\bmanual\b|\bmanuals\b|\bpolicy\b|\bpolicies\b|\bkb\b|\bknowledge base\b|\bknowledge article\b|\bknowledge articles\b|\bcontent library\b|\bfile library\b/i)) add(sources, "documents");
  if (has(text, /\bblob\b|\bblob storage\b|\bstorage account\b/i)) add(sources, "blob_storage");
  if (has(text, /\bazure sql\b|\bsql database\b|\bsql db\b|\bsql server\b/i)) add(sources, "azure_sql");
  if (has(text, /\bdataverse\b|\bdynamics\b|\bpower platform data\b/i)) add(sources, "dataverse");
  if (has(text, /\bbackend\s+apis?\b|\bbusiness\s+apis?\b|\binternal\s+apis?\b|\bexternal\s+apis?\b|\bapi\s+integration\b|\bintegrat\w*\s+(?:with\s+)?(?:an?\s+|the\s+)?apis?\b|\bcall(?:s|ing)?\s+(?:an?\s+|the\s+|external\s+|internal\s+)?apis?\b|\brest\s+apis?\b|\bservice endpoint\b/i)) add(sources, "apis");
  // Line-of-business / operational backend systems described in plain language. These are
  // governed structured sources reached through a connector/API, so they map to "apis"
  // (an operational structured source) rather than documents — e.g. "our ordering system",
  // "factory systems", "back-office systems", "order entry".
  if (has(text, /\b(?:ordering|order|back[-\s]?office|back[-\s]?end|backend|factory|line[-\s]?of[-\s]?business|lob|operational|ticketing|case[-\s]?management|inventory|scheduling|billing|fulfil?ment|logistics|warehouse management|point[-\s]?of[-\s]?sale|pos)\s+systems?\b|\border\s+(?:entry|management|processing)\b|\bordering system\b/i)) add(sources, "apis");
  if (has(text, /\berp\b|\bcrm\b|\bsap\b|\bsalesforce\b|\bdynamics 365\b/i)) add(sources, "erp_crm");
  if (has(text, /\bon[-\s]?prem\b|\bon premises\b|\blegacy system\b|\bmainframe\b/i)) add(sources, "on_prem");
  if (has(text, /\binternet\b|\bpublic web\b|\bweb search\b|\bpublic website\b/i)) add(sources, "internet");
  return sources.length ? sources : ["unknown"];
}

function inferCapabilities(text: string, users: UserType[], channels: Channel[], dataSources: DataSource[]): Capability[] {
  const capabilities: Capability[] = [];
  const deniesFabricOrPowerBi = has(text, /\b(?:no|without|not using|not use|does not use|don't use|do not use)\s+(?:fabric|power\s*bi|semantic\s+model|fabric\s+or\s+power\s*bi|power\s*bi\s+or\s+fabric)\b/i);
  if (has(text, /\bpersonal productivity\b|\bmy emails\b|\bmy calendar\b|\bmy files\b/i)) add(capabilities, "personal_productivity");
  if (users.includes("internal_employees") && has(text, /\bassistant\b|\bagent\b|\bcopilot\b|\bhelp employees\b|\bemployee\b/i)) add(capabilities, "employee_assistant");
  if (dataSources.some((source) => ["fabric_onelake", "fabric_lakehouse", "fabric_warehouse", "powerbi_semantic_model", "kql_eventhouse"].includes(source)) || (!deniesFabricOrPowerBi && has(text, /\bfabric\b|\bpower\s*bi\b|\bsemantic\s+model\b|\bonelake\b|\blakehouse\b|\bkql\b|\beventhouse\b/i))) add(capabilities, "fabric_analytics");
  if (dataSources.some((source) => ["documents", "blob_storage", "sharepoint"].includes(source)) || has(text, /\brag\b|\bdocument q&a\b|\bdocs?\b|\bknowledge base\b|\bknowledge articles?\b|\bcontent library\b|\bmanuals?\b|\bpolicies\b/i)) add(capabilities, "document_rag");
  if (dataSources.some((source) => ["azure_sql", "dataverse", "apis", "erp_crm", "on_prem"].includes(source)) || has(text, /\blook[-\s]?up\b|\boperational\b|\bquer(?:y|ies)\s+(?:the\s+)?(?:database|db|sql|table|records?|system|backend)\b|\b(?:sql|database)\s+quer(?:y|ies)\b|\b(?:customer|order|transaction|account|patient|claim|inventory|policy)\s+records?\b|\brecord\s+(?:lookup|system|store)\b/i)) add(capabilities, "operational_query");
  if (has(text, /\bworkflow\b|\bprocess\b|\bcase management\b/i)) add(capabilities, "business_workflow");
  // Business nouns describe data as often as actions; require execution intent.
  if (hasUnnegated(text, /\bapprov(?:es?|ing)\b|\b(?:request|require|route|obtain|human)\s+(?:an?\s+)?approvals?\b|\bapproval\s+(?:workflow|flow|step|process|request)s?\b|\bwith\s+(?:human\s+)?approval\b/i)) add(capabilities, "approval");
  if (hasUnnegated(text, /\bsubmit(?:s|ting)?\b|\brenew(?:s|ing)?\b|\bcancel(?:s|ling|ing)?\b|\b(?:place|create|process|execute|make)\s+(?:(?:a|an|the|new|customer)\s+)?(?:payments?|orders?|transactions?|bookings?)\b|\bbook(?:s|ing)?\s+(?:an?\s+|the\s+)?(?:appointment|flight|room|meeting|travel)\b/i)) add(capabilities, "transaction");
  if (hasUnnegated(text, /\bupdate\b|\bwrite back\b|\bwrite-back\b|\bcreate record\b|\bmodify\b|\bchange record\b/i)) add(capabilities, "record_update");
  if (has(text, /\bmulti[-\s]?agent\b|\bmultiple agents\b|\bagent swarm\b/i)) add(capabilities, "multi_agent");
  if (channels.some((channel) => ["web", "mobile", "portal", "api", "embedded"].includes(channel)) || has(text, /\bcustom app\b|\bcustom application\b|\bportal\b|\bmobile app\b|\bweb app\b/i)) add(capabilities, "custom_app");
  return capabilities.length ? capabilities : ["unknown"];
}

function inferBehaviors(text: string, capabilities: Capability[]): AgentBehavior[] {
  const behaviors: AgentBehavior[] = [];
  if (has(text, /\bask\b|\bquestion\b|\bquestions\b|\bq&a\b|\banswer\b|\banswers\b|\bchat\b/i)) add(behaviors, "qa");
  if (capabilities.includes("fabric_analytics") || has(text, /\banaly[sz]e\b|\banalytics\b|\bmetrics?\b|\bpower\s*bi\b|\breport\b|\bdashboard\b/i)) add(behaviors, "analytics");
  if (has(text, /\bsearch\b|\bfind\b|\bretrieve\b|\bretrieval\b|\bcitation\b|\bcitations\b/i)) add(behaviors, "retrieval");
  if (has(text, /\bread[-\s]?only\b|\blookup\b|\blook up\b|\bquery\b/i)) add(behaviors, "read_only_query");
  if (has(text, /\bsummarize\b|\bsummarise\b|\bsummary\b/i)) add(behaviors, "summarization");
  if (has(text, /\brecommend\b|\bsuggest\b|\bnext best\b|\bguidance\b/i)) add(behaviors, "recommendation");
  if (capabilities.includes("record_update")) add(behaviors, "record_update");
  if (capabilities.includes("business_workflow")) add(behaviors, "workflow");
  if (capabilities.includes("approval")) add(behaviors, "approval");
  if (capabilities.includes("transaction")) add(behaviors, "transaction");
  if (has(text, /\blong[-\s]?running\b|\bmulti[-\s]?step\b/i)) add(behaviors, "long_running_process");
  if (capabilities.includes("multi_agent")) add(behaviors, "multi_agent");
  return behaviors.length ? behaviors : ["qa"];
}

function inferLifecycle(text: string): LifecycleControl[] {
  const lifecycle: LifecycleControl[] = [];
  if (has(text, /\bevaluat(e|ion)\b|\bquality testing\b/i)) add(lifecycle, "evaluation");
  if (has(text, /\btrace\b|\btracing\b|\bdebug\b/i)) add(lifecycle, "tracing");
  if (has(text, /\bmonitor\b|\bmonitoring\b|\bobservability\b|\bkeep checking\b|\bkeep track of\b|\bhow well (?:the|our|their|it) .{0,30}perform/i)) add(lifecycle, "monitoring");
  if (has(text, /\bsafety testing\b|\bred team\b|\bcontent safety\b/i)) add(lifecycle, "safety_testing");
  if (has(text, /\bprompt version\b|\bprompt management\b/i)) add(lifecycle, "prompt_versioning");
  if (has(text, /\bmodel version\b|\bmodel registry\b|\bretrain\b|\bmodel drift\b|\bmodel performs? over time\b|\bperformance over time\b|\bhow well (?:the|our|their) model performs?\b/i)) add(lifecycle, "model_versioning");
  if (has(text, /\bmodel routing\b|\broute between models\b/i)) add(lifecycle, "model_routing");
  if (has(text, /\bai governance\b|\bmodel governance\b|\bgovernance controls?\b|\bgovernance required\b/i)) add(lifecycle, "governance");
  return lifecycle;
}

function inferRuntime(text: string): RuntimePreference[] {
  const runtime: RuntimePreference[] = [];
  if (has(text, /\bcopilot studio\b/i)) add(runtime, "copilot_studio");
  if (has(text, /\bcustom backend\b|\bcode[-\s]?first\b|\bcustom api\b/i)) add(runtime, "custom_backend");
  if (has(text, /\bfoundry agent service\b|\bazure ai foundry agent\b/i)) add(runtime, "foundry_agent_service");
  if (has(text, /\bmicrosoft 365 agents sdk\b|\bm365 agents sdk\b/i)) add(runtime, "m365_agents_sdk");
  if (has(text, /\bazure functions\b|\bfunction app\b/i)) add(runtime, "functions");
  if (has(text, /\bapp service\b/i)) add(runtime, "app_service");
  if (has(text, /\bcontainer apps\b/i)) add(runtime, "container_apps");
  if (has(text, /\baks\b|\bkubernetes\b/i)) add(runtime, "aks");
  return runtime;
}

function inferModelStrategy(text: string): ModelStrategy[] {
  const models: ModelStrategy[] = [];
  if (has(text, /\bclaude\b|\banthropic\b/i)) add(models, "anthropic_claude");
  if (has(text, /\bxai\b|\bx\.ai\b|\bgrok[-\s]?\d|\bgrok\b(?!\s+(?:the|this|that|it|its|what|how|why|a|an|our|your|their|my|all|everything|some)\b)/i)) add(models, "xai_grok");
  if (has(text, /\bfoundry model catalog\b|\bopen model\b|\bcatalog model\b|\bmeta\s+llama\b|\bllama\b|\bmistral\b|\bcohere\b|\bnvidia\b|\bhugging\s*face\b|\bhuggingface\b/i)) add(models, "foundry_model_catalog");
  if (has(text, /\bfine[-\s]?tuned azure openai\b/i)) add(models, "fine_tuned_azure_openai");
  if (has(text, /\bfine[-\s]?tuned\b|\bfine tuning\b/i)) add(models, "fine_tuned_foundry_model");
  if (has(text, /\bcustom ml model\b|\btrained model\b/i)) add(models, "azure_ml_custom_model");
  // "train a model on our data" / "risk-scoring model" / "build our own model" → custom
  // model training on Azure Machine Learning.
  if (has(text, /\btrain(?:s|ing|ed)?\s+(?:a|an|our|their|your|the|its|new|custom|our own|its own)?\s*(?:ai|ml|machine[-\s]?learning|predictive|custom|risk[-\s]?scoring|scoring|classification)?\s*model\b|\btrain\b[^.]*\bon\s+(?:our|their|your)(?:\s+own)?\s+[\w\s]*data\b|\b(?:predictive|risk[-\s]?scoring|classification|propensity|churn|defect)\s+model\b|\bbuild (?:a|an|our)\s+(?:own\s+)?model\b/i)) add(models, "azure_ml_custom_model");
  if (has(text, /\bazure ml endpoint\b|\bmanaged online endpoint\b/i)) add(models, "azure_ml_endpoint");
  if (has(text, /\bbring your own model\b|\bbyo model\b|\bexternal model\b|\bnon[-\s]?azure openai model\b|\bnot azure openai\b/i)) add(models, "bring_your_own_model");
  // "try a few different AI models side by side", "compare models", "multiple models" =>
  // a multi-model portfolio governed through Azure AI Foundry model operations.
  if (has(text, /\b(?:try|compare|test|evaluate|experiment with|benchmark|pick between|choose between)\b[^.]{0,40}\b(?:different|several|multiple|various|a few|side[-\s]by[-\s]side|competing|candidate)\b[^.]{0,20}\bmodels?\b|\bmodels?\s+side[-\s]by[-\s]side\b|\bmultiple\s+(?:ai\s+|llm\s+)?models?\b|\bdifferent\s+(?:ai\s+|llm\s+)?models?\b|\bmodel\s+selection\b|\bswitch\s+between\s+models?\b/i)) add(models, "foundry_model_catalog");
  return models;
}

function inferSecurity(text: string): SecurityControl[] {
  const security: SecurityControl[] = [];
  if (has(text, /\bentra\b|\baad\b|\bazure ad\b|\bidentity provider\b|\bfederated identity\b|\bsso\b|\bsingle sign[-\s]?on\b/i)) add(security, "entra_id");
  if (has(text, /\bexternal id\b|\bb2c\b|\bexternal identity\b/i)) add(security, "entra_external_id");
  if (has(text, /\brbac\b|\brole[-\s]?based\b|\bauthorization\b/i)) add(security, "rbac");
  if (has(text, /\brls\b|\bols\b|\brow[-\s]?level\b|\bobject[-\s]?level\b/i)) add(security, "rls_ols");
  if (has(text, /\bdlp\b|\bdata loss\b/i)) add(security, "dlp");
  if (has(text, /\baudit\b|\baudit log\w*\b|\blog retention\b|\blogging enabled\b|\bactivity logs?\b|\bsecurity logs?\b/i)) add(security, "audit");
  if (has(text, /\bkey vault\b|\bsecret\b|\bsecrets\b/i)) add(security, "key_vault");
  if (has(text, /\bmanaged identity\b/i)) add(security, "managed_identity");
  if (has(text, /\bwaf\b|\bfront door\b/i)) add(security, "waf");
  if (has(text, /\bapim\b|\bapi management\b/i)) add(security, "apim");
  if (has(text, /\bpurview\b/i)) add(security, "purview");
  if (has(text, /\bdefender\b/i)) add(security, "defender");
  return security;
}

function inferNetwork(text: string): NetworkControl[] {
  const network: NetworkControl[] = [];
  if (has(text, /\bpublic access\b|\binternet[-\s]?facing\b|\bpublic web\b/i)) add(network, "public");
  if (hasUnnegated(text, /\bvnet\b|\bvirtual network\b/i)) add(network, "vnet");
  if (hasUnnegated(text, /\bprivate link\b/i)) add(network, "private_link");
  if (hasUnnegated(text, /\bprivate endpoints?\b/i)) add(network, "private_endpoint");
  if (hasUnnegated(text, /\bvpn\b/i)) add(network, "vpn");
  if (hasUnnegated(text, /\bexpressroute\b|\bexpress route\b/i)) add(network, "expressroute");
  if (has(text, /\bno public endpoint\b|\bno public endpoints\b/i)) add(network, "no_public_endpoint");
  if (hasUnnegated(text, /\bdata residency\b|\bregion pinning\b|\bsovereign\b/i)) add(network, "data_residency");
  if (hasUnnegated(text, /\bregulated\b|\bregulatory\b|\bcompliance\b/i)) add(network, "regulated");
  if (hasUnnegated(text, /\bon[-\s]?prem\b|\bon premises\b/i)) add(network, "on_prem_connectivity");
  return network;
}

function inferAdvancedRag(text: string, dataSources: DataSource[], capabilities: Capability[]): AdvancedRagRequirement[] | undefined {
  if (!capabilities.includes("document_rag") && !dataSources.some((source) => ["documents", "blob_storage", "sharepoint"].includes(source))) {
    return undefined;
  }
  const requirements: AdvancedRagRequirement[] = [];
  if (hasUnnegated(text, /\bvector\b|\bembedding\b|\bembeddings\b/i)) add(requirements, "custom_vector_search");
  if (hasUnnegated(text, /\bhybrid search\b|\bkeyword.*vector\b|\bmuch stronger\b|\bstronger search\b|\bbetter search\b|\bprecise[, ]+(?:and\s+)?well[-\s]?sourced\b|\bhigh[-\s]?quality (?:search|retrieval|answers?)\b|\bstronger\b[^.]*\bthan\b[^.]*\bbasic\b/i)) add(requirements, "hybrid_search");
  if (has(text, /\blarge[-\s]?scale\b|\bmillions of\s+(?:[\w-]+\s+){0,2}(?:documents|docs|files|pdfs|articles|records|pages)\b|\bmillions of documents\b|\b\d+(?:\.\d+)?\s*(?:m|million|millions)\s+(?:documents|docs|files|pdfs|articles|records)\b|\b\d+(?:\.\d+)?\s*k\s+(?:documents|docs|files|pdfs|articles)\b|\b[1-9]\d{5,}\s+(?:documents|docs|files|pdfs|articles)\b/i)) add(requirements, "large_scale_indexing");
  if (hasUnnegated(text, /\bingestion pipeline\b|\bcustom ingestion\b/i)) add(requirements, "custom_ingestion");
  if (hasUnnegated(text, /\bchunk\b|\bchunking\b/i)) add(requirements, "custom_chunking");
  if (hasUnnegated(text, /\bocr\b|\bimage extraction\b|\bdocument enrichment\b/i)) add(requirements, "ocr_enrichment");
  if (hasUnnegated(text, /\bmetadata\b|\bfacet\b|\bfacets\b|\bscoring\b/i)) add(requirements, "metadata_filtering");
  if (hasUnnegated(text, /\benterprise search\b|\breusable index\b/i)) add(requirements, "reusable_enterprise_index");
  if (hasUnnegated(text, /\bprivate search\b/i)) add(requirements, "private_search_service");
  if (hasUnnegated(text, /\breuse search\b|\bmultiple apps\b|\bmulti[-\s]?app\b/i)) add(requirements, "multi_app_search_reuse");
  if (hasUnnegated(text, /\bazure ai search\b|\bcognitive search\b/i)) add(requirements, "explicit_azure_ai_search");
  return requirements.length ? requirements : ["none"];
}

function inferFabricAnalyticsIntent(text: string): FabricAnalyticsIntent {
  const storageOnly = has(text, /\b(?:fabric|onelake|lakehouse|warehouse)\b[^.;\n]{0,50}\b(?:only|just)\s+(?:for\s+)?(?:storage|processing)\b|\b(?:only|just)\s+use\s+fabric\s+(?:for|as)\s+(?:storage|processing)\b/i);
  const predefinedReports = has(text, /\b(?:predefined|fixed)\s+(?:reports?|apis?)\b/i);
  const noConversationalAnalytics = has(text, /\b(?:no|not|without)\s+(?:live\s+)?(?:natural[-\s]?language|conversational)\b/i);
  const reportsOnly = has(text, /\b(?:only|just)\s+(?:(?:through|use|uses|using|consume|consumes)\s+)?(?:predefined|fixed)\s+(?:reports?|apis?)\b/i);
  if (predefinedReports && (reportsOnly || noConversationalAnalytics)) return "predefined_reports_apis";
  if (storageOnly) return "storage_only";
  return "read_only_analytics_qa";
}

export function inferDecisionInputFromSummary(input: DecisionInput): DecisionInput {
  const summary = (input.summary ?? "").trim();
  if (!summary) return normalizeDecisionInput(input);
  const users = inferUsers(summary);
  const channels = inferChannels(summary, users);
  const dataSources = inferDataSources(summary);
  const capabilities = inferCapabilities(summary, users, channels, dataSources);
  const behaviors = inferBehaviors(summary, capabilities);
  const lifecycleControls = inferLifecycle(summary);
  const runtimePreferences = inferRuntime(summary);
  const modelStrategy = inferModelStrategy(summary);
  const securityControls = inferSecurity(summary);
  const networkControls = inferNetwork(summary);
  const advancedRagRequirements = inferAdvancedRag(summary, dataSources, capabilities);
  const advancedRagExplicit = (advancedRagRequirements ?? []).some((item) => item !== "none" && item !== "unknown");
  const hasFabric = dataSources.some((source) => ["fabric_onelake", "fabric_lakehouse", "fabric_warehouse", "powerbi_semantic_model", "kql_eventhouse"].includes(source));
  const hasPowerBiSemanticModel = dataSources.includes("powerbi_semantic_model");
  const actionable = capabilities.some((capability) => DIRECT_ACTIONABLE_CAPABILITIES.includes(capability)) ||
    behaviors.some((behavior) => DIRECT_ACTIONABLE_BEHAVIORS.includes(behavior));
  const readOnlyDeclared = has(summary, /\bread[-\s]?only\b|\bno updates?\b|\bno write[-\s]?back\b|\bwithout writing\b|\bdoes not update\b/i);
  const external = users.some((user) => ["external_customers", "citizens", "partners"].includes(user));
  const externalChannel = channels.some((channel) => ["web", "mobile", "portal", "api", "embedded"].includes(channel));
  const explicitNonNativePath =
    advancedRagExplicit ||
    lifecycleControls.length > 0 ||
    modelStrategy.length > 0 ||
    runtimePreferences.some((runtime) => ["custom_backend", "foundry_agent_service", "m365_agents_sdk", "functions", "app_service", "container_apps", "aks"].includes(runtime)) ||
    external ||
    externalChannel ||
    dataSources.some((source) => ["blob_storage", "azure_sql", "dataverse", "apis", "erp_crm", "on_prem", "internet"].includes(source)) ||
    capabilities.some((capability) => ["custom_app", "operational_query", "business_workflow", "approval", "transaction", "record_update", "multi_agent", "fabric_analytics"].includes(capability));
  const simpleM365NativeKnowledge =
    hasM365TenantContext(summary) &&
    hasSimplePathSignal(summary) &&
    users.includes("internal_employees") &&
    dataSources.some((source) => ["documents", "sharepoint", "m365_graph"].includes(source)) &&
    capabilities.includes("document_rag") &&
    !actionable &&
    !explicitNonNativePath;
  // Internal employees taking business actions in Teams with no explicitly-stated custom
  // runtime: Copilot Studio (+ Power Automate) is the natural Microsoft low-code platform.
  // Default the experience to Copilot Studio so the recommendation presents the managed
  // Copilot Studio action agent rather than a generic custom backend — UNLESS the scenario
  // carries an AI-Foundry-leaning signal (model ops, advanced RAG, multi-agent, lifecycle
  // model controls, or an external surface), which warrants the Foundry/custom path.
  const foundryLeaning =
    modelStrategy.length > 0 ||
    advancedRagExplicit ||
    capabilities.includes("multi_agent") ||
    external ||
    externalChannel ||
    lifecycleControls.some((lc) => ["evaluation", "tracing", "model_versioning", "model_routing"].includes(lc));
  const internalTeamsAction =
    actionable &&
    users.includes("internal_employees") &&
    channels.includes("teams") &&
    runtimePreferences.length === 0 &&
    !foundryLeaning;
  const defaultsToCopilotStudio = simpleM365NativeKnowledge || internalTeamsAction;

  return normalizeDecisionInput({
    ...emptyInput(),
    summary,
    directTextRecommendation: true,
    users,
    channels,
    capabilities,
    dataSources,
    behaviors,
    lifecycleControls,
    runtimePreferences: defaultsToCopilotStudio && runtimePreferences.length === 0 ? ["copilot_studio"] : runtimePreferences,
    modelStrategy,
    securityControls,
    networkControls,
    advancedRagRequirements,
    fabricAnalyticsIntent: hasFabric ? inferFabricAnalyticsIntent(summary) : undefined,
    fabricUserAccess: hasFabric
      ? users.includes("internal_employees") || users.includes("admins")
        ? "internal_fabric_permissions"
        : users.includes("partners")
        ? "b2b_governed_fabric_access"
        : users.some((user) => ["external_customers", "citizens"].includes(user))
        ? "external_customers_citizens"
        : "unknown"
      : undefined,
    semanticModelUsed: hasPowerBiSemanticModel || undefined,
    semanticModelSecurityKnown: hasPowerBiSemanticModel ? false : undefined,
    semanticModelConfirmations: hasPowerBiSemanticModel ? ["not_confirmed"] : undefined,
    writeBackConfirmed: actionable ? true : readOnlyDeclared ? false : undefined,
    externalAccessConfirmed: external && externalChannel ? true : undefined,
    externalAccessUnknown: external && !externalChannel ? true : undefined,
    lowCodePreferred: defaultsToCopilotStudio || has(summary, /\blow[-\s]?code\b|\bcopilot studio\b/i) || undefined,
    m365ExtensibilityRequired: has(summary, /\bmicrosoft 365 agents sdk\b|\bm365 agents sdk\b/i) || undefined
  });
}

const inferredArrayFields = [
  "users",
  "channels",
  "capabilities",
  "dataSources",
  "behaviors",
  "lifecycleControls",
  "runtimePreferences",
  "modelStrategy",
  "securityControls",
  "networkControls",
  "advancedRagRequirements"
] as const;

const ignoredInferredValues = new Set(["unknown", "none"]);

function meaningfulValues(values: readonly string[] | undefined) {
  return (values ?? []).filter((value) => value && !ignoredInferredValues.has(value));
}

function mergeArrayValues(current: readonly string[] | undefined, inferred: readonly string[] | undefined) {
  const currentMeaningful = meaningfulValues(current);
  const inferredMeaningful = meaningfulValues(inferred);
  if (inferredMeaningful.length === 0) return current ?? [];
  return Array.from(new Set([...currentMeaningful, ...inferredMeaningful]));
}

export function mergeInferredProfileFromSummary(input: DecisionInput): DecisionInput {
  const summary = (input.summary ?? "").trim();
  if (!summary) return normalizeDecisionInput(input);

  const inferred = inferDecisionInputFromSummary({ ...input, directTextRecommendation: true });
  const next: DecisionInput = { ...input, summary };

  for (const field of inferredArrayFields) {
    (next as any)[field] = mergeArrayValues((input as any)[field], (inferred as any)[field]);
  }

  next.fabricAnalyticsIntent = input.fabricAnalyticsIntent ?? inferred.fabricAnalyticsIntent;
  next.fabricUserAccess = input.fabricUserAccess ?? inferred.fabricUserAccess;
  next.semanticModelUsed = input.semanticModelUsed ?? inferred.semanticModelUsed;
  next.semanticModelSecurityKnown = input.semanticModelSecurityKnown ?? inferred.semanticModelSecurityKnown;
  next.semanticModelConfirmations = input.semanticModelConfirmations?.length ? input.semanticModelConfirmations : inferred.semanticModelConfirmations;
  next.writeBackConfirmed = input.writeBackConfirmed ?? inferred.writeBackConfirmed;
  next.externalAccessConfirmed = input.externalAccessConfirmed ?? inferred.externalAccessConfirmed;
  next.externalAccessUnknown = input.externalAccessUnknown ?? inferred.externalAccessUnknown;
  next.lowCodePreferred = input.lowCodePreferred ?? inferred.lowCodePreferred;
  next.m365ExtensibilityRequired = input.m365ExtensibilityRequired ?? inferred.m365ExtensibilityRequired;

  return normalizeDecisionInput(next);
}

export function prepareDecisionInputForRecommendation(input: DecisionInput): DecisionInput {
  if (input.directTextRecommendation && (input.summary ?? "").trim()) {
    // "Build from text" mode: the scenario text is the single source of truth. Always
    // re-infer the full structured profile from the summary so that stale wizard or
    // example selections (e.g. an example loaded into the wizard whose text was then
    // edited) can never leak into the recommendation. Only the summary, the build-from-
    // text flag, and free-text notes carry over.
    const inferred = inferDecisionInputFromSummary({
      ...emptyInput(),
      summary: input.summary,
      directTextRecommendation: true
    });
    if (input.notes) inferred.notes = input.notes;
    return inferred;
  }
  return normalizeDecisionInput(input);
}
