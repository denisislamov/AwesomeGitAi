import { test, expect } from "@playwright/test";
test("real host: code, old side, history selection, stale state and keyboard explanation", async ({
  page,
  request,
}) => {
  const info = await (await request.get("/test-info")).json();
  await page.goto("/e2e/");
  await page.getByLabel("Repository path").fill(info.repo);
  await page
    .getByRole("button", { name: "Open repository", exact: true })
    .click();
  await page.getByRole("button", { name: "File Code.cs", exact: true }).click();
  await expect(page.locator(".cm-content").last()).toContainText("50");
  await page.getByLabel("Diff view").selectOption("split");
  await expect(page.locator(".cm-mergeView")).toBeVisible();
  await expect(page.locator(".cm-content").first()).toContainText("30");
  await page
    .getByRole("button", { name: "Explain selection", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Explanation" }),
  ).toContainText("No explanation yet");
  const target = await page.getByTestId("explanation-target").textContent();
  await page.getByLabel("Explanation placement").selectOption("popover");
  await expect(page.getByTestId("explanation-target")).toHaveText(target!);
  await page.getByRole("button", { name: "Commit Initial wallet" }).click();
  await expect(page.getByLabel("Commit details")).toContainText("UI Test");
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
  await page.getByLabel("Repository path").fill(info.repo);
  await page
    .getByRole("button", { name: "Open repository", exact: true })
    .click();
  await page.getByRole("button", { name: "All files", exact: true }).click();
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
  await page.getByLabel("Repository path").fill(info.repo);
  await page
    .getByRole("button", { name: "Open repository", exact: true })
    .click();
  await page.getByRole("button", { name: "File Code.cs", exact: true }).click();
  const working = await page.locator(".cm-content").textContent();
  const ids = await page.locator(".snapshot-status span").allTextContents();
  await page.getByRole("button", { name: "Commit Initial wallet" }).click();
  await page
    .getByLabel("Commit details")
    .getByRole("button", { name: "Code.cs", exact: true })
    .click();
  await expect(page.locator(".cm-content")).toContainText("Balance = 30");
  await expect(page.locator(".breadcrumbs")).toContainText("Empty tree");
  await page.getByRole("tab", { name: /Code.cs Worktree/ }).click();
  await expect(page.locator(".cm-content")).toHaveText(working!);
  await page.getByRole("button", { name: "Snapshots", exact: true }).click();
  await page.getByLabel("Base snapshot ID").fill(ids[0].slice(2));
  await page.getByLabel("Target snapshot ID").fill(ids[1].slice(2));
  await page.getByRole("button", { name: "Compare snapshots" }).click();
  await expect(page.locator(".breadcrumbs")).toContainText("Snapshot");
  await expect(page.locator(".cm-content")).toHaveText(working!);
});

test("chosen base lists files deleted before the target parent", async ({
  page,
  request,
}) => {
  const info = await (await request.get("/test-info")).json();
  await page.goto("/e2e/");
  await page.getByLabel("Repository path").fill(info.repo);
  await page
    .getByRole("button", { name: "Open repository", exact: true })
    .click();
  await page.getByRole("button", { name: "Commit Initial wallet" }).click();
  await page.getByRole("button", { name: "Use as comparison base" }).click();
  await page.getByRole("button", { name: "Commit Document wallet" }).click();
  await page
    .getByLabel("Commit details")
    .getByRole("button", { name: "EarlierDeleted.cs", exact: true })
    .click();
  await expect(page.getByText("File deleted", { exact: true })).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText(
    "class EarlierDeleted {}",
  );
  await expect(page.locator(".breadcrumbs")).toContainText(
    info.first.slice(0, 8),
  );
});

test("real MCP explanations appear at code and human acceptance stays on the original pair", async ({
  page,
  request,
}) => {
  const info = await (await request.get("/test-info")).json();
  const seeded = await request.post("/test-mcp-seed");
  expect(seeded.ok()).toBeTruthy();
  await page.goto("/e2e/");
  await page.getByLabel("Repository path").fill(info.repo);
  await page
    .getByRole("button", { name: "Open repository", exact: true })
    .click();
  await page.getByRole("button", { name: "File Code.cs", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Начальный баланс 75", exact: true }),
  ).toBeVisible();
  await page.getByTitle(/Начальный баланс 75/).click();
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
  ).toHaveCount(0);
});

test("partial staging preview, commit, and real drag docking", async ({
  page,
  request,
}) => {
  const info = await (await request.get("/test-operations")).json();
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.goto("/e2e/");
  await page.getByLabel("Repository path").fill(info.repo);
  await page
    .getByRole("button", { name: "Open repository", exact: true })
    .click();
  await page
    .getByRole("button", { name: "File Selected.cs", exact: true })
    .click();
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
  await page
    .getByText("Git actions · staging, branches, sync", { exact: true })
    .click();
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
  await page.getByLabel("Repository path").fill(info.repo);
  await page
    .getByRole("button", { name: "Open repository", exact: true })
    .click();
  await page.getByRole("button", { name: "Steps", exact: true }).click();
  await page.getByLabel("Recorded learning artifact").selectOption(ids.success);
  const trace = page.getByRole("region", { name: "Step explanation" });
  await expect(trace).toContainText("not observed execution");
  await expect(page.getByLabel("New code version")).toContainText(
    "resources.TrySpend",
  );
  await trace.getByRole("button", { name: "Next", exact: true }).click();
  await trace.getByRole("button", { name: "Step into", exact: true }).click();
  await expect(trace.locator(".trace-stack")).toContainText("TrySpend");
  await expect(page.getByLabel("New code version")).toContainText(
    "resource -= cost",
  );
  const phase = await trace.locator(".trace-phase").textContent();
  await trace
    .getByRole("button", { name: "TryDash · Dash.cs:10", exact: true })
    .click();
  await expect(trace.locator(".trace-phase")).toHaveText(phase!);
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
  await page.screenshot({
    path: "../../.superpowers/t6-learning-ui.png",
    fullPage: true,
  });
});
