import { expect, test, type Page } from "@playwright/test";

/**
 * Browser-level tests.
 *
 * These cover the half of the system unit tests cannot reach: WebCrypto in a real secure context,
 * CodeMirror, Shiki, and the Prettier plugins actually loading over the network as separate chunks.
 */

const SECRET = "MARKER_c0ffee const answer = 42; 日本語 🔐";

/**
 * Types into CodeMirror, which has no <textarea> for `fill` to target.
 *
 * Clearing has to go through the keyboard: writing to `textContent` desynchronises CodeMirror's
 * document model from the DOM and subsequent input is discarded.
 */
async function typeIntoEditor(page: Page, text: string): Promise<void> {
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  // insertText rather than pressSequentially: typing newlines would trigger auto-indentation.
  await page.keyboard.insertText(text);
  // Assert on the first line only: CodeMirror renders each line as its own element, so the DOM text
  // has no newline for an assertion to span.
  await expect(editor).toContainText(text.split("\n")[0]!.slice(0, 24));
}

async function selectLanguage(page: Page, label: string): Promise<void> {
  // Named, because the expiry picker is also a combobox.
  await page.getByRole("combobox", { name: "Format" }).click();
  await page.getByPlaceholder("Search formats…").fill(label);
  await page.getByRole("option", { name: label, exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Format" })).toContainText(label);
}

async function createPaste(page: Page, content: string, options: { password?: string } = {}) {
  await page.goto("/");
  await typeIntoEditor(page, content);

  if (options.password) {
    await page.getByLabel("Password (optional)").fill(options.password);
  }

  await page.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByRole("heading", { name: "Your link is ready" })).toBeVisible();

  const url = await page.getByLabel("Share link").inputValue();
  expect(url).toContain("#");
  return url;
}

test("the create page loads with a working editor", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "ZeroPaste" })).toBeVisible();
  await expect(page.locator(".cm-content")).toBeVisible();
  // The insecure-context banner must not appear on a loopback origin.
  await expect(page.getByText("This page needs a secure connection")).toHaveCount(0);
});

test("round-trips a paste through the browser", async ({ page }) => {
  const url = await createPaste(page, SECRET);

  await page.goto(url);
  await expect(page.locator(".zeropaste-code")).toContainText("MARKER_c0ffee");
  await expect(page.locator(".zeropaste-code")).toContainText("日本語");
});

test("highlights with Shiki and numbers lines without polluting a copy", async ({ page }) => {
  await page.goto("/");
  await selectLanguage(page, "TypeScript");
  await typeIntoEditor(page, "const x: number = 1;\nconst y = x + 1;");
  await page.getByRole("button", { name: "Create link" }).click();
  const url = await page.getByLabel("Share link").inputValue();

  await page.goto(url);
  const code = page.locator(".zeropaste-code");
  await expect(code).toBeVisible();

  // Shiki emits per-token colours as CSS variables for both themes.
  await expect(code.locator("span[style*='--shiki-light']").first()).toBeVisible();

  // Line numbers come from a CSS counter, so textContent must not contain them.
  const text = await code.innerText();
  expect(text).toContain("const x: number = 1;");
  expect(text.startsWith("1")).toBe(false);
});

