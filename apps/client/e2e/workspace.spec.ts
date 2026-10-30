import { test, expect } from "@playwright/test";
test("real host: code, old side, history selection, stale state and keyboard explanation", async ({
  page,
  request,
}) => {
  const info = await (await request.get("/test-info")).json();
  await page.goto("/e2e/");
  await page.getByLabel("Путь к репозиторию").fill(info.repo);
  await page
    .getByRole("button", { name: "Открыть репозиторий", exact: true })
    .click();
  await page.getByRole("button", { name: "Файл Code.cs", exact: true }).click();
  await expect(page.locator(".cm-content").last()).toContainText("50");
  await page.getByLabel("Вид сравнения").selectOption("split");
  await expect(page.locator(".cm-mergeView")).toBeVisible();
  await expect(page.locator(".cm-content").first()).toContainText("30");
  await page
    .getByRole("button", { name: "Объяснить выделение", exact: true })
    .click();
  await expect(
    page.getByRole("complementary", { name: "Объяснение" }),
  ).toContainText("Пока нет объяснения");
  const target = await page.getByTestId("explanation-target").textContent();
  await page.getByLabel("Размещение объяснения").selectOption("popover");
  await expect(page.getByTestId("explanation-target")).toHaveText(target!);
  await page.getByRole("button", { name: "Коммит Initial wallet" }).click();
  await expect(page.getByLabel("Сведения о коммите")).toContainText("UI Test");
  await expect(page.locator(".cm-content").last()).toContainText("50");
  await page
    .getByRole("button", { name: "Ветка feature", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Коммит Document wallet" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Файл Deleted.cs", exact: true })
    .click();
  await expect(page.getByText("Файл удалён", { exact: true })).toBeVisible();
  await expect(page.locator(".cm-content").first()).toContainText("Removed");
  await page.getByRole("button", { name: "Файл Code.cs", exact: true }).click();
  await request.post("/test-change");
  await expect(
    page.getByRole("button", { name: "Обновить снимок" }),
  ).toBeVisible({ timeout: 10000 });
  await expect(page.locator(".cm-content").last()).toContainText("50");
  await page.getByRole("button", { name: "Обновить снимок" }).click();
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
    await page.getByLabel("Путь к репозиторию").fill(info.repo);
    await page
      .getByRole("button", { name: "Открыть репозиторий", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Файл Code.cs", exact: true })
      .click();
    await expect(page.getByRole("region", { name: "Git Log" })).toBeVisible();
    await expect(page.locator(".cm-content").last()).toHaveAttribute(
      "contenteditable",
      "false",
    );
    await page
      .getByRole("button", { name: "Объяснить выделение", exact: true })
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
  await page.getByLabel("Путь к репозиторию").fill(info.repo);
  await page
    .getByRole("button", { name: "Открыть репозиторий", exact: true })
    .click();
  await page.getByRole("button", { name: "Все файлы", exact: true }).click();
  await page
    .getByRole("button", { name: "Файл Large.cs", exact: true })
    .click();
  await expect(page.locator(".cm-content")).toContainText("line 0");
  await page.locator(".cm-scroller").evaluate((el) => {
    el.scrollTop = 700;
  });
  await page.waitForTimeout(100);
  await page.getByRole("button", { name: "Файл Code.cs", exact: true }).click();
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
    await page.getByLabel("Путь к репозиторию").fill(info.bench);
    const begin = Date.now();
    await page
      .getByRole("button", { name: "Открыть репозиторий", exact: true })
      .click();
    await expect(page.locator(".commit-row").first()).toBeVisible();
    startup.push(Date.now() - begin);
    const refresh = Date.now();
    await page
      .getByRole("button", { name: "Обновить историю", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Обновить историю", exact: true }),
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
  await page.getByLabel("Путь к репозиторию").fill(info.repo);
  await page
    .getByRole("button", { name: "Открыть репозиторий", exact: true })
    .click();
  await page.getByRole("button", { name: "Файл Code.cs", exact: true }).click();
  const working = await page.locator(".cm-content").textContent();
  const ids = await page.locator(".snapshot-status span").allTextContents();
  await page.getByRole("button", { name: "Коммит Initial wallet" }).click();
  await page
    .getByLabel("Сведения о коммите")
    .getByRole("button", { name: "Code.cs", exact: true })
    .click();
  await expect(page.locator(".cm-content")).toContainText("Balance = 30");
  await expect(page.locator(".breadcrumbs")).toContainText("Пустое дерево");
  await page.getByRole("tab", { name: /Code.cs Рабочая копия/ }).click();
  await expect(page.locator(".cm-content")).toHaveText(working!);
  await page.getByRole("button", { name: "Снимки", exact: true }).click();
  await page.getByLabel("Базовый snapshot ID").fill(ids[0].slice(2));
  await page.getByLabel("Целевой snapshot ID").fill(ids[1].slice(2));
  await page.getByRole("button", { name: "Сравнить снимки" }).click();
  await expect(page.locator(".breadcrumbs")).toContainText("Снимок");
  await expect(page.locator(".cm-content")).toHaveText(working!);
});

test("chosen base lists files deleted before the target parent", async ({
  page,
  request,
}) => {
  const info = await (await request.get("/test-info")).json();
  await page.goto("/e2e/");
  await page.getByLabel("Путь к репозиторию").fill(info.repo);
  await page
    .getByRole("button", { name: "Открыть репозиторий", exact: true })
    .click();
  await page.getByRole("button", { name: "Коммит Initial wallet" }).click();
  await page.getByRole("button", { name: "Взять за базу сравнения" }).click();
  await page.getByRole("button", { name: "Коммит Document wallet" }).click();
  await page
    .getByLabel("Сведения о коммите")
    .getByRole("button", { name: "EarlierDeleted.cs", exact: true })
    .click();
  await expect(page.getByText("Файл удалён", { exact: true })).toBeVisible();
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
  await page.getByLabel("Путь к репозиторию").fill(info.repo);
  await page
    .getByRole("button", { name: "Открыть репозиторий", exact: true })
    .click();
  await page.getByRole("button", { name: "Файл Code.cs", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Начальный баланс 75", exact: true }),
  ).toBeVisible();
  await page.getByTitle(/Начальный баланс 75/).click();
  await expect(page.getByTestId("explanation-target")).toContainText(
    "строки 2–2",
  );
  await expect(
    page.getByRole("button", { name: "Принято", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Открыть исходную версию", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Принято", exact: true }),
  ).toBeVisible();
  await page.getByText("Подробности и проверки", { exact: true }).click();
  await expect(
    page.getByText("Агент не сообщил альтернативы.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Проверены байты тестового файла, не выполнение C#.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Принято", exact: true }).click();
  await expect(
    page.getByText("Ваша отметка: Принято", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Файл Code.cs", exact: true }).click();
  await expect(
    page.getByText("Ваша отметка: Принято", { exact: true }),
  ).toHaveCount(0);
});

test("partial staging preview, commit, and real drag docking", async ({
  page,
  request,
}) => {
  const info = await (await request.get("/test-operations")).json();
  await page.setViewportSize({ width: 1600, height: 1050 });
  await page.goto("/e2e/");
  await page.getByLabel("Путь к репозиторию").fill(info.repo);
  await page
    .getByRole("button", { name: "Открыть репозиторий", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Файл Selected.cs", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Блок под курсором → Index…", exact: true })
    .click();
  const preview = page.getByRole("dialog", { name: "Предпросмотр Index" });
  await expect(preview).toBeVisible();
  await expect(preview.locator("pre").last()).toContainText("new");
  await expect(preview.locator("pre").last()).not.toContainText("extra");
  await page
    .getByRole("button", { name: "Применить к Index", exact: true })
    .click();
  await expect(page.locator(".git-job")).toContainText("Git: готово", {
    timeout: 15000,
  });
  const result = await (await request.get("/test-operations-state")).json();
  expect(result.index).toBe("new\n" + "keep\n".repeat(12));
  expect(result.worktree).toContain("extra");
  await page
    .getByText("Git-операции · staging, ветки, синхронизация", { exact: true })
    .click();
  await page.getByLabel("Сообщение коммита").fill("UI partial commit");
  await page
    .getByRole("button", { name: "Создать коммит", exact: true })
    .click();
  await expect(page.locator(".git-job")).toContainText("Git: готово", {
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
  await title.dragTo(target, { targetPosition: { x: targetBox.width - 8, y: 120 } });
  const filesBox = await page.locator(".dock-panel-files").boundingBox();
  const codeBox = await target.boundingBox();
  expect(filesBox).not.toBeNull();
  expect(codeBox).not.toBeNull();
  expect(filesBox!.x).toBeGreaterThan(codeBox!.x);
  expect(await page.evaluate(()=>localStorage.getItem("agai-layout-v1"))).not.toBe(before);
  await page.screenshot({
    path: "../../.superpowers/t5-git-ui.png",
    fullPage: true,
  });
});
