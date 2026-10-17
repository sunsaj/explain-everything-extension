function configurationFields(candidate) {
  return {
    endpoint: candidate.endpoint,
    apiKey: candidate.apiKey,
    model: candidate.model,
    level: candidate.level,
    webSearchEnabled: candidate.webSearchEnabled,
    systemPrompt: candidate.systemPrompt
  };
}

export async function grantAndSaveSettings(candidate, dependencies) {
  const validation = dependencies.validateSettings(candidate);
  if (!validation.valid) return { ok: false, validation };

  dependencies.normalizeEndpoint(candidate.endpoint);
  const permissionRequest = dependencies.requestPermission({
    origins: [dependencies.permissionPatternForEndpoint(candidate.endpoint)]
  });
  const granted = await permissionRequest;
  if (!granted) return { ok: false, permissionDenied: true };

  const response = await dependencies.saveConfiguration(
    configurationFields(candidate)
  );
  if (response?.ok !== true || typeof response.enabled !== "boolean") {
    throw new Error(
      typeof response?.error?.message === "string" && response.error.message
        ? response.error.message
        : "Could not save settings."
    );
  }
  return {
    ok: true,
    settings: {
      ...configurationFields(candidate),
      enabled: response.enabled,
      settingsVersion: candidate.settingsVersion
    }
  };
}
