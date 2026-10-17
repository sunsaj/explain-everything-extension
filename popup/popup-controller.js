const INITIAL_VIEW = Object.freeze({
  enabled: false,
  toggleDisabled: true,
  configurationText: "Checking...",
  configurationKind: "checking",
  statusMessage: "",
  statusKind: "info",
  settingsDisabled: false
});

function responseError(result, fallback) {
  return typeof result?.error?.message === "string" && result.error.message.trim()
    ? result.error.message
    : fallback;
}

function isStatusResponse(result) {
  return result?.ok === true
    && typeof result.enabled === "boolean"
    && typeof result.configured === "boolean";
}

function isEnabledResponse(result) {
  return result?.ok === true && typeof result.enabled === "boolean";
}

function configurationView(configured) {
  return configured
    ? { configurationText: "Ready", configurationKind: "ready" }
    : { configurationText: "Configuration required", configurationKind: "required" };
}

export function createPopupController({ sendMessage, render, close }) {
  let view = { ...INITIAL_VIEW };
  let statusGeneration = 0;
  let optionsGeneration = 0;
  let feedbackGeneration = 0;

  function commit(patch) {
    view = { ...view, ...patch };
    render({ ...view });
  }

  function isCurrentStatus(generation) {
    return generation === statusGeneration;
  }

  function feedbackView(generation, statusMessage, statusKind) {
    return generation === feedbackGeneration
      ? { statusMessage, statusKind }
      : {};
  }

  function commitFeedback(generation, statusMessage, statusKind) {
    if (generation === feedbackGeneration) {
      commit({ statusMessage, statusKind });
    }
  }

  function applyStatus(
    result,
    feedback,
    statusMessage = "",
    statusKind = "info"
  ) {
    commit({
      enabled: result.enabled,
      toggleDisabled: false,
      ...configurationView(result.configured),
      ...feedbackView(feedback, statusMessage, statusKind)
    });
  }

  function markUnverified(message, feedback) {
    commit({
      toggleDisabled: true,
      configurationText: "Status unverified",
      configurationKind: "unverified",
      ...feedbackView(feedback, message, "error")
    });
  }

  async function reconcile(generation, feedback, failureMessage) {
    try {
      const result = await sendMessage({ type: "GET_STATUS" });
      if (!isCurrentStatus(generation)) return;
      if (!isStatusResponse(result)) {
        markUnverified(failureMessage, feedback);
        return;
      }
      applyStatus(result, feedback, failureMessage, "error");
    } catch {
      if (isCurrentStatus(generation)) {
        markUnverified(failureMessage, feedback);
      }
    }
  }

  async function load() {
    const generation = ++statusGeneration;
    const feedback = ++feedbackGeneration;
    commit({
      toggleDisabled: true,
      configurationText: "Checking...",
      configurationKind: "checking",
      ...feedbackView(feedback, "", "info")
    });

    try {
      const result = await sendMessage({ type: "GET_STATUS" });
      if (!isCurrentStatus(generation)) return;
      if (!isStatusResponse(result)) {
        markUnverified(
          responseError(result, "Could not read extension status."),
          feedback
        );
        return;
      }
      applyStatus(result, feedback);
    } catch {
      if (isCurrentStatus(generation)) {
        markUnverified("Could not read extension status.", feedback);
      }
    }
  }

  async function setEnabled(enabled) {
    const generation = ++statusGeneration;
    const feedback = ++feedbackGeneration;
    commit({
      toggleDisabled: true,
      ...feedbackView(feedback, "", "info")
    });

    let failureMessage;
    try {
      const result = await sendMessage({ type: "SET_ENABLED", enabled });
      if (!isCurrentStatus(generation)) return;
      if (isEnabledResponse(result)) {
        commit({
          enabled: result.enabled,
          toggleDisabled: false,
          ...feedbackView(
            feedback,
            result.enabled ? "Enabled" : "Disabled",
            "success"
          )
        });
        return;
      }
      failureMessage = responseError(result, "Could not update extension status.");
    } catch {
      if (!isCurrentStatus(generation)) return;
      failureMessage = "Could not update extension status.";
    }

    await reconcile(generation, feedback, failureMessage);
  }

  async function openOptions() {
    const generation = ++optionsGeneration;
    const feedback = ++feedbackGeneration;
    commit({
      settingsDisabled: true,
      ...feedbackView(feedback, "", "info")
    });

    try {
      const result = await sendMessage({ type: "OPEN_OPTIONS" });
      if (generation !== optionsGeneration) return;
      if (result?.ok === true) {
        close();
        return;
      }
      commitFeedback(
        feedback,
        responseError(result, "Could not open settings."),
        "error"
      );
    } catch {
      if (generation === optionsGeneration) {
        commitFeedback(feedback, "Could not open settings.", "error");
      }
    } finally {
      if (generation === optionsGeneration) {
        commit({ settingsDisabled: false });
      }
    }
  }

  return { load, setEnabled, openOptions };
}
