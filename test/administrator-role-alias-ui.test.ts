/**
 * BROWSER-LEVEL regression test for the administrator role alias.
 *
 * The application accepts both "admin" and "administrator". Most coverage
 * uses the shorter value, so a shared route or navigation check could
 * accidentally deny users stored with the longer valid spelling. This suite
 * drives the real SPA in Chromium and checks every route guarded by the
 * admin-only route helper.
 *
 * Run with: npx tsx test/administrator-role-alias-ui.test.ts
 *
 * NOTES:
 * - DB-backed: seeds dedicated administrator and therapist users and removes
 *   them in a finally block.
 * - Must run serially with the other app-level tests because browser suites
 *   share the development database.
 */

import type { Browser, Page } from "puppeteer";
import {
  startDevServer,
  launchBrowser,
  loginAs,
  clickButtonByText,
  type DevServer,
} from "./helpers/browser";
import { db } from "../server/db";
import { storage } from "../server/storage";
import { users } from "../shared/schema";
import { inArray } from "drizzle-orm";

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`✅ PASS: ${message}`);
    testsPassed++;
  } else {
    console.error(`❌ FAIL: ${message}`);
    testsFailed++;
  }
}

function assertEqual(actual: unknown, expected: unknown, message: string) {
  assert(
    actual === expected,
    `${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
  );
}

const SUFFIX = `administrator-role-alias-${Date.now()}`;

const ADMIN_ONLY_PAGES = [
  {
    path: "/role-management",
    heading: "Role Management",
    navigationLabel: "Role Management",
    message: "Role management is restricted to administrators only.",
  },
  {
    path: "/duplicate-detection",
    heading: "Duplicate Detection",
    navigationLabel: "Duplicate Detection",
    message: "Duplicate detection is restricted to administrators only.",
  },
  {
    path: "/settings",
    heading: "System Settings",
    navigationLabel: "Settings",
    message: "Settings management is restricted to administrators only.",
  },
  {
    path: "/hipaa-audit",
    heading: "HIPAA Audit Trail",
    navigationLabel: "HIPAA Audit",
    message: "HIPAA audit logs are restricted to administrators only.",
  },
  {
    path: "/admin-consent",
    heading: "Patient Consent Management",
    navigationLabel: "Privacy & Consent",
    message: "Privacy & consent management is restricted to administrators only.",
  },
  {
    path: "/unresolved-recordings",
    heading: "Unresolved Recording Attempts",
    navigationLabel: "Unresolved Recordings",
    message: "Unresolved recording reports are restricted to administrators only.",
  },
] as const;

async function bodyText(page: Page): Promise<string> {
  return page.$eval("body", (element) => element.innerText);
}

async function waitForPageHeading(page: Page, heading: string): Promise<void> {
  await page.waitForFunction(
    (expectedHeading: string) =>
      Array.from(document.querySelectorAll("h1")).some(
        (element) => (element.textContent || "").trim().includes(expectedHeading),
      ),
    { timeout: 30_000 },
    heading,
  );
}

async function closeBrowser(browser: Browser): Promise<void> {
  const browserProcess = browser.process();
  await Promise.race([
    browser.close().catch(() => {}),
    new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
  ]);
  if (browserProcess && browserProcess.exitCode === null) {
    browserProcess.kill("SIGKILL");
  }
}

async function main() {
  let devServer: DevServer | null = null;
  let browser: Browser | null = null;
  const createdUserIds: number[] = [];

  try {
    const administrator = await storage.createUser({
      username: `administrator-${SUFFIX}`,
      password: "x",
      fullName: `Administrator Alias ${SUFFIX}`,
      email: `administrator-${SUFFIX}@example.test`,
      role: "administrator",
    } as any);
    createdUserIds.push(administrator.id);

    const therapist = await storage.createUser({
      username: `therapist-${SUFFIX}`,
      password: "x",
      fullName: `Therapist Alias ${SUFFIX}`,
      email: `therapist-${SUFFIX}@example.test`,
      role: "therapist",
    } as any);
    createdUserIds.push(therapist.id);

    devServer = await startDevServer();
    browser = await launchBrowser();
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(60_000);

    await page.goto(devServer.baseUrl, { waitUntil: "domcontentloaded" });
    const administratorLoginStatus = await loginAs(page, {
      username: administrator.username,
      password: "x",
    });
    assertEqual(
      administratorLoginStatus,
      200,
      "Administrator alias user logs in via /api/auth/login",
    );

    await page.goto(devServer.baseUrl, { waitUntil: "domcontentloaded" });
    await clickButtonByText(page, /^Administration$/);
    const navigationText = await bodyText(page);
    assert(
      ADMIN_ONLY_PAGES.every(({ navigationLabel }) =>
        navigationText.includes(navigationLabel),
      ),
      "Administrator alias sees the Administration navigation",
    );

    for (const protectedPage of ADMIN_ONLY_PAGES) {
      await page.goto(`${devServer.baseUrl}${protectedPage.path}`, {
        waitUntil: "domcontentloaded",
      });
      await waitForPageHeading(page, protectedPage.heading);
      const text = await bodyText(page);
      assert(
        text.includes(protectedPage.heading) && !text.includes("Access Restricted"),
        `Administrator alias can open ${protectedPage.path}`,
      );
    }

    await page.goto(devServer.baseUrl, { waitUntil: "domcontentloaded" });
    const therapistLoginStatus = await loginAs(page, {
      username: therapist.username,
      password: "x",
    });
    assertEqual(
      therapistLoginStatus,
      200,
      "Therapist user logs in via /api/auth/login",
    );

    await page.goto(devServer.baseUrl, { waitUntil: "domcontentloaded" });
    const therapistNavigationText = await bodyText(page);
    assert(
      !therapistNavigationText.includes("Administration"),
      "Therapist does not see the Administration navigation",
    );

    for (const protectedPage of ADMIN_ONLY_PAGES) {
      await page.goto(`${devServer.baseUrl}${protectedPage.path}`, {
        waitUntil: "domcontentloaded",
      });
      await page.waitForFunction(
        (message: string) => document.body.innerText.includes(message),
        { timeout: 30_000 },
        protectedPage.message,
      );
      const text = await bodyText(page);
      assert(
        text.includes("Access Restricted") &&
          text.includes(protectedPage.message) &&
          !text.includes(protectedPage.heading),
        `Therapist remains restricted from ${protectedPage.path}`,
      );
    }
  } catch (error) {
    console.error("\n❌ Test suite error:", error);
    testsFailed++;
  } finally {
    if (browser) await closeBrowser(browser);
    if (devServer) await devServer.stop();

    if (createdUserIds.length > 0) {
      try {
        await db.delete(users).where(inArray(users.id, createdUserIds));
      } catch (cleanupError) {
        console.error("⚠️ Cleanup error:", cleanupError);
        testsFailed++;
      }
    }
  }

  console.log(`\n${testsPassed} passed, ${testsFailed} failed`);
  if (testsFailed > 0) process.exit(1);
  process.exit(0);
}

main().catch((error) => {
  console.error("Fatal test error:", error);
  process.exit(1);
});