test("the fragment is required to decrypt", async ({ page }) => {
  const url = await createPaste(page, SECRET);

  // Strip everything from '#': exactly what a chat client that truncates URLs would deliver.
  await page.goto(url.split("#")[0]!);
  await expect(page.getByText(/the part after # is missing/)).toBeVisible();
  await expect(page.locator("body")).not.toContainText("MARKER_c0ffee");
});

test("a password is required and verified in the browser", async ({ page }) => {
  const url = await createPaste(page, SECRET, { password: "correct-horse" });

  await page.goto(url);
  await expect(page.getByText("This paste is password protected.")).toBeVisible();

  await page.getByLabel("This paste is password protected.").fill("wrong-horse");
  await page.getByRole("button", { name: "Open" }).click();
  await expect(page.getByText("Wrong password.")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("MARKER_c0ffee");

  await page.getByLabel("This paste is password protected.").fill("correct-horse");
  await page.getByRole("button", { name: "Open" }).click();
  await expect(page.locator(".zeropaste-code")).toContainText("MARKER_c0ffee");
});

test("the formatter reformats in the browser", async ({ page }) => {
  await page.goto("/");
  await selectLanguage(page, "TypeScript");
  await typeIntoEditor(page, "const x   =    {a:1,b:2}");

  await page.getByRole("button", { name: "Format" }).click();
  await expect(page.locator(".cm-content")).toContainText("const x = { a: 1, b: 2 };");
});

test("the formatter reports a syntax error without destroying the text", async ({ page }) => {
  await page.goto("/");
  await selectLanguage(page, "JSON");
  await typeIntoEditor(page, "{not json");

  await page.getByRole("button", { name: "Format" }).click();
  // The original text must survive a failed format.
  await expect(page.locator(".cm-content")).toContainText("{not json");
});

test("the Format button is disabled for languages with no browser formatter", async ({ page }) => {
  await page.goto("/");
  await typeIntoEditor(page, "print(1)");
  await selectLanguage(page, "Python");
  await expect(page.getByRole("button", { name: "Format" })).toBeDisabled();
});

test("the network never carries the plaintext or the key", async ({ page }) => {
  const bodies: string[] = [];
  const urls: string[] = [];

  page.on("request", (request) => {
    urls.push(request.url());
    const body = request.postData();
    if (body) bodies.push(body);
  });

  const url = await createPaste(page, SECRET);
  const fragment = url.split("#")[1]!;
  const key = fragment.split(".")[2]!;

  for (const body of bodies) {
    expect(body).not.toContain("MARKER_c0ffee");
    expect(body).not.toContain("日本語");
    expect(body).not.toContain(key);
  }
  // A fragment is never part of a request URL, but assert it rather than trusting the browser.
  for (const requested of urls) {
    expect(requested).not.toContain(key);
  }
});

test("the viewer's server-rendered HTML contains no content", async ({ page, request }) => {
  const url = await createPaste(page, SECRET);
  const id = new URL(url).pathname.split("/").pop()!;

  const response = await request.get(`/p/${id}`);
  const html = await response.text();

  expect(html).not.toContain("MARKER_c0ffee");
  expect(html).not.toContain("ciphertext");
  expect(response.headers()["x-robots-tag"]).toContain("noindex");
  expect(response.headers()["referrer-policy"]).toBe("no-referrer");
});

test("an unknown link reports that it is gone", async ({ page }) => {
  await page.goto(`/p/${"a".repeat(22)}#v1.n.${"A".repeat(43)}`);
  await expect(page.getByText(/does not exist, or it expired/)).toBeVisible();
});

test("Format fully expands JSON instead of leaving it on one line", async ({ page }) => {
  await page.goto("/");
  await selectLanguage(page, "JSON");
  await typeIntoEditor(page, '{"b":2,"a":[1,2]}');

  await page.getByRole("button", { name: "Format" }).click();

  // One key per line is what pressing Format on JSON is expected to produce.
  await expect(page.locator(".cm-content .cm-line")).not.toHaveCount(1);
  await expect(page.locator(".cm-content")).toContainText('"b": 2');
});

test("the editor offers language-aware folding", async ({ page }) => {
  await page.goto("/");
  await selectLanguage(page, "JSON");
  await typeIntoEditor(page, '{\n  "a": {\n    "b": 1\n  }\n}');

  // Target the "Fold line" marker specifically: the first element in the fold gutter is a hidden
  // one CodeMirror keeps for measurement, and it carries the "Unfold line" title.
  const foldMarker = page.locator('.cm-foldGutter span[title="Fold line"]').first();
  await expect(foldMarker).toBeVisible();
  await foldMarker.click();
  await expect(page.locator(".cm-foldPlaceholder")).toBeVisible();
});

test("the viewer folds and unfolds a block", async ({ page }) => {
  await page.goto("/");
  await selectLanguage(page, "JSON");
  await typeIntoEditor(page, '{\n  "outer": {\n    "inner": 1\n  },\n  "tail": 2\n}');
  await page.getByRole("button", { name: "Create link" }).click();
  const url = await page.getByLabel("Share link").inputValue();

  await page.goto(url);
  const code = page.locator(".zeropaste-code");
  await expect(code).toContainText('"inner": 1');

  // Fold the "outer" block: its body disappears, the sibling key stays.
  const outerRow = page.locator(".zp-row").nth(1);
  await outerRow.hover();
  await outerRow.getByRole("button", { name: "Collapse block" }).click();

  await expect(code).not.toContainText('"inner": 1');
  await expect(code).toContainText('"tail": 2');
  // The "⋯ 1 line" label is CSS generated content and so is absent from the text on purpose — assert
  // on the accessible name instead.
  await expect(page.getByRole("button", { name: "Expand 1 hidden line" })).toBeVisible();

  // Unfold it again.
  await outerRow.getByRole("button", { name: "Expand block" }).click();
  await expect(code).toContainText('"inner": 1');
});

test("folding does not renumber the remaining lines", async ({ page }) => {
  await page.goto("/");
  await selectLanguage(page, "JSON");
  await typeIntoEditor(page, '{\n  "a": {\n    "b": 1\n  },\n  "z": 9\n}');
  await page.getByRole("button", { name: "Create link" }).click();
  await page.goto(await page.getByLabel("Share link").inputValue());

  const row = page.locator(".zp-row").nth(1);
  await row.hover();
  await row.getByRole("button", { name: "Collapse block" }).click();

  // Line numbers come from a per-row counter reset, so `"z": 9` must still read as line 5 even though
  // the rows between it and the header are no longer in the DOM.
  //
  // Asserted on the counter-reset value rather than the rendered glyph: getComputedStyle returns
  // `content` unresolved as the literal "counter(zp-line)", so the painted number is not observable
  // from script. The reset is the mechanism that produces it.
  const zRow = page.locator(".zp-row", { hasText: '"z": 9' }).first();
  await expect(zRow).toHaveCSS("counter-reset", "zp-line 4");

  // And the collapsed row really is gone rather than merely hidden: 6 source lines, 1 folded away.
  await expect(page.locator(".zp-row")).toHaveCount(5);
});

test("collapse all and expand all work from the header controls", async ({ page }) => {
  await page.goto("/");
  await selectLanguage(page, "JSON");
  await typeIntoEditor(page, '{\n  "a": {\n    "b": 1\n  }\n}');
  await page.getByRole("button", { name: "Create link" }).click();
  await page.goto(await page.getByLabel("Share link").inputValue());

  const code = page.locator(".zeropaste-code");
  await code.hover();

  await page.getByRole("button", { name: "Collapse all" }).click();
  await expect(code).not.toContainText('"b": 1');

  await page.getByRole("button", { name: "Expand all" }).click();
  await expect(code).toContainText('"b": 1');
});

test("copying the viewer's content excludes line numbers and fold controls", async ({ page }) => {
  await page.goto("/");
  await typeIntoEditor(page, "alpha\n  beta\n  gamma");
  await page.getByRole("button", { name: "Create link" }).click();
  await page.goto(await page.getByLabel("Share link").inputValue());

  // The gutter's number is generated content and the arrow is an SVG, so neither is in the text.
  const text = await page.locator(".zeropaste-code").innerText();
  expect(text).toContain("alpha");
  expect(text.replace(/\s/g, "")).toBe("alphabetagamma");
});

test.describe("footer", () => {
  test("links to the personal site and the source repository", async ({ page }) => {
    await page.goto("/");

    const site = page.getByRole("contentinfo").getByRole("link", { name: "xiaochen.dev" });
    await expect(site).toHaveAttribute("href", "https://xiaochen.dev");
    // Opens in a new tab so clicking it cannot discard an unsaved paste.
    await expect(site).toHaveAttribute("target", "_blank");
    await expect(site).toHaveAttribute("rel", /noopener/);

    const source = page.getByRole("contentinfo").getByRole("link", { name: /Source/ });
    await expect(source).toHaveAttribute("href", "https://github.com/okxiaochen/zeropaste");
  });

  test("is absent from the viewer", async ({ page }) => {
    // The product requirement is that opening a share link shows the content and nothing else. A
    // footer is something else, so this asserts it stays off that page.
    const url = await createPaste(page, SECRET);
    await page.goto(url);

    await expect(page.locator(".zeropaste-code")).toContainText("MARKER_c0ffee");
    await expect(page.getByRole("contentinfo")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "xiaochen.dev" })).toHaveCount(0);
  });

  test("is present on the share-result page", async ({ page }) => {
    await page.goto("/");
    await typeIntoEditor(page, "footer check");
    await page.getByRole("button", { name: "Create link" }).click();

    await expect(page.getByRole("heading", { name: "Your link is ready" })).toBeVisible();
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "xiaochen.dev" })).toBeVisible();
  });
});

