class FakeStyle {
  constructor() {
    this.values = new Map();
    this.priorities = new Map();
  }

  setProperty(name, value, priority = "") {
    this.values.set(String(name), String(value));
    this.priorities.set(String(name), String(priority));
  }

  getPropertyValue(name) {
    return this.values.get(String(name)) ?? "";
  }

  getPropertyPriority(name) {
    return this.priorities.get(String(name)) ?? "";
  }

  removeProperty(name) {
    const previous = this.getPropertyValue(name);
    this.values.delete(String(name));
    this.priorities.delete(String(name));
    return previous;
  }
}

export class FakeEvent {
  constructor(type, { key = "", bubbles = true, isTrusted = false } = {}) {
    this.type = type;
    this.key = key;
    this.bubbles = bubbles;
    this.isTrusted = isTrusted;
    this.defaultPrevented = false;
    this.propagationStopped = false;
    this.target = null;
    this.currentTarget = null;
  }

  preventDefault() {
    this.defaultPrevented = true;
  }

  stopPropagation() {
    this.propagationStopped = true;
  }
}

function listenerCapture(options) {
  if (typeof options === "boolean") return options;
  return Boolean(options?.capture);
}

function invokeListener(listener, event) {
  if (typeof listener.callback === "function") {
    listener.callback.call(event.currentTarget, event);
  } else {
    listener.callback?.handleEvent?.(event);
  }
}

class FakeNode {
  constructor(ownerDocument) {
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.childNodes = [];
    this.listeners = new Map();
  }

  get children() {
    return this.childNodes.filter((node) => node instanceof FakeElement);
  }

  get isConnected() {
    let node = this;
    while (node) {
      if (node instanceof FakeDocument) return true;
      if (node instanceof FakeShadowRoot) node = node.host;
      else node = node.parentNode;
    }
    return false;
  }

  append(...nodes) {
    for (const node of nodes) {
      if (!(node instanceof FakeNode)) {
        throw new TypeError("Fake DOM append accepts nodes only.");
      }
      node.remove();
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }

  remove() {
    if (!this.parentNode) return;
    const siblings = this.parentNode.childNodes;
    const index = siblings.indexOf(this);
    if (index >= 0) siblings.splice(index, 1);
    this.parentNode = null;
  }

  addEventListener(type, callback, options = false) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push({ callback, capture: listenerCapture(options) });
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, callback, options = false) {
    const capture = listenerCapture(options);
    const listeners = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      listeners.filter((listener) => (
        listener.callback !== callback || listener.capture !== capture
      ))
    );
  }

  listenerCount(type, options = undefined) {
    const listeners = this.listeners.get(type) ?? [];
    if (options === undefined) return listeners.length;
    const capture = listenerCapture(options);
    return listeners.filter((listener) => listener.capture === capture).length;
  }

  dispatchEvent(event) {
    if (!(event instanceof FakeEvent)) {
      throw new TypeError("dispatchEvent requires FakeEvent.");
    }
    if (!event.target) event.target = this;

    let node = this;
    while (node) {
      event.currentTarget = node;
      for (const listener of [...(node.listeners.get(event.type) ?? [])]) {
        invokeListener(listener, event);
        if (event.propagationStopped) break;
      }
      if (!event.bubbles || event.propagationStopped) break;
      node = node.parentNode;
    }
    event.currentTarget = null;
    return !event.defaultPrevented;
  }
}

class FakeTextNode extends FakeNode {
  constructor(ownerDocument, value) {
    super(ownerDocument);
    this._textContent = String(value ?? "");
  }

  get textContent() {
    return this._textContent;
  }

  set textContent(value) {
    this._textContent = String(value ?? "");
  }
}

function descendantsOf(node) {
  const descendants = [];
  for (const child of node.children) {
    descendants.push(child, ...descendantsOf(child));
  }
  return descendants;
}

