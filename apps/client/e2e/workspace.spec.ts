import { test, expect } from "@playwright/test";
test("real host: code, old side, history selection, stale state and keyboard explanation", async ({
  page,
  request,
}) => {
  const info = await (await request.get("/test-info")).json();
  await page.goto("/e2e/");
  await page.getByRole("button", { name: "Choose repository" }).click();
  await page.getByLabel("Repository path").fill(info.repo);
  await page
    .getByRole("button", { name: "Open repository", exact: true })
    .click();
  await page.getByRole("button", { name: "File Code.cs", exact: true }).click();
  await expect(page.locator(".cm-content").last()).toContainText("50");
  await page.getByRole("button", { name: "View options", exact: true }).click();
  await page.getByLabel("Diff view").selectOption("split");
  await page.getByRole("button", { name: "Close View options" }).click();
  await expect(page.locator(".cm-mergeView")).toBeVisible();
  await expect(page.locator(".cm-content").first()).toContainText("30");
  await page
    .getByRole("button", { name: "Explain selection", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Explanation" }),
  ).toContainText("No explanation yet");
  const target = await page.getByTestId("explanation-target").textContent();
  await page.getByRole("button", { name: "View options", exact: true }).click();
  await page.getByLabel("Explanation placement").selectOption("popover");
  await page.getByRole("button", { name: "Close View options" }).click();
  await expect(page.getByTestId("explanation-target")).toHaveText(target!);
  await expect
    .poll(async () =>
      page
        .locator(".explanation.popover")
        .evaluate((el) => getComputedStyle(el).backgroundColor),
    )
    .not.toBe("rgba(0, 0, 0, 0)");
  await page.getByRole("button", { name: "Commit Initial wallet" }).click();
  await expect(
    page.getByLabel("Commit details", { exact: true }),
  ).toContainText("UI Test");
  await expect(page.locator(".cm-content").last()).toContainText("50");
  await page
    .getByRole("button", { name: "Branch feature", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Commit Document wallet" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "File Deleted.cs", exact: true })
    .click();
  await expect(page.getByText("File deleted", { exact: true })).toBeVisible();
  await expect(page.locator(".cm-content").first()).toContainText("Removed");
  await page.getByRole("button", { name: "File Code.cs", exact: true }).click();
  await request.post("/test-change");
  await expect(
    page.getByRole("button", { name: "Refresh snapshot" }),
  ).toBeVisible({ timeout: 10000 });
  await expect(page.locator(".cm-content").last()).toContainText("50");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("complementary", { name: "Explanation" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh snapshot" }).click();
  await expect(page.locator(".cm-content").last()).toContainText(
    "ChangedExternally",
  );
});
for (const width of [1280, 1024, 390])
  test(`workspace layout ${width} and read-only keyboard access`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 850 });
    const info = await (await request.get("/test-info")).json();
    await page.goto("/e2e/");
    await page.getByRole("button", { name: "Choose repository" }).click();
    await page.getByLabel("Repository path").fill(info.repo);
    await page
      .getByRole("button", { name: "Open repository", exact: true })
      .click();
    await page
      .getByRole("button", { name: "File Code.cs", exact: true })
      .click();
    await expect(page.getByRole("region", { name: "Git Log" })).toBeVisible();
    await expect(page.locator(".cm-content").last()).toHaveAttribute(
      "contenteditable",
      "false",
    );
    await page
      .getByRole("button", { name: "Explain selection", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("explanation-target")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `../../.superpowers/t3-${width}.png`,
      fullPage: true,
    });
  });

test("cached 1900-line file switch and scroll restoration", async ({
  page,
  request,
}) => {
  const info = await (await request.get("/test-info")).json();
  await page.goto("/e2e/");
  await page.getByRole("button", { name: "Choose repository" }).click();
  await page.getByLabel("Repository path").fill(info.repo);
  await page
    .getByRole("button", { name: "Open repository", exact: true })
    .click();
  await page.getByLabel("File list scope").selectOption("all");
  await page
    .getByRole("button", { name: "File Large.cs", exact: true })
    .click();
  await expect(page.locator(".cm-content")).toContainText("line 0");
  await page.locator(".cm-scroller").evaluate((el) => {
    el.scrollTop = 700;
  });
  await page.waitForTimeout(100);
  await page.getByRole("button", { name: "File Code.cs", exact: true }).click();
  await expect(page.locator(".cm-content")).toContainText("class");
  const elapsed = await page
    .getByRole("tab", { name: /Large.cs/ })
    .evaluate(async (el) => {
      const start = performance.now();
      (el as HTMLElement).click();
      await new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      );
      return performance.now() - start;
    });
  await expect
    .poll(() => page.locator(".cm-scroller").evaluate((el) => el.scrollTop))
    .toBeGreaterThan(600);
  expect(elapsed).toBeLessThan(200);
  console.log("hot cached file switch ms", elapsed);
});

test("100k commit repository renders first graph within budget", async ({
  page,
  request,
}) => {
  const info = await (await request.get("/test-info")).json();
  test.skip(
    !info.bench,
    "Set AGAI_UI_BENCH_REPO to the disposable benchmark fixture",
  );
  const startup: number[] = [];
  const hot: number[] = [];
  for (let i = 0; i < 5; i++) {
    await page.goto("/e2e/");
    await page.getByRole("button", { name: "Choose repository" }).click();
    await page.getByLabel("Repository path").fill(info.bench);
    const begin = Date.now();
    await page
      .getByRole("button", { name: "Open repository", exact: true })
      .click();
    await expect(page.locator(".commit-row").first()).toBeVisible();
    startup.push(Date.now() - begin);
    const refresh = Date.now();
    await page
      .getByRole("button", { name: "Refresh history", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Refresh history", exact: true }),
    ).toBeEnabled();
    await page.waitForFunction(
      () =>
        document.querySelector(".git-heading")?.getAttribute("data-loading") ===
        "false",
    );
    hot.push(Date.now() - refresh);
  }
  console.log("100k first graph ms", startup, "hot history ms", hot);
  expect(Math.max(...startup)).toBeLessThan(5000);
  expect(Math.max(...hot)).toBeLessThan(2000);
});

test("historical root commit and snapshot comparison keep working tab intact", async ({
  page,
  request,
}) => {
  const info = await (await request.get("/test-info")).json();
  await page.goto("/e2e/");
  await page.getByRole("button", { name: "Choose repository" }).click();
  await page.getByLabel("Repository path").fill(info.repo);
  await page
    .getByRole("button", { name: "Open repository", exact: true })
    .click();
  await page.getByRole("button", { name: "File Code.cs", exact: true }).click();
  const sourceText = async () =>
    (await page.locator(".cm-content .cm-line").allTextContents()).join("\n");
  await expect(page.locator(".cm-content")).toContainText("Wallet");
  const working = await sourceText();
  await page.locator(".revision-details summary").click();
  const ids = [
    await page.getByTestId("base-version-id").textContent(),
    await page.getByTestId("target-version-id").textContent(),
  ];
  await page.locator(".revision-details summary").click();
  await page.getByRole("button", { name: "Commit Initial wallet" }).click();
  await page
    .getByLabel("Commit details", { exact: true })
    .getByRole("button", { name: "Code.cs", exact: true })
    .click();
  await expect(page.locator(".cm-content")).toContainText("Balance = 30");
  await expect(page.locator(".revision-details summary")).toContainText(
    "Empty tree",
  );
  await page.getByRole("tab", { name: /Code.cs Worktree/ }).click();
  await expect.poll(sourceText).toBe(working);
  await page.getByRole("button", { name: "View options", exact: true }).click();
  await page.getByRole("button", { name: "Snapshots", exact: true }).click();
  await page.getByLabel("Base snapshot ID").fill(ids[0]!);
  await page.getByLabel("Target snapshot ID").fill(ids[1]!);
  await page.getByRole("button", { name: "Compare snapshots" }).click();
  await expect(page.locator(".revision-details summary")).toContainText(
    "Snapshot",
  );
  await expect.poll(sourceText).toBe(working);
});

test("chosen base lists files deleted before the target parent", async ({
  page,
  request,
}) => {
  const info = await (await request.get("/test-info")).json();
  await page.goto("/e2e/");
  await page.getByRole("button", { name: "Choose repository" }).click();
  await page.getByLabel("Repository path").fill(info.repo);
  await page
    .getByRole("button", { name: "Open repository", exact: true })
    .click();
  await page.getByRole("button", { name: "Commit Initial wallet" }).click();
  await page.getByRole("button", { name: "Use as comparison base" }).click();
  await page.getByRole("button", { name: "Commit Document wallet" }).click();
  await page
    .getByLabel("Commit details", { exact: true })
    .getByRole("button", { name: "EarlierDeleted.cs", exact: true })
    .click();
  await expect(page.getByText("File deleted", { exact: true })).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText(
    "class EarlierDeleted {}",
  );
  await expect(page.locator(".revision-details summary")).toContainText(
    info.first.slice(0, 8),
  );
});

test("real MCP explanations appear at code and human acceptance stays on the original pair", async ({
  page,
  request,
}) => {
  const info = await (await request.get("/test-info")).json();
  test.setTimeout(60000);
  const seeded = await request.post("/test-mcp-seed");
  expect(seeded.ok()).toBeTruthy();
  await page.goto("/e2e/");
  await page.getByRole("button", { name: "Choose repository" }).click();
  await page.getByLabel("Repository path").fill(info.repo);
  await page
    .getByRole("button", { name: "Open repository", exact: true })
    .click();
  await page.getByRole("button", { name: "File Code.cs", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Начальный баланс 75", exact: true }),
  ).toBeVisible();
  await page.getByTitle(/Начальный баланс 75/).click();
  await expect(page.locator(".cm-explained-line")).toHaveCount(1);
  await expect(page.getByTestId("explanation-target")).toContainText(
    "lines 2–2",
  );
  await expect(
    page.getByRole("button", { name: "Accepted", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Open original version", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Accepted", exact: true }),
  ).toBeVisible();
  await page.getByText("Details and checks", { exact: true }).click();
  await expect(
    page.getByText("The agent did not report alternatives.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Проверены байты тестового файла, не выполнение C#.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Accepted", exact: true }).click();
  await expect(
    page.getByText("Your review: Accepted", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "File Code.cs", exact: true }).click();
  await expect(
    page.getByText("Your review: Accepted", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("File list scope").selectOption("working");
  await page.getByRole("button", { name: "File Code.cs", exact: true }).click();
  await expect(
    page.getByText("Your review: Accepted", { exact: true }),
  ).toHaveCount(0);
});

test("partial staging preview, commit, and real drag docking", async ({
  page,
  request,
}) => {
  const info = await (await request.get("/test-operations")).json();
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.goto("/e2e/");
  await page.getByRole("button", { name: "Choose repository" }).click();
  await page.getByLabel("Repository path").fill(info.repo);
  await page
    .getByRole("button", { name: "Open repository", exact: true })
    .click();
  await page
    .getByRole("button", { name: "File Selected.cs", exact: true })
    .click();
  await page.getByRole("button", { name: "Code actions", exact: true }).click();
  await page
    .getByRole("button", { name: "Hunk at cursor → Index…", exact: true })
    .click();
  const preview = page.getByRole("dialog", { name: "Index preview" });
  await expect(preview).toBeVisible();
  await expect(preview.locator("pre").last()).toContainText("new");
  await expect(preview.locator("pre").last()).not.toContainText("extra");
  await page
    .getByRole("button", { name: "Apply to Index", exact: true })
    .click();
  await expect(page.locator(".git-job")).toContainText("Git: done", {
    timeout: 15000,
  });
  const result = await (await request.get("/test-operations-state")).json();
  expect(result.index).toBe("new\n" + "keep\n".repeat(12));
  expect(result.worktree).toContain("extra");
  await page.getByRole("button", { name: "Git menu" }).click();
  await page.getByRole("button", { name: "Commit…", exact: true }).click();
  await page.getByLabel("Commit message").fill("UI partial commit");
  await page
    .getByRole("button", { name: "Create commit", exact: true })
    .click();
  await expect(page.locator(".git-job")).toContainText("Git: done", {
    timeout: 15000,
  });
  await expect
    .poll(
      async () =>
        (await (await request.get("/test-operations-state")).json()).subject,
    )
    .toBe("UI partial commit");
  await page.getByRole("button", { name: "Close Git", exact: true }).click();
  // Drag the title itself, not the placement menu. Persisted geometry must change.
  const title = page.locator(".dock-panel-files > .dock-title");
  const target = page.locator(".dock-panel-code");
  const before = await page.evaluate(() =>
    localStorage.getItem("agai-layout-v1"),
  );
  const targetBox = (await target.boundingBox())!;
  await title.dragTo(target, {
    targetPosition: { x: targetBox.width - 8, y: 120 },
  });
  const filesBox = await page.locator(".dock-panel-files").boundingBox();
  const codeBox = await target.boundingBox();
  expect(filesBox).not.toBeNull();
  expect(codeBox).not.toBeNull();
  expect(filesBox!.x).toBeGreaterThan(codeBox!.x);
  expect(
    await page.evaluate(() => localStorage.getItem("agai-layout-v1")),
  ).not.toBe(before);
  await page.screenshot({
    path: "../../.superpowers/t5-git-ui.png",
    fullPage: true,
  });
});

test("real MCP trace, call stack, pinned code and diagram", async ({
  page,
  request,
}) => {
  const info = await (await request.get("/test-info")).json();
  const seeded = await request.post("/test-learning-seed");
  expect(seeded.ok()).toBeTruthy();
  const ids = await seeded.json();
  await page.setViewportSize({ width: 1680, height: 1080 });
  await page.goto("/e2e/");
  await page.getByRole("button", { name: "Choose repository" }).click();
  await page.getByLabel("Repository path").fill(info.repo);
  await page
    .getByRole("button", { name: "Open repository", exact: true })
    .click();
  await page.getByRole("button", { name: "Steps", exact: true }).click();
  await page.getByLabel("Recorded learning artifact").selectOption(ids.success);
  const trace = page.getByRole("region", { name: "Step explanation" });
  await expect(trace).toContainText("Simulation · not executed");
  await expect(page.getByLabel("New code version")).toContainText(
    "resources.TrySpend",
  );
  await trace.getByRole("button", { name: "Next", exact: true }).click();
  await trace.getByRole("button", { name: "Step into", exact: true }).click();
  await expect(trace.locator(".trace-stack")).toContainText("TrySpend");
  await expect(page.getByLabel("New code version")).toContainText(
    "resource -= cost",
  );
  await expect(page.locator(".cm-trace-line")).toHaveCount(1);
  await expect(
    page.locator(".cm-recorded-value").filter({ hasText: "= 30" }),
  ).toBeVisible();
  await expect(
    page.locator(".cm-recorded-value").filter({ hasText: "= 20" }),
  ).toBeVisible();
  const phase = await trace.locator(".trace-phase").textContent();
  await trace
    .getByRole("button", { name: "TryDash · Dash.cs:10", exact: true })
    .click();
  await expect(trace.locator(".trace-phase")).toHaveText(phase!);
  await expect(
    page.locator(".cm-recorded-value").filter({ hasText: "resource =" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("New code version")).toContainText(
    "resources.TrySpend",
  );
  await trace
    .getByRole("button", {
      name: "TrySpend · ResourceWallet.cs:8",
      exact: true,
    })
    .click();
  await trace.getByRole("button", { name: "Next", exact: true }).click();
  await expect(trace.locator(".trace-phase")).toContainText("Before line 10");
  await trace.getByRole("button", { name: "Next", exact: true }).click();
  await expect(trace.locator(".trace-phase")).toContainText("Before line 11");
  await expect(
    trace.locator("tr").filter({ hasText: "resource" }),
  ).toContainText("30 → 10");
  await trace.getByRole("button", { name: "Step out", exact: true }).click();
  await expect(trace.locator(".trace-phase")).toContainText("Return line 11");
  await expect(trace).toContainText("Result (bool): true");
  await request.post("/test-learning-change");
  await expect(page.getByLabel("New code version")).toContainText(
    "resources.TrySpend",
  );
  await page.getByRole("button", { name: "Diagram", exact: true }).click();
  await page.getByLabel("Recorded learning artifact").selectOption(ids.diagram);
  await expect(page.locator(".cm-trace-line")).toHaveCount(0);
  await expect(page.locator(".cm-recorded-value")).toHaveCount(0);
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await expect(
    page.getByRole("region", { name: "Dependency diagram" }),
  ).toContainText("Inferred");
  await page
    .getByRole("button", {
      name: "TrySpend · ResourceWallet.cs:6",
      exact: true,
    })
    .click();
  await expect(page.getByLabel("New code version")).toContainText(
    "bool TrySpend",
  );
  // Switching away must safely dispose the bundled in-process layout engine.
  await page.getByRole("button", { name: "Steps", exact: true }).click();
  await page.getByRole("button", { name: "Diagram", exact: true }).click();
  await page.getByLabel("Recorded learning artifact").selectOption(ids.diagram);
  await expect(page.locator(".cm-trace-line")).toHaveCount(0);
  await expect(page.locator(".cm-recorded-value")).toHaveCount(0);
  await expect(page.locator(".react-flow__node")).toHaveCount(3);
  await page.screenshot({
    path: "../../.superpowers/t6-learning-ui.png",
    fullPage: true,
  });
});

for (const language of ["ts", "cs"])
  test(`real semantic adapter ${language}: lens, grouped references, pinned navigation and Back`, async ({
    page,
    request,
  }) => {
    const info = await (await request.get("/test-relations")).json();
    await page.goto("/e2e/");
    await page.getByRole("button", { name: "Choose repository" }).click();
    await page.getByLabel("Repository path").fill(info.repo);
    await page
      .getByRole("button", { name: "Open repository", exact: true })
      .click();
    await page.getByLabel("File list scope").selectOption("all");
    await page
      .getByRole("button", { name: `File Relations.${language}`, exact: true })
      .click();
    const symbol = language === "ts" ? "spend" : "Spend";
    const lens = page.getByRole("button", {
      name: new RegExp(`Relations for ${symbol}:`),
    });
    await expect(lens).toBeVisible({ timeout: 20000 });
    await expect(lens).toContainText("found · partial");
    await page
      .locator(".cm-line")
      .filter({ hasText: "return cost + 1" })
      .click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    const selectedText = await page.evaluate(() =>
      window.getSelection()?.toString(),
    );
    expect(selectedText).toContain("return cost + 1");
    await page
      .getByRole("button", { name: "Explain selection", exact: true })
      .click();
    const selection = await page
      .getByTestId("explanation-target")
      .textContent();
    await page.locator(".revision-details summary").click();
    const sourceSnapshot = await page
      .getByTestId("target-version-id")
      .textContent();
    await page.locator(".revision-details summary").click();
    await lens.click();
    const dialog = page.getByRole("dialog", { name: "Code relations" });
    await expect(dialog).toContainText("Partial");
    const reference = dialog
      .locator(".relation-reference")
      .filter({ hasText: `Usage.${language}` })
      .filter({ hasText: "20" })
      .first();
    await expect(reference).toContainText("20");
    await reference.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel("New code version")).toContainText(
      language === "ts" ? "spend(20)" : "Spend(20)",
    );
    await expect(page.locator(".revision-details summary")).toContainText(
      "Recorded code · no changes",
    );
    await page.locator(".revision-details summary").click();
    await expect(page.getByTestId("base-version-id")).not.toHaveText(
      sourceSnapshot!,
    );
    await page.locator(".revision-details summary").click();
    await page.getByRole("button", { name: "← Back", exact: true }).click();
    await expect(page.getByTestId("explanation-target")).toHaveText(selection!);
    await page.locator(".cm-content").focus();
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString()))
      .toBe(selectedText);
    await page.locator(".revision-details summary").click();
    await expect(page.getByTestId("target-version-id")).toHaveText(
      sourceSnapshot!,
    );
    await page.locator(".revision-details summary").click();
    await page
      .getByRole("button", { name: "File Notes.txt", exact: true })
      .click();
    await expect(page.getByLabel("New code version")).toContainText(
      "unsupported language fixture",
    );
    await page
      .getByRole("button", { name: "Code actions", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Usages and relationships…", exact: true })
      .click();
    await expect(dialog).toContainText("Reference count unknown.");
    await expect(dialog).not.toContainText("0 references");
  });

test("language help is optional, snapshot-bound and keyboard accessible on both diff sides", async ({
  page,
  request,
}) => {
  const info = await (await request.get("/test-info")).json();
  await page.goto("/e2e/");
  await page.getByRole("button", { name: "Choose repository" }).click();
  await page.getByLabel("Repository path").fill(info.repo);
  await page
    .getByRole("button", { name: "Open repository", exact: true })
    .click();
  await page.getByRole("button", { name: "File Code.cs", exact: true }).click();
  await page.getByRole("button", { name: "View options", exact: true }).click();
  await page.getByLabel("Diff view").selectOption("split");
  await page.getByRole("button", { name: "Close View options" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Language construct",
    exact: true,
  });
  await expect(dialog).toHaveCount(0);
  for (const side of ["Old", "New"]) {
    const code = page.getByLabel(`${side} code version`, { exact: true });
    await code.focus();
    await page.keyboard.press("Control+Home");
    await page.keyboard.press("Home");
    for (let i = 0; i < 7; i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Meta+Shift+k");
    await expect(dialog).toContainText("sealed class");
    await expect(dialog).toHaveCSS("background-color", "rgb(40, 40, 40)");
    await expect(dialog).toContainText(`Code.cs · ${side} · Snapshot`);
    await expect(dialog).toContainText("Unknown — language syntax");
    await dialog.getByRole("button", { name: "Example", exact: true }).click();
    await expect(dialog).toContainText("SpecialWallet");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(code).toBeFocused();
  }
  await page.getByLabel("Old code version", { exact: true }).focus();
  await page.getByRole("button", { name: "Code actions", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Explain language construct… ⌘⇧K",
      exact: true,
    })
    .click();
  await expect(dialog).toContainText("Code.cs · Old · Snapshot");
  await expect(dialog).toContainText("sealed class");
  await dialog
    .getByRole("button", { name: "Version and source", exact: true })
    .click();
  await expect(dialog).toContainText("Project language version is unknown");
  await expect(dialog).toContainText("learn.microsoft.com");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 850 });
  await page
    .getByLabel("Old code version", { exact: true })
    .click({ button: "right" });
  await page
    .getByRole("button", {
      name: "Explain language construct… ⌘⇧K",
      exact: true,
    })
    .click();
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "Close Language construct", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
});

test("project memory previews, exports, imports and retains external provenance after reload", async ({
  page,
  request,
}) => {
  test.setTimeout(60000);
  const info = await (await request.get("/test-info")).json();
  expect((await request.post("/test-mcp-seed")).ok()).toBeTruthy();
  const open = async () => {
    await page.goto("/e2e/");
    await page.getByRole("button", { name: "Choose repository" }).click();
    await page.getByLabel("Repository path").fill(info.repo);
    await page
      .getByRole("button", { name: "Open repository", exact: true })
      .click();
    await page.getByRole("button", { name: "View menu", exact: true }).click();
    await page
      .getByRole("button", { name: "Project memory…", exact: true })
      .click();
  };
  await open();
  const memory = page.getByRole("dialog", {
    name: "Project memory",
    exact: true,
  });
  await expect(memory).toContainText("Начальный баланс 75");
  await memory.getByRole("button", { name: "Export", exact: true }).click();
  const record = memory.getByRole("checkbox", {
    name: "Record Начальный баланс 75",
    exact: true,
  });
  await record.last().check();
  await expect(
    memory.getByRole("checkbox", { name: /^Snapshot / }).first(),
  ).not.toBeChecked();
  await memory
    .getByRole("button", { name: "Preview export", exact: true })
    .click();
  await expect(
    memory.getByRole("region", { name: "Export preview" }),
  ).toBeVisible();
  const file = info.repo.replace(/\/repo$/, "/memory-context.zip");
  await memory.getByLabel("Output ZIP path").fill(file);
  await memory.getByRole("button", { name: "Export ZIP", exact: true }).click();
  await expect(memory).toContainText("Exported to");
  await expect(memory).toContainText("/memory-context.zip");
  await memory.getByRole("button", { name: "Import", exact: true }).click();
  await memory.getByLabel("Input ZIP path").fill(file);
  await memory
    .getByRole("button", { name: "Inspect ZIP", exact: true })
    .click();
  await memory.getByRole("checkbox", { name: /Map this bundle/ }).check();
  await memory.getByRole("button", { name: "Import ZIP", exact: true }).click();
  await expect(memory.getByRole("status")).toContainText(
    "snapshots as external context",
  );
  await open();
  await expect(memory).toContainText("External");
  await memory
    .getByRole("button", { name: "Close Project memory", exact: true })
    .click();
  await page.getByRole("button", { name: "File Code.cs", exact: true }).click();
  await expect(page.getByLabel("New code version")).toContainText("75");
});

test("saved explanation opens original code and Git panes resize", async ({
  page,
  request,
}) => {
  test.setTimeout(60000);
  const info = await (await request.get("/test-info")).json();
  expect((await request.post("/test-mcp-seed")).ok()).toBeTruthy();
  await page.goto("/e2e/");
  await page.getByRole("button", { name: "Choose repository" }).click();
  await page.getByLabel("Repository path").fill(info.repo);
  await page
    .getByRole("button", { name: "Open repository", exact: true })
    .click();
  await page.getByRole("button", { name: "Diagram", exact: true }).click();
  await page
    .getByRole("button", { name: "Browse recorded explanations" })
    .click();
  const memory = page.getByRole("dialog", {
    name: "Project memory",
    exact: true,
  });
  await memory
    .locator("summary")
    .filter({ hasText: "Начальный баланс 75" })
    .first()
    .click();
  await memory
    .getByRole("button", { name: /^Open code/ })
    .first()
    .click();
  await expect(memory).not.toBeVisible();
  await expect(page.locator(".cm-content").last()).toContainText("75");
  await expect(
    page.getByRole("complementary", { name: "Explanation" }),
  ).toContainText("Начальный баланс 75");
  await expect(
    page.getByRole("button", { name: /^Current branch / }),
  ).toBeVisible();
  for (const name of ["Branches width", "Commit details width"]) {
    const split = page.getByRole("separator", { name, exact: true });
    const before = await split.getAttribute("aria-valuenow");
    const pane = page.locator(
      name === "Branches width"
        ? ".git-log .branches"
        : ".git-log .commit-details",
    );
    const paneBefore = (await pane.boundingBox())!.width;
    const box = (await split.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 45, box.y + 20);
    await page.mouse.up();
    await expect(split).not.toHaveAttribute("aria-valuenow", before!);
    await expect
      .poll(async () => (await pane.boundingBox())!.width)
      .not.toBe(paneBefore);
  }
  await page.setViewportSize({ width: 600, height: 850 });
  const narrowPane = page.locator(".git-log .commit-details");
  const narrowBefore = (await narrowPane.boundingBox())!.width;
  await page
    .getByRole("separator", { name: "Commit details width", exact: true })
    .focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => (await narrowPane.boundingBox())!.width)
    .not.toBe(narrowBefore);
});

test("recorded navigation reveals an offscreen code block", async ({
  page,
  request,
}) => {
  test.setTimeout(60000);
  const info = await (await request.get("/test-info")).json();
  expect((await request.post("/test-mcp-seed")).ok()).toBeTruthy();
  await page.goto("/e2e/");
  await page.getByRole("button", { name: "Choose repository" }).click();
  await page.getByLabel("Repository path").fill(info.repo);
  await page
    .getByRole("button", { name: "Open repository", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Browse recorded explanations" })
    .click();
  const memory = page.getByRole("dialog", {
    name: "Project memory",
    exact: true,
  });
  await memory
    .locator("summary")
    .filter({ hasText: "Deep recorded block" })
    .first()
    .click();
  await memory
    .getByRole("button", { name: /^Open code/ })
    .first()
    .click();
  await expect(
    page
      .locator(".cm-line")
      .filter({ hasText: /^\/\/ line 1499$/ })
      .last(),
  ).toBeInViewport();
});

test("file list follows open historical code and keeps working changes explicit", async ({
  page,
  request,
}) => {
  test.setTimeout(60000);
  const info = await (await request.get("/test-info")).json();
  await page.goto("/e2e/");
  await page.getByRole("button", { name: "Choose repository" }).click();
  await page.getByLabel("Repository path").fill(info.repo);
  await page
    .getByRole("button", { name: "Open repository", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Commit Initial wallet", exact: true })
    .click();
  const details = page.getByLabel("Commit details", { exact: true });
  await expect(
    details.getByRole("region", { name: "Commit message" }),
  ).toContainText("Initial wallet");
  await details.getByRole("button", { name: "Code.cs", exact: true }).click();
  const files = page.getByLabel("Repository files", { exact: true });
  await expect(page.getByLabel("File list scope")).toHaveValue("comparison");
  await files
    .getByRole("button", { name: "File EarlierDeleted.cs", exact: true })
    .click();
  await expect(page.getByLabel("New code version")).toContainText(
    "class EarlierDeleted",
    { timeout: 15000 },
  );
  await expect(
    files.getByRole("button", { name: "File Readme.md", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Commit Remove old class", exact: true })
    .click();
  await details
    .getByRole("button", { name: "EarlierDeleted.cs", exact: true })
    .click();
  await expect(page.getByText("File deleted", { exact: true })).toBeVisible();
  await expect(
    files.getByRole("button", { name: "File EarlierDeleted.cs", exact: true }),
  ).toBeVisible();
  await page.getByLabel("File list scope").selectOption("working");
  await expect(
    files.getByRole("button", { name: "File EarlierDeleted.cs", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("File deleted", { exact: true })).toBeVisible();
  await page.getByLabel("File list scope").selectOption("comparison");
  await expect(
    files.getByRole("button", { name: "File EarlierDeleted.cs", exact: true }),
  ).toBeVisible();
  const prose = await page
    .locator(".explanation-body")
    .evaluate((el) => getComputedStyle(el).fontFamily);
  const code = await page
    .locator(".cm-content")
    .first()
    .evaluate((el) => getComputedStyle(el).fontFamily);
  expect(prose).not.toBe(code);
  await page.screenshot({
    path: "../../.superpowers/contextual-files.png",
    fullPage: true,
  });
});

test("font shortcuts resize text without page zoom and persist across reload", async ({
  page,
}) => {
  await page.goto("/e2e/");
  const app = page.locator("main.app");
  const size = () => app.evaluate((el) => getComputedStyle(el).fontSize);
  await expect.poll(size).toBe("15px");
  await page.keyboard.press("Control+=");
  await expect.poll(size).toBe("16.5px");
  await page.keyboard.press("Control+-");
  await expect.poll(size).toBe("15px");
  await page.keyboard.press("Meta+-");
  await expect.poll(size).toBe("13.5px");
  await page.reload();
  await expect.poll(size).toBe("13.5px");
  await page.keyboard.press("Control+0");
  await expect.poll(size).toBe("15px");
  await expect(page.locator(".dock-divider").first()).toBeVisible();
});
