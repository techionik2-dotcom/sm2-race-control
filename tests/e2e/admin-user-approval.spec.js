const { test, expect } = require("@playwright/test");

const ADMIN_USER = {
  id: "admin-1",
  name: "Admin One",
  email: "admin@smracing.com",
  role: "ADMIN",
  is_active: true,
  approval_status: "APPROVED",
  created_at: "2026-05-04T12:00:00.000Z",
  updated_at: "2026-05-04T12:00:00.000Z",
};

const PENDING_USER = {
  id: "pending-1",
  name: "Pending User",
  email: "pending@smracing.com",
  role: "MECHANIC",
  is_active: false,
  approval_status: "PENDING",
  created_at: "2026-05-04T12:00:00.000Z",
  updated_at: "2026-05-04T12:00:00.000Z",
  last_login_at: null,
  last_logout_at: null,
};

async function mockApprovalRoutes(page) {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();

    if (pathname === "/api/v1/auth/me" && method === "GET") {
      return route.fulfill({
        json: ADMIN_USER,
      });
    }

    if (pathname === "/api/v1/users" && method === "GET") {
      return route.fulfill({
        json: {
          users: [PENDING_USER],
        },
      });
    }

    if (pathname === `/api/v1/users/${PENDING_USER.id}/approve` && method === "PATCH") {
      return route.fulfill({
        json: {
          ...PENDING_USER,
          is_active: true,
          approval_status: "APPROVED",
          updated_at: "2026-05-04T12:05:00.000Z",
        },
      });
    }

    return route.fulfill({
      status: 200,
      json: {},
    });
  });
}

test.describe("admin signup approvals", () => {
  test("admin can approve a pending signup request", async ({ page }) => {
    await page.addInitScript((user) => {
      localStorage.setItem("sm2_token", "admin-token");
      localStorage.setItem("sm2_user", JSON.stringify(user));
    }, ADMIN_USER);

    await mockApprovalRoutes(page);

    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { name: "User Management" })).toBeVisible();
    await expect(page.getByTitle("Pending Approval")).toBeVisible();

    await page.getByRole("button", { name: "Approve Pending User" }).click();

    await expect(page.getByText("User approved")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve Pending User" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Change password for Pending User" })).toBeVisible();
  });
});
