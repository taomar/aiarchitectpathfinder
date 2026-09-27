import type { DecisionInput } from "./types";

export type Example = { id: string; name: string; input: DecisionInput };

export const EXAMPLES: Example[] = [
  {
    id: "copilot_hr_policy_teams",
    name: "Copilot Studio · HR policy answers in Teams",
    input: {
      summary: "We want our 38,000 employees to get instant answers to HR and benefits questions right inside Teams, based on our own HR handbooks and policy documents, so HR stops answering the same questions over and over. It should answer with sources and must not create or change any HR records.",
      users: ["internal_employees"],
      channels: ["teams"],
      capabilities: ["employee_assistant"],
      dataSources: ["sharepoint", "documents"],
      behaviors: ["qa", "retrieval"],
      lifecycleControls: ["none"],
      runtimePreferences: ["copilot_studio"],
      securityControls: ["entra_id", "rbac", "audit"],
      networkControls: ["public"],
      advancedRagRequirements: ["none"],
      lowCodePreferred: true
    }
  },
  {
    id: "copilot_store_ops_dataverse",
    name: "Copilot Studio · Store operations assistant",
    input: {
      summary: "We have 2,300 stores and 41,000 store associates. We want them to ask everyday 'how do I' operating questions in Teams, check the status of their store tasks, and raise a maintenance request when something needs fixing — with the right approval and a record of what was done.",
      users: ["internal_employees"],
      channels: ["teams"],
      capabilities: ["employee_assistant", "business_workflow"],
      dataSources: ["sharepoint", "dataverse"],
      behaviors: ["qa", "retrieval", "workflow"],
      workflowExecution: ["controlled_action"],
      writeBackConfirmed: true,
      lifecycleControls: ["monitoring"],
      runtimePreferences: ["copilot_studio"],
      securityControls: ["entra_id", "rbac", "audit", "dlp"],
      networkControls: ["public"],
      advancedRagRequirements: ["none"],
      lowCodePreferred: true
    }
  },
  {
    id: "copilot_fabric_sales_analytics",
    name: "Copilot Studio · Ask questions about sales numbers",
    input: {
      summary: "We want our 620 sales managers to ask plain-language questions about our sales performance and trends in Teams — like 'how did the north region do last quarter' — and get trustworthy answers from our official sales reporting, without building reports or learning an analytics tool.",
      users: ["internal_employees"],
      channels: ["teams", "m365"],
      capabilities: ["fabric_analytics"],
      dataSources: ["fabric_lakehouse", "powerbi_semantic_model"],
      behaviors: ["analytics", "read_only_query", "qa"],
      lifecycleControls: ["monitoring"],
      runtimePreferences: ["copilot_studio"],
      securityControls: ["entra_id", "rls_ols", "audit"],
      networkControls: ["public"],
      lowCodePreferred: true,
      semanticModelUsed: true,
      semanticModelSecurityKnown: true,
      semanticModelConfirmations: ["read", "workspace", "rls_ols", "prep_ai"],
      fabricAnalyticsIntent: "read_only_analytics_qa",
      fabricUserAccess: "internal_fabric_permissions"
    }
  },
  {
    id: "copilot_it_helpdesk_m365",
    name: "Copilot Studio · IT help in Microsoft 365",
    input: {
      summary: "Our IT team supports 18,000 employees and handles about 9,500 requests a month. We want employees to get help with common IT issues directly in Microsoft 365 and Teams, check whether they qualify for a new device, and only open a support ticket once they confirm.",
      users: ["internal_employees"],
      channels: ["m365_copilot", "teams"],
      capabilities: ["employee_assistant", "operational_query", "business_workflow"],
      dataSources: ["m365_graph", "sharepoint", "apis"],
      behaviors: ["qa", "read_only_query", "workflow"],
      workflowExecution: ["ticket_creation_after_confirmation"],
      writeBackConfirmed: true,
      lifecycleControls: ["monitoring"],
      runtimePreferences: ["copilot_studio"],
      securityControls: ["entra_id", "rbac", "audit"],
      networkControls: ["public"],
      advancedRagRequirements: ["none"],
      lowCodePreferred: true,
      m365ExtensibilityRequired: true
    }
  },
  {
    id: "copilot_compliance_policy_m365",
    name: "Copilot Studio · Policy check before client meetings",
    input: {
      summary: "We want our 7,800 relationship managers to quickly check company policy and compliance rules in Teams before meeting clients, with answers drawn only from our approved policy documents. It must keep records private, and it must never give financial advice or change any customer information.",
      users: ["internal_employees"],
      channels: ["teams", "m365"],
      capabilities: ["employee_assistant"],
      dataSources: ["sharepoint", "documents"],
      behaviors: ["qa", "retrieval", "summarization"],
      lifecycleControls: ["monitoring", "governance"],
      runtimePreferences: ["copilot_studio"],
      securityControls: ["entra_id", "rbac", "dlp", "audit", "purview"],
      networkControls: ["regulated", "data_residency"],
      advancedRagRequirements: ["none"],
      lowCodePreferred: true
    }
  },
  {
    id: "foundry_claims_mobile_rag",
    name: "AI Foundry · Customer claims app",
    input: {
      summary: "We want our customers to use our mobile app to check the status of their insurance claims and ask questions about their own claim documents, getting clear answers that point back to the exact source. It is open to the public and serves 1.8 million policyholders.",
      users: ["external_customers"],
      channels: ["mobile"],
      capabilities: ["document_rag", "custom_app"],
      dataSources: ["documents", "blob_storage", "apis"],
      behaviors: ["qa", "retrieval", "summarization", "read_only_query"],
      lifecycleControls: ["evaluation", "tracing", "monitoring", "safety_testing"],
      runtimePreferences: ["foundry_agent_service"],
      securityControls: ["entra_external_id", "apim", "waf", "audit", "managed_identity"],
      networkControls: ["public"],
      advancedRagRequirements: ["hybrid_search", "large_scale_indexing", "ocr_enrichment", "metadata_filtering"],
      externalAccessConfirmed: true
    }
  },
  {
    id: "foundry_underwriting_model_ops",
    name: "AI Foundry · Train a model on our lending data",
    input: {
      summary: "We want to train an AI model on our own lending data so our 720 underwriters get a drafted risk summary and a risk score for each application they review. A person must always review before any decision, and we need to keep checking how well the model performs over time.",
      users: ["internal_employees"],
      channels: ["portal"],
      capabilities: ["custom_app", "operational_query"],
      dataSources: ["azure_sql", "apis", "documents"],
      behaviors: ["summarization", "recommendation", "read_only_query"],
      lifecycleControls: ["evaluation", "tracing", "model_versioning", "model_routing", "governance"],
      modelStrategy: ["azure_ml_custom_model", "fine_tuned_azure_openai", "azure_ml_endpoint"],
      runtimePreferences: ["foundry_agent_service"],
      securityControls: ["entra_id", "rbac", "apim", "audit", "key_vault"],
      networkControls: ["private_endpoint", "data_residency", "regulated"],
      advancedRagRequirements: ["metadata_filtering"]
    }
  },
  {
    id: "foundry_contact_center_multimodel",
    name: "AI Foundry · Contact center agent assist",
    input: {
      summary: "We want to give our 3,200 contact-center agents an assistant that drafts replies, flags customers who might cancel, and routes complaints to the right team. We also want to try a few different AI models side by side to see which one gives the best results before we roll it out.",
      users: ["internal_employees"],
      channels: ["portal", "embedded"],
      capabilities: ["custom_app", "document_rag", "operational_query"],
      dataSources: ["dataverse", "documents", "blob_storage", "apis"],
      behaviors: ["summarization", "recommendation", "retrieval", "read_only_query"],
      lifecycleControls: ["evaluation", "tracing", "prompt_versioning", "model_routing", "monitoring"],
      modelStrategy: ["azure_openai", "foundry_model_catalog", "azure_ml_endpoint"],
      runtimePreferences: ["foundry_agent_service"],
      securityControls: ["entra_id", "rbac", "apim", "audit"],
      networkControls: ["public"],
      advancedRagRequirements: ["hybrid_search", "custom_chunking"]
    }
  },
  {
    id: "foundry_manufacturing_quality",
    name: "AI Foundry · Factory quality insights",
    input: {
      summary: "We want our quality engineers across 14 plants to get quick summaries of inspection notes and an automatic read on which products are likely to have defects, using data from our factory systems — while keeping all of our data inside our own region.",
      users: ["internal_employees"],
      channels: ["portal"],
      capabilities: ["custom_app", "operational_query"],
      dataSources: ["apis", "on_prem", "azure_sql"],
      behaviors: ["summarization", "read_only_query", "recommendation"],
      lifecycleControls: ["evaluation", "tracing", "monitoring", "model_versioning"],
      modelStrategy: ["azure_ml_endpoint", "azure_openai"],
      runtimePreferences: ["foundry_agent_service", "custom_backend"],
      securityControls: ["entra_id", "managed_identity", "key_vault", "audit"],
      networkControls: ["expressroute", "private_link", "on_prem_connectivity", "data_residency"],
      advancedRagRequirements: ["none"]
    }
  },
  {
    id: "foundry_citizen_benefits_portal",
    name: "AI Foundry · Public information website",
    input: {
      summary: "We want the public to use a website to ask whether they qualify for benefits and get answers from our official policy documents, in both English and Arabic. It serves 2.1 million citizens, so it must be secure, private, and reliable.",
      users: ["citizens"],
      channels: ["web", "portal"],
      capabilities: ["document_rag", "custom_app", "operational_query"],
      dataSources: ["documents", "blob_storage", "apis"],
      behaviors: ["qa", "retrieval", "summarization", "read_only_query"],
      lifecycleControls: ["evaluation", "tracing", "monitoring", "safety_testing", "governance"],
      runtimePreferences: ["foundry_agent_service"],
      securityControls: ["entra_external_id", "apim", "waf", "managed_identity", "audit"],
      networkControls: ["private_endpoint", "no_public_endpoint", "data_residency", "regulated"],
      advancedRagRequirements: ["hybrid_search", "large_scale_indexing", "metadata_filtering"],
      externalAccessConfirmed: true
    }
  },
  {
    id: "hybrid_teams_advanced_rag",
    name: "Hybrid · Smart search over many documents in Teams",
    input: {
      summary: "Our 11,000 employees work in Teams, and we want them to ask questions across millions of project documents and get precise, well-sourced answers. The everyday experience should stay in Teams, but we need much stronger search and answer quality than a basic setup can give.",
      users: ["internal_employees"],
      channels: ["teams"],
      capabilities: ["employee_assistant", "document_rag"],
      dataSources: ["sharepoint", "documents", "blob_storage"],
      behaviors: ["qa", "retrieval", "summarization"],
      lifecycleControls: ["evaluation", "tracing", "monitoring"],
      modelStrategy: ["azure_openai"],
      runtimePreferences: ["copilot_studio", "foundry_agent_service"],
      securityControls: ["entra_id", "rbac", "audit", "managed_identity"],
      networkControls: ["public"],
      advancedRagRequirements: ["hybrid_search", "custom_chunking", "metadata_filtering", "reusable_enterprise_index"],
      lowCodePreferred: true
    }
  },
  {
    id: "hybrid_sap_order_approval",
    name: "Hybrid · Approve special orders in Teams",
    input: {
      summary: "Our 1,400 salespeople work in Teams and process thousands of special-price orders each month in our ordering system. We want them to raise a request and get the policy explained in Teams, while the actual approval, checks, and order entry happen reliably in the background with every decision logged.",
      users: ["internal_employees"],
      channels: ["teams"],
      capabilities: ["business_workflow", "approval", "transaction", "operational_query"],
      dataSources: ["apis", "erp_crm", "documents"],
      behaviors: ["workflow", "approval", "transaction", "read_only_query"],
      workflowExecution: ["approval", "transaction"],
      writeBackConfirmed: true,
      lifecycleControls: ["monitoring", "tracing"],
      runtimePreferences: ["copilot_studio", "custom_backend"],
      securityControls: ["entra_id", "apim", "managed_identity", "key_vault", "audit"],
      networkControls: ["private_link", "on_prem_connectivity"],
      advancedRagRequirements: ["none"],
      lowCodePreferred: true
    }
  },
  {
    id: "hybrid_fabric_scoring_finance",
    name: "Hybrid · Finance analytics with anomaly flags",
    input: {
      summary: "We want our 350 finance controllers to ask questions about billions of transactions in Teams and also get automatic flags for unusual items during month-end close. It should only read and analyze the numbers — never change the books.",
      users: ["internal_employees"],
      channels: ["teams", "portal"],
      capabilities: ["fabric_analytics"],
      dataSources: ["fabric_warehouse", "powerbi_semantic_model", "azure_sql"],
      behaviors: ["analytics", "read_only_query", "recommendation"],
      lifecycleControls: ["evaluation", "tracing", "model_routing", "monitoring"],
      modelStrategy: ["azure_ml_endpoint", "azure_openai"],
      runtimePreferences: ["copilot_studio", "foundry_agent_service"],
      securityControls: ["entra_id", "rls_ols", "audit", "managed_identity"],
      networkControls: ["private_endpoint", "data_residency"],
      semanticModelUsed: true,
      semanticModelSecurityKnown: true,
      semanticModelConfirmations: ["read", "workspace", "rls_ols", "prep_ai"],
      fabricAnalyticsIntent: "read_only_analytics_qa",
      fabricUserAccess: "internal_fabric_permissions"
    }
  },
  {
    id: "hybrid_partner_onboarding_private",
    name: "Hybrid · Partner portal plus internal triage",
    input: {
      summary: "We onboard 4,000 partners a year. We want partners to use an external portal to get answers about contracts and onboarding, while our own staff handle the tricky exceptions in Teams. Partner access must be secure, and our back-office systems must stay private.",
      users: ["partners", "internal_employees"],
      channels: ["portal", "teams"],
      capabilities: ["document_rag", "operational_query", "business_workflow"],
      dataSources: ["documents", "blob_storage", "apis", "erp_crm"],
      behaviors: ["qa", "retrieval", "read_only_query", "workflow"],
      workflowExecution: ["guidance"],
      lifecycleControls: ["evaluation", "tracing", "monitoring"],
      runtimePreferences: ["foundry_agent_service", "copilot_studio", "custom_backend"],
      securityControls: ["entra_external_id", "entra_id", "apim", "waf", "managed_identity", "key_vault", "audit"],
      networkControls: ["private_link", "private_endpoint", "no_public_endpoint"],
      advancedRagRequirements: ["hybrid_search", "metadata_filtering"],
      externalAccessConfirmed: true
    }
  },
  {
    id: "hybrid_procurement_m365_foundry",
    name: "Hybrid · Procurement assistant in Microsoft 365",
    input: {
      summary: "Our 5,600-person procurement team works in Microsoft 365 and Teams and handles 75,000 purchase requests a year. We want an assistant that summarizes supplier documents, checks our ordering systems, recommends preferred contracts, and applies our procurement policies consistently.",
      users: ["internal_employees"],
      channels: ["m365_copilot", "teams"],
      capabilities: ["employee_assistant", "operational_query", "business_workflow"],
      dataSources: ["m365_graph", "sharepoint", "apis", "erp_crm"],
      behaviors: ["summarization", "read_only_query", "recommendation", "workflow"],
      workflowExecution: ["guidance"],
      lifecycleControls: ["evaluation", "tracing", "prompt_versioning", "monitoring"],
      runtimePreferences: ["m365_agents_sdk", "foundry_agent_service", "copilot_studio"],
      securityControls: ["entra_id", "rbac", "apim", "audit", "managed_identity"],
      networkControls: ["private_link", "on_prem_connectivity"],
      advancedRagRequirements: ["none"],
      m365ExtensibilityRequired: true,
      lowCodePreferred: false
    }
  }
];