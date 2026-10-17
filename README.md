# Selection Explainer

Selection Explainer is a dependency-free Chrome Manifest V3 extension that explains text you select on ordinary webpages by calling an OpenAI-compatible LiteLLM endpoint. Ordinary explanations use Chat Completions; optional internet search uses the Responses API with the native web-search tool. It has no build step, hosted backend, analytics, or remote UI dependency.

## Install

1. Keep the complete `chrome-extension` directory together; `manifest.json` must remain directly inside it.
2. In Google Chrome, open `chrome://extensions`.
3. Turn on **Developer mode** in the upper-right corner.
4. Click **Load unpacked**.
5. In the folder picker, select the `chrome-extension` folder itself, not its parent folder and not an individual file.
6. Chrome should list **Selection Explainer**. On an incomplete first install, the extension opens its Settings page automatically.
7. If Chrome reports a manifest, service-worker, or content-script error, use the extension card's **Errors** link, fix the reported package problem, and reload the extension before continuing.

Chrome 102 or newer is required because the service worker restricts local storage to trusted extension contexts. No `npm install` or build command is required to load the extension. Node.js and Python are needed only for the verification commands in [Test](#test).

## Configure LiteLLM

Open Settings from the extension popup, the first-install page, or the panel's **Settings** action.

1. Enter a LiteLLM endpoint in one of these forms:
   - Base URL: `https://litellm.example.com`
   - API root: `https://litellm.example.com/v1`
   - Complete endpoint: `https://litellm.example.com/v1/chat/completions`

   The first two forms are normalized to the complete `/v1/chat/completions` endpoint. A deployment path prefix is preserved. Do not include URL credentials, a query string, or a fragment.
2. Enter the API key accepted by that LiteLLM server.
3. Enter an editable model name or LiteLLM alias, such as `gpt-4o-mini`. The alias must exist and be permitted by your server; the extension does not perform model discovery.
4. Choose the default explanation level: **10-year-old** or **Engineer**.
5. **Internet search is off by default.** Enable it only if the configured model supports native web search. Search uses the Responses API, may use substantially more time, tokens, and cost, and includes source citations when the provider returns them. The panel toggle can override this default for each explanation.
6. Review or edit the system prompt. **Restore default prompt** puts the bundled prompt back in the form; save afterward to keep that change.
7. Click **Save and grant access**. Chrome asks for access only to the normalized endpoint's origin. Granting is required before the background service worker can contact it. If access is denied, the earlier saved configuration is preserved.
8. Click **Test connection**. This uses the saved configuration and sends a small test statement through the same explanation path. Success requires a valid assistant message in an OpenAI-compatible Chat Completions response.

Remote endpoints must use HTTPS. Plain HTTP is accepted only for loopback development endpoints using `localhost`, `127.0.0.1`, or `[::1]`, for example `http://localhost:4000`.

## Use

1. Visit an ordinary `http://` or `https://` webpage.
2. Select text with the mouse or keyboard. Standard text selections inside an `input` or `textarea` are also supported.
3. Click the **Explain** button at the bottom-right of the page.
4. In the panel, switch between **10-year-old** and **Engineer** if needed. Turn on **Internet search** only when current information or external sources are needed. The selected level and search choice are used for the next Explain or Retry request.
5. Use **Copy** to copy the current explanation, **Retry** to request it again, **Settings** to open configuration, and **Close** or `Escape` to close the panel.
6. Use the extension popup's **Extension enabled** toggle to show or hide the Explain button globally. Open pages update without a page reload.

**Selecting or highlighting text alone sends nothing.** Selected text is transmitted only after an explicit **Explain** or **Retry** action.

Selections are normalized before sending and are limited to 20,000 characters. Requests time out after 25 seconds. With Internet search off, the extension sends one non-streaming Chat Completions request. With Internet search on, it converts the configured route to `/v1/responses`, enables the native `web_search` tool, and renders the answer with safe source citations. The returned explanation is rendered as safe Markdown using locally created DOM nodes, never by executing model-provided HTML.

## Privacy and security

- The configured LiteLLM server receives the selected text, the system/audience instructions, the chosen model alias, and the API credential. Use only an endpoint you trust and prefer a limited-purpose key.
- The API key is stored in `chrome.storage.local` in the current Chrome profile. It is not placed in webpage DOM, popup output, content-script messages, logs, or Chrome sync storage. Chrome local storage is not a dedicated encrypted secret vault; a person or process with access to the browser profile may be able to recover it.
- The bearer key is added only by the background service worker and is sent only to the normalized configured endpoint after exact-origin permission is present.
- The manifest-derived content executable graph cannot access private settings or `chrome.storage.local` and cannot use `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, or Authorization handling. The extension includes no telemetry, analytics, advertisements, remote scripts, remote fonts, or remote stylesheets.
- Selected webpage text is treated as untrusted quoted data. The prompt tells the model not to follow instructions found inside the selection.
- Model responses are parsed into a safe local Markdown subset using `createElement` and `textContent`. Model-provided HTML is displayed as text and is never executed as markup or script.
- Error messages are normalized and do not echo credentials, selected text, or provider response bodies.
- HTTPS is required for every non-loopback endpoint. HTTP is limited to `localhost`, `127.0.0.1`, and `[::1]` development servers.
- The extension does not provide a credential proxy. If your LiteLLM server is unavailable, blocked, or misconfigured, the extension cannot route around it.

## Protected pages

Chrome does not allow the content script to run on browser-protected locations such as `chrome://` pages, the Chrome Web Store, extension pages, and some browser-owned viewers. The Explain button will not appear there. Open an ordinary HTTP or HTTPS webpage to use the extension.

The extension intentionally runs only in the top-level page. It does not capture selections inside cross-origin iframes. It also does not interpret PDF canvas content, images, screenshots, audio, or video. A selection exposed as normal text on a supported top-level webpage can still work.

## Troubleshooting

### The Explain button is missing

- Confirm the page is an ordinary HTTP or HTTPS page, not a protected page described above.
- Open the popup and turn on **Extension enabled**.
- Reload the extension on `chrome://extensions`, then reload the webpage if the extension was just installed or reloaded.
- Check the extension card, service-worker console, and webpage console for an extension-context or content-script error.
- A selection inside a cross-origin iframe is not supported; select text in the top-level page instead.

### The API key is invalid or access is forbidden

A 401 or 403 response appears as **Check the API key and LiteLLM permissions.** Verify the key, the selected model/alias, and server-side authorization, then save and test again. Do not paste the key into webpage developer tools or console logs.

### Endpoint permission was denied

Return to Settings and click **Save and grant access** again. Approve the exact origin shown by Chrome. A denial does not replace previously saved settings.

### The service reports 429

The configured service is rate limited. Wait, reduce request frequency, or ask the LiteLLM administrator about quotas before retrying.

### The request times out

The extension cancels requests after 25 seconds. Check LiteLLM and provider latency, server logs, network reachability, and any reverse-proxy timeout, then retry.

### The response is incompatible

For ordinary explanations, the endpoint must return valid Chat Completions JSON with a non-empty assistant message at `choices[0].message`. For Internet search, the same configured base must expose `/v1/responses` and return `output_text` content; the configured model must support the native `web_search` tool.

### Internet search fails

Turn Internet search off and retry to confirm the ordinary Chat Completions route still works. Then verify that the model supports `/v1/responses` and the native `web_search` tool. Search requests can be slower and substantially more expensive than ordinary explanations.

### The proxy is offline or unavailable

A connection failure reports that the configured LiteLLM endpoint could not be reached. Confirm the server is running, DNS and TLS are valid, localhost is listening on the expected port, and firewalls or VPN rules allow access. HTTP 5xx responses indicate that LiteLLM or its upstream provider reported a server error; inspect those server logs without exposing the key.

## Test

Run all commands from the `chrome-extension` directory in Windows Command Prompt (`cmd.exe`). The test suite uses Node's built-in test runner and has no package dependencies.

```bat
for /r %F in (*.js) do @node --check "%F" || exit /b 1
node tests\helpers\update-product-hashes.js --check
npm test
python -m json.tool manifest.json > nul
node --test tests\package.test.js
```

`tests\package.test.js` enforces an explicit top-level manifest policy, root-contained recursive HTML/CSS/JavaScript references, parsed remote runtime-resource checks, empty inline script bodies, package path/type and UTF-8 hygiene, all-text secret scanning, the manifest-derived content private-settings boundary, the background-only request architecture, PNG signatures and IHDR dimensions, and deterministic icon bytes. `tests\package-mutations.test.js` copies the package into temporary directories and proves those checks reject focused security and packaging mutations without changing the real package.

### Maintain the approved product hashes

The package verifiers attest every product file outside `tests`: `manifest.json`, `background.js`, all `content`, `options`, `popup`, `shared`, `icons`, and `scripts` files, plus `package.json` and this README. The approved inventory records the exact sorted path set and SHA-256 bytes, so a changed, missing, or unexpected product file fails before semantic package checks run. Test files and verifier helpers are intentionally excluded and remain code-review-controlled.

Before either updater mode generates an inventory, the runtime-reference policy rejects manifest entries and local JavaScript, HTML, or CSS dependency edges that resolve into `tests/**`. The same policy runs through product attestation in every top-level package verifier, so manually approving regenerated hashes cannot make verifier-only files runtime-reachable. Test files and verifier helpers may remain excluded only while no product runtime reference points at them.

After an intentional product change, review the changed product bytes first, then regenerate and check the inventory from this directory in Command Prompt:

```bat
node tests\helpers\update-product-hashes.js --write
node tests\helpers\update-product-hashes.js --check
node --test tests\package-scanners.test.js tests\package-mutations.test.js tests\package.test.js tests\manifest.test.js
```

Do not regenerate the inventory merely to make an unexplained verifier failure pass. The inventory change must be reviewed together with the intentional product change. The helper uses only Node.js built-ins, writes paths in deterministic ordinal order with lowercase SHA-256 values, and is not a runtime dependency or build step.

To regenerate the checked-in icons intentionally, run:

```bat
python scripts\generate_icons.py
node --test tests\package.test.js
```

### Delivery verification status (2026-10-17)

| Verification area | Status |
| --- | --- |
| Dependency-free Node test suite, syntax checks, JSON validation, icon checks, package policy, and approved-product hash inventory | Automated pass |
| Unpacked Chrome smoke test | Not executed |
| Live LiteLLM connection success | Not executed |

No unpacked Chrome smoke test was performed for this package, and no live LiteLLM success was performed because no live endpoint and credentials were available. These limitations must not be read as live-browser or live-model validation.

### Manual acceptance checklist

Record **Pass**, **Fail**, or **Not executed** for each item. Without a live LiteLLM endpoint and key, mark only the live-network cases as **Not executed**; still complete local, static, mocked, and UI checks.

1. [ ] A first install with incomplete settings opens Settings.
2. [ ] Invalid form fields show errors and move focus to the validation summary.
3. [ ] Denying endpoint permission preserves the earlier saved settings.
4. [ ] Valid configuration and **Test connection** succeed against the provided LiteLLM server.
5. [ ] Selecting text alone creates no request.
6. [ ] Mouse, keyboard, `input`, and `textarea` selections work.
7. [ ] Empty and over-20,000-character selections show local errors without a network request.
8. [ ] **10-year-old** and **Engineer** produce visibly different explanations.
9. [ ] **Copy**, **Retry**, **Settings**, **Close**, and `Escape` work.
10. [ ] Enabling or disabling the extension changes button visibility on open pages without a reload.
11. [ ] Long output scrolls inside the panel on desktop and in a narrow viewport.
12. [ ] Invalid key, 429, timeout, offline, 5xx, invalid JSON, and incompatible responses show sanitized actionable errors.
13. [ ] Reloading the extension preserves saved settings.
14. [ ] `chrome://` pages and the Chrome Web Store behave as documented.
15. [ ] No API key appears in page DOM, popup output, content messages, or console logs.
