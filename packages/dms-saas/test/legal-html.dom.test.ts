import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { defineComponent, h } from "vue";
import {
  parseLegalDocument,
  renderAllowedHtml,
} from "../frontend-vue/app/build/public/legal-html";

/** The page markup a stored legal document renders to. */
function rendered(html: string): string {
  const body = parseLegalDocument(html);
  const view = defineComponent({
    render: () => h("div", renderAllowedHtml(body)),
  });
  return mount(view).html({ raw: true });
}

describe("legal document rendering", () => {
  it("drops scripts, event handlers and script links", () => {
    const html = rendered(
      [
        "<p>Terms<script>alert(1)</script></p>",
        '<p onclick="alert(2)">Clause<img src="x" onerror="alert(3)"></p>',
        '<a href="javascript:alert(4)">One</a>',
        '<a href=" java\tscript:alert(5)">Two</a>',
        '<iframe srcdoc="<script>alert(6)</script>"><p>Hidden</p></iframe>',
        '<a href="&#xa0;javascript:alert(7)">Three</a>',
        '<a href="&#xfeff;javascript:alert(8)">Four</a>',
        '<a href="data:text/html,<script>alert(9)</script>">Five</a>',
        '<p style="background: url(javascript:alert(10)); text-align: expression(alert(11))">Styled</p>',
      ].join(""),
    );

    expect(html).toBe(
      "<div><p>Terms</p><p>Clause</p><a>One</a><a>Two</a><a>Three</a><a>Four</a><a>Five</a><p>Styled</p></div>",
    );
  });

  it("keeps the formatting the rich text editor writes", () => {
    const html = rendered(
      [
        '<h2 id="section-scope" style="text-align: center">Scope</h2>',
        '<p style="text-align: justify">A <strong>b</strong> <em>c</em> <u>d</u> <s>e</s> <code>f</code><br>g</p>',
        "<ul><li><p>One</p></li></ul>",
        '<ol start="3"><li><p>Three</p></li></ol>',
        "<blockquote><p>Quote</p></blockquote>",
        "<pre><code>block</code></pre>",
        "<hr>",
        '<p><a target="_blank" rel="noopener noreferrer nofollow" href="https://example.test/terms" class="text-primary">Link</a> <a href="/privacy">Privacy</a> <a href="mailto:legal@example.test">Mail</a></p>',
      ].join(""),
    );

    expect(html).toBe(
      [
        "<div>",
        '<h2 style="text-align: center;" id="section-scope">Scope</h2>',
        '<p style="text-align: justify;">A <strong>b</strong> <em>c</em> <u>d</u> <s>e</s> <code>f</code><br>g</p>',
        "<ul><li><p>One</p></li></ul>",
        '<ol start="3"><li><p>Three</p></li></ol>',
        "<blockquote><p>Quote</p></blockquote>",
        "<pre><code>block</code></pre>",
        "<hr>",
        '<p><a href="https://example.test/terms" target="_blank" rel="noopener noreferrer">Link</a> <a href="/privacy">Privacy</a> <a href="mailto:legal@example.test">Mail</a></p>',
        "</div>",
      ].join(""),
    );
  });

  it("finds only the headings the page shows, and anchors only those the contents link to", () => {
    const body = parseLegalDocument(
      '<h2>Shown</h2><noscript><h2>Hidden</h2></noscript><h4 id="clobber">Detail</h4>',
    );

    expect(
      [...body.querySelectorAll("h2")].map((node) => node.textContent),
    ).toEqual(["Shown"]);
    expect(rendered('<h4 id="clobber">Detail</h4>')).toBe(
      "<div><h4>Detail</h4></div>",
    );
  });
});