test.describe("theme", () => {
  test("follows the system preference by default", async ({ browser }) => {
    const dark = await browser.newContext({ colorScheme: "dark" });
    const darkPage = await dark.newPage();
    await darkPage.goto("/");
    await expect(darkPage.locator("html")).toHaveClass(/dark/);
    await dark.close();

    const light = await browser.newContext({ colorScheme: "light" });
    const lightPage = await light.newPage();
    await lightPage.goto("/");
    await expect(lightPage.locator("html")).not.toHaveClass(/dark/);
    await light.close();
  });

  test("cycles system, light, then dark", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");

    const toggle = () => page.getByRole("button", { name: /^Theme:/ });
    await expect(toggle()).toHaveAttribute("aria-label", "Theme: follow system");
    await expect(page.locator("html")).toHaveClass(/dark/);

    await toggle().click();
    await expect(toggle()).toHaveAttribute("aria-label", "Theme: light");
    // The case most often broken: an explicit light choice must beat a dark OS.
    await expect(page.locator("html")).not.toHaveClass(/dark/);

    await toggle().click();
    await expect(toggle()).toHaveAttribute("aria-label", "Theme: dark");
    await expect(page.locator("html")).toHaveClass(/dark/);

    await toggle().click();
    await expect(toggle()).toHaveAttribute("aria-label", "Theme: follow system");
  });

  test("forces dark on a light system", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");

    const toggle = page.getByRole("button", { name: /^Theme:/ });
    await toggle.click();
    await toggle.click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  });

  test("persists the choice across navigation without a flash of the wrong theme", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await page.getByRole("button", { name: /^Theme:/ }).click(); // system -> light

    await page.reload();

    // Asserted on the very first commit rather than after settling: the blocking script in <head> is
    // what prevents a light-then-dark flip, and this is the only way to catch its absence.
    const classAtFirstPaint = await page.evaluate(() => document.documentElement.className);
    expect(classAtFirstPaint).not.toContain("dark");
    await expect(page.getByRole("button", { name: "Theme: light" })).toBeVisible();
  });

  test("reacts to the system preference changing while in system mode", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await expect(page.locator("html")).not.toHaveClass(/dark/);

    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveClass(/dark/);
  });

  test("is available in the viewer and recolours the code", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await selectLanguage(page, "TypeScript");
    await typeIntoEditor(page, "const x: number = 1;");
    await page.getByRole("button", { name: "Create link" }).click();
    await page.goto(await page.getByLabel("Share link").inputValue());

    const token = page.locator(".zp-code span[style*='--shiki-light']").first();
    const lightColour = await token.evaluate((node) => getComputedStyle(node).color);

    await page.locator(".zeropaste-code").hover();
    const toggle = page.getByRole("button", { name: /^Theme:/ });
    await toggle.click();
    await toggle.click(); // system -> light -> dark

    await expect(page.locator("html")).toHaveClass(/dark/);
    // Shiki writes both themes' colours onto every token, so switching reads the other variable
    // rather than re-tokenising.
    await expect
      .poll(() => token.evaluate((node) => getComputedStyle(node).color))
      .not.toBe(lightColour);
  });
});

test("the copy button is hidden until hover", async ({ page }) => {
  const url = await createPaste(page, SECRET);
  await page.goto(url);

  // The fade is applied to the control cluster, not to each button, so that adding a control does not
  // mean repeating the rule. Assert on the container the copy button sits in.
  const controls = page.getByRole("button", { name: "Copy to clipboard" }).locator("..");
  await expect(controls).toHaveCSS("opacity", "0");

  await page.locator(".zeropaste-code").hover();
  await expect(controls).toHaveCSS("opacity", "1");
});
