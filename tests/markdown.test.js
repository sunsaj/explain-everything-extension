import test from "node:test";
import assert from "node:assert/strict";
import { installFakeDom } from "./helpers/fake-dom.js";
import { renderMarkdown } from "../content/markdown.js";

function withDom(callback) {
  const environment = installFakeDom();
  try {
    return callback(environment.document);
  } finally {
    environment.restore();
  }
}

test("plain text remains readable paragraphs", () => withDom((document) => {
  const root = renderMarkdown("First paragraph.\n\nSecond paragraph.", document);
  const paragraphs = root.querySelectorAll("p");
  assert.equal(paragraphs.length, 2);
  assert.equal(paragraphs[0].textContent, "First paragraph.");
  assert.equal(paragraphs[1].textContent, "Second paragraph.");
}));

test("renders headings emphasis inline code and nested lists", () => withDom((document) => {
  const tick = String.fromCharCode(96);
  const source = [
    "## Summary",
    "",
    "Use **bold**, *italic*, ~~removed~~, and " + tick + "code()" + tick + ".",
    "",
    "- First",
    "  - Nested",
    "- Second"
  ].join("\n");
  const root = renderMarkdown(source, document);
  assert.equal(root.querySelector("h2").textContent, "Summary");
  assert.equal(root.querySelector("strong").textContent, "bold");
  assert.equal(root.querySelector("em").textContent, "italic");
  assert.equal(root.querySelector("del").textContent, "removed");
  assert.equal(root.querySelector("code").textContent, "code()");
  assert.equal(root.querySelectorAll("ul").length, 2);
  assert.equal(root.querySelectorAll("li").length, 3);
}));

test("renders fenced code literally with a language label", () => withDom((document) => {
  const fence = String.fromCharCode(96).repeat(3);
  const source = [fence + "js", "<script>alert('x')</script>", fence].join("\n");
  const root = renderMarkdown(source, document);
  const code = root.querySelector("code");
  assert.equal(code.textContent, "<script>alert('x')</script>");
  assert.equal(root.querySelector("script"), null);
  assert.equal(root.querySelector(".md-code-language").textContent, "js");
}));

test("renders blockquotes horizontal rules and tables", () => withDom((document) => {
  const source = [
    "> Important note",
    "",
    "---",
    "",
    "| Name | Value |",
    "| :--- | ---: |",
    "| Alpha | 10 |"
  ].join("\n");
  const root = renderMarkdown(source, document);
  assert.equal(root.querySelector("blockquote").textContent, "Important note");
  assert.ok(root.querySelector("hr"));
  assert.equal(root.querySelectorAll("th").length, 2);
  assert.equal(root.querySelectorAll("td").length, 2);
  assert.ok(root.querySelector(".md-table-scroll"));
}));

test("allows only safe HTTP links and never creates remote images", () => withDom((document) => {
  const source = [
    "[Safe](https://example.com/docs)",
    "[Unsafe](javascript:alert(1))",
    "![Tracker](https://example.com/tracker.png)"
  ].join(" ");
  const root = renderMarkdown(source, document);
  const links = root.querySelectorAll("a");
  assert.equal(links.length, 1);
  assert.equal(links[0].getAttribute("href"), "https://example.com/docs");
  assert.equal(links[0].getAttribute("target"), "_blank");
  assert.equal(links[0].getAttribute("rel"), "noopener noreferrer nofollow");
  assert.equal(root.querySelector("img"), null);
  assert.match(root.textContent, /Unsafe/);
  assert.match(root.textContent, /Image: Tracker/);
}));

test("treats embedded HTML and malformed Markdown as text", () => withDom((document) => {
  const root = renderMarkdown("<script>alert(1)</script> **unfinished", document);
  assert.equal(root.querySelector("script"), null);
  assert.match(root.textContent, /<script>alert\(1\)<\/script>/);
  assert.match(root.textContent, /\*\*unfinished/);
}));
