targetScope = 'resourceGroup'

param environmentName string
param location string
@minLength(2)
@maxLength(60)
param webAppName string
param createAppServicePlan bool = true
param appServicePlanName string = '${webAppName}-plan'
param existingAppServicePlanResourceId string = ''

@allowed(['password', 'entra'])
param authMode string
@secure()
param passwordHash string = ''
@secure()
param sessionSecret string = ''
param entraTenantId string = ''
param entraClientId string = ''
@secure()
param entraClientSecret string = ''
param adminEmails string = ''
param workloadIdentityResourceId string = ''

@description('Server-side AI settings only. Preflight rejects non-AI setting names.')
@secure()
param aiSettings object

var tags = {
  'azd-env-name': environmentName
  application: 'aiarchitectpathfinder'
}
var origin = 'https://${web.properties.defaultHostName}'
var applicationSettings = union(aiSettings, {
  NODE_ENV: 'production'
  APP_ORIGIN: origin
  AUTH_MODE: authMode
  AUTH_PASSWORD_HASH: passwordHash
  AUTH_SESSION_SECRET: sessionSecret
  AUTH_ENTRA_TENANT_ID: entraTenantId
  AUTH_ENTRA_CLIENT_ID: entraClientId
  AUTH_ENTRA_CLIENT_SECRET: entraClientSecret
  ADMIN_EMAILS: adminEmails
  ADMIN_LOCAL_BYPASS: 'false'
  SCM_DO_BUILD_DURING_DEPLOYMENT: 'true'
  ENABLE_ORYX_BUILD: 'true'
})

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = if (createAppServicePlan) {
  name: appServicePlanName
  location: location
  kind: 'linux'
  tags: tags
  sku: {
    name: 'B1'
    tier: 'Basic'
    capacity: 1
  }
  properties: {
    reserved: true
  }
}

resource web 'Microsoft.Web/sites@2024-04-01' = {
  name: webAppName
  location: location
  kind: 'app,linux'
  tags: union(tags, { 'azd-service-name': 'web' })
  identity: empty(workloadIdentityResourceId) ? {
    type: 'None'
  } : {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${workloadIdentityResourceId}': {}
    }
  }
  properties: {
    serverFarmId: createAppServicePlan ? plan!.id : existingAppServicePlanResourceId
    httpsOnly: true
    publicNetworkAccess: 'Enabled'
    siteConfig: {
      linuxFxVersion: 'NODE|24-lts'
      appCommandLine: 'npm start'
      alwaysOn: true
      http20Enabled: true
      minTlsVersion: '1.2'
      scmMinTlsVersion: '1.2'
      ftpsState: 'Disabled'
      healthCheckPath: '/api/health'
    }
  }
}

resource appSettings 'Microsoft.Web/sites/config@2024-04-01' = {
  parent: web
  name: 'appsettings'
  properties: applicationSettings
}

resource authentication 'Microsoft.Web/sites/config@2024-04-01' = {
  parent: web
  name: 'authsettingsV2'
  properties: {
    platform: {
      enabled: authMode == 'entra'
      runtimeVersion: '~1'
    }
    globalValidation: {
      requireAuthentication: authMode == 'entra'
      unauthenticatedClientAction: authMode == 'entra' ? 'RedirectToLoginPage' : 'AllowAnonymous'
      redirectToProvider: 'azureactivedirectory'
      excludedPaths: ['/api/health']
    }
    identityProviders: authMode == 'entra' ? {
      azureActiveDirectory: {
        enabled: true
        registration: {
          openIdIssuer: uri(environment().authentication.loginEndpoint, '${entraTenantId}/v2.0')
          clientId: entraClientId
          clientSecretSettingName: 'AUTH_ENTRA_CLIENT_SECRET'
        }
        validation: {
          allowedAudiences: [
            entraClientId
            'api://${entraClientId}'
          ]
        }
      }
    } : {}
    login: {
      tokenStore: {
        enabled: false
      }
      allowedExternalRedirectUrls: []
    }
    httpSettings: {
      requireHttps: true
    }
  }
}

output AZURE_WEB_APP_NAME string = web.name
output AZURE_APP_SERVICE_PLAN_NAME string = createAppServicePlan ? plan!.name : last(split(existingAppServicePlanResourceId, '/'))
output SERVICE_WEB_ENDPOINT_URL string = origin
