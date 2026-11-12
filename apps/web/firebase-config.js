export function isProductionFirebaseConfig(config) {
  return config?.projectId === 'offlinesms-prod-2027'
    && typeof config.apiKey === 'string' && Boolean(config.apiKey.trim())
    && typeof config.appId === 'string' && Boolean(config.appId.trim());
}