function matchesSelector(element, selector) {
  const trimmed = selector.trim();
  if (trimmed.startsWith("#")) return element.id === trimmed.slice(1);
  if (trimmed.startsWith(".")) {
    return element.className.split(/\s+/).includes(trimmed.slice(1));
  }

  const attributeMatch = trimmed.match(/^\[([^=\]]+)(?:=["']([^"']*)["'])?\]$/);
  if (attributeMatch) {
    const [, name, expected] = attributeMatch;
    if (!element.hasAttribute(name)) return false;
    return expected === undefined || element.getAttribute(name) === expected;
  }

  return element.localName === trimmed.toLowerCase();
}

class FakeParentNode extends FakeNode {
  querySelector(selector) {
    return descendantsOf(this).find((element) => matchesSelector(element, selector)) ?? null;
  }

  querySelectorAll(selector) {
    return descendantsOf(this).filter((element) => matchesSelector(element, selector));
  }
}

const attachedShadowRoots = new WeakMap();

export function getFakeShadowRoot(host) {
  return attachedShadowRoots.get(host) ?? null;
}

class FakeShadowRoot extends FakeParentNode {
  constructor(ownerDocument, host, mode) {
    super(ownerDocument);
    this.host = host;
    this.mode = mode;
    this.activeElement = null;
  }
}

class FakeElement extends FakeParentNode {
  constructor(ownerDocument, localName) {
    super(ownerDocument);
    this.localName = String(localName).toLowerCase();
    this.tagName = this.localName.toUpperCase();
    this.attributes = new Map();
    this.dataset = {};
    this.style = new FakeStyle();
    this.shadowRoot = null;
    this.className = "";
    this.id = "";
    this.type = "";
    this.value = "";
    this.hidden = false;
    this.disabled = false;
    this.tabIndex = 0;
    this._textContent = "";
  }

  get textContent() {
    return this._textContent + this.childNodes.map((node) => node.textContent).join("");
  }

  set textContent(value) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    this._textContent = String(value ?? "");
  }

  setAttribute(name, value) {
    const normalizedName = String(name);
    const normalizedValue = String(value);
    this.attributes.set(normalizedName, normalizedValue);
    if (normalizedName === "id") this.id = normalizedValue;
    if (normalizedName === "class") this.className = normalizedValue;
  }

  getAttribute(name) {
    return this.attributes.get(String(name)) ?? null;
  }

  hasAttribute(name) {
    return this.attributes.has(String(name));
  }

  removeAttribute(name) {
    this.attributes.delete(String(name));
  }

  attachShadow({ mode }) {
    const shadow = new FakeShadowRoot(this.ownerDocument, this, mode);
    attachedShadowRoots.set(this, shadow);
    this.shadowRoot = mode === "open" ? shadow : null;
    return shadow;
  }

  getRootNode() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node;
  }

  focus() {
    let node = this;
    while (node instanceof FakeElement) {
      if (node.hidden || node.style.getPropertyValue("display") === "none") return;
      node = node.parentNode;
    }

    const root = this.getRootNode();
    if (root instanceof FakeShadowRoot) {
      root.activeElement = this;
      this.ownerDocument.activeElement = root.host;
    } else {
      this.ownerDocument.activeElement = this;
    }
  }

  click() {
    this.dispatchEvent(new FakeEvent("click"));
  }
}

class FakeDocument extends FakeParentNode {
  constructor() {
    super(null);
    this.ownerDocument = this;
    this.documentElement = new FakeElement(this, "html");
    this.body = new FakeElement(this, "body");
    this.documentElement.parentNode = this;
    this.childNodes.push(this.documentElement);
    this.documentElement.append(this.body);
    this.activeElement = this.body;
  }

  createElement(localName) {
    return new FakeElement(this, localName);
  }

  createTextNode(value) {
    return new FakeTextNode(this, value);
  }

  getElementById(id) {
    return descendantsOf(this).find((element) => element.id === id) ?? null;
  }
}

export function installFakeDom() {
  const previousDocument = globalThis.document;
  const previousChrome = globalThis.chrome;
  const document = new FakeDocument();

  globalThis.document = document;
  globalThis.chrome = {
    runtime: {
      getURL(path) {
        return `chrome-extension://test/${path}`;
      }
    }
  };

  return {
    document,
    restore() {
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
      if (previousChrome === undefined) delete globalThis.chrome;
      else globalThis.chrome = previousChrome;
    }
  };
}
