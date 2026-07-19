const { test, expect } = require("@playwright/test");

async function mockSignupRoute(page) {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();

    if (pathname === "/api/v1/auth/register" && method === "POST") {
      return route.fulfill({
        json: {
          id: "pending-1",
          name: "Alex Pending",
          email: "alex@smracing.com",
          role: "MECHANIC",
          is_active: false,
          approval_status: "PENDING",
          created_at: "2026-05-04T12:00:00.000Z",
          updated_at: "2026-05-04T12:00:00.000Z",
          last_login_at: null,
          last_logout_at: null,
        },
      });
    }

    return route.fulfill({
      status: 200,
      json: {},
    });
  });
}

test.describe("signup approval request", () => {
  test("signup submits a pending request and lands on the approval notice", async ({ page }) => {
    await mockSignupRoute(page);

    await page.goto("/signup");
    await page.getByLabel("First Name").fill("Alex");
    await page.getByLabel("Last Name").fill("Pending");
    await page.getByLabel("Email Address").fill("alex@smracing.com");
    await page.getByLabel("Password", { exact: true }).fill("Password123");
    await page.getByLabel("Confirm Password").fill("Password123");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Request Access" }).click();

    await page.waitForURL("**/login?signup=pending");
    await expect(page.getByRole("heading", { name: "Request submitted" })).toBeVisible();
    await expect(
      page.getByText("Your account request has been sent to an admin for approval."),
    ).toBeVisible();
  });
});
