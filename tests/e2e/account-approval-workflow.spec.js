const { test, expect } = require("@playwright/test");

const OWNER_USER = {
  id: "owner-1",
  name: "Owner One",
  email: "admin@smracing.com",
  role: "OWNER",
  is_active: true,
  approval_status: "APPROVED",
  created_at: "2026-05-04T12:00:00.000Z",
  updated_at: "2026-05-04T12:00:00.000Z",
  last_login_at: "2026-05-04T12:00:00.000Z",
  last_logout_at: null,
};

async function mockApprovalWorkflowRoutes(page, state) {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();

    if (pathname === "/api/v1/auth/register" && method === "POST") {
      const body = request.postDataJSON();
      const email = String(body?.email || "").toLowerCase();
      const existingUser = state.users.find((user) => user.email === email);

      if (existingUser) {
        return route.fulfill({
          status: 409,
          json: {
            detail:
              existingUser.approval_status === "PENDING"
                ? "An account for this email is already waiting for owner approval."
                : "An account for this email already exists. Please sign in.",
          },
        });
      }

      const user = {
        id: "pending-1",
        name: body.name,
        email,
        role: "DRIVER",
        is_active: false,
        approval_status: "PENDING",
        created_at: "2026-05-04T12:10:00.000Z",
        updated_at: "2026-05-04T12:10:00.000Z",
        last_login_at: null,
        last_logout_at: null,
        approved_at: null,
        approved_by_id: null,
        rejected_at: null,
        rejected_by_id: null,
      };

      state.users.push(user);
      return route.fulfill({ status: 201, json: user });
    }

    if (pathname === "/api/v1/auth/login" && method === "POST") {
      const body = request.postDataJSON();
      const email = String(body?.email || "").toLowerCase();

      if (email === OWNER_USER.email && body?.password === "123456") {
        return route.fulfill({
          json: {
            access_token: "owner-token",
            token_type: "bearer",
          },
        });
      }

      const user = state.users.find((candidate) => candidate.email === email);
      if (user && body?.password === "Password123") {
        if (user.approval_status === "PENDING") {
          return route.fulfill({
            status: 403,
            json: {
              detail:
                "Your account is waiting for owner approval. You will be able to sign in once it has been approved.",
            },
          });
        }

        if (user.approval_status === "APPROVED" && user.is_active) {
          return route.fulfill({
            json: {
              access_token: "approved-user-token",
              token_type: "bearer",
            },
          });
        }
      }

      return route.fulfill({
        status: 401,
        json: { detail: "Invalid email or password" },
      });
    }

    if (pathname === "/api/v1/auth/me" && method === "GET") {
      const authHeader = request.headers().authorization || "";
      const token = authHeader.replace(/^Bearer\s+/i, "");

      if (token === "owner-token") {
        return route.fulfill({ json: OWNER_USER });
      }

      if (token === "approved-user-token") {
        const user = state.users.find((candidate) => candidate.email === "pending@smracing.com");
        if (user?.approval_status === "APPROVED" && user.is_active) {
          return route.fulfill({ json: user });
        }
      }

      return route.fulfill({
        status: 401,
        json: { detail: "Unauthorized" },
      });
    }

    if (pathname === "/api/v1/auth/logout" && method === "POST") {
      return route.fulfill({ json: { message: "Logged out successfully" } });
    }

    if (pathname === "/api/v1/users" && method === "GET") {
      return route.fulfill({ json: state.users });
    }

    const approvalMatch = pathname.match(/^\/api\/v1\/users\/([^/]+)\/approve$/);
    if (approvalMatch && method === "PATCH") {
      const targetUser = state.users.find((user) => user.id === approvalMatch[1]);

      if (!targetUser) {
        return route.fulfill({
          status: 404,
          json: { detail: "User not found" },
        });
      }

      Object.assign(targetUser, {
        is_active: true,
        approval_status: "APPROVED",
        approved_at: "2026-05-04T12:20:00.000Z",
        approved_by_id: OWNER_USER.id,
        updated_at: "2026-05-04T12:20:00.000Z",
      });

      return route.fulfill({ json: targetUser });
    }

    if (pathname === "/api/v1/events" && method === "GET") {
      return route.fulfill({ json: [] });
    }

    return route.fulfill({ status: 200, json: {} });
  });
}

test.describe("owner approval workflow", () => {
  test("new account stays pending until owner approval, then can log in", async ({ page }) => {
    const state = { users: [] };
    await mockApprovalWorkflowRoutes(page, state);

    await page.goto("/signup");
    await page.getByLabel("First Name").fill("Pending");
    await page.getByLabel("Last Name").fill("Driver");
    await page.getByLabel("Email Address").fill("pending@smracing.com");
    await page.getByLabel("Password", { exact: true }).fill("Password123");
    await page.getByLabel("Confirm Password").fill("Password123");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Request Access" }).click();

    await page.waitForURL("**/registration-pending");
    await expect(page.getByText("Pending Approval")).toBeVisible();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("sm2_token"))).toBeNull();
    expect(state.users.filter((user) => user.email === "pending@smracing.com")).toHaveLength(1);
    expect(state.users[0].approval_status).toBe("PENDING");

    await page.goto("/login");
    await page.getByLabel("Email Address").fill("pending@smracing.com");
    await page.locator("#login-password").fill("Password123");
    await page.getByRole("button", { name: "Login" }).click();

    await expect(
      page.getByText("Your account is waiting for owner approval."),
    ).toBeVisible();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("sm2_token"))).toBeNull();

    await page.getByLabel("Email Address").fill("admin@smracing.com");
    await page.locator("#login-password").fill("123456");
    await page.getByRole("button", { name: "Login" }).click();

    await page.waitForURL("**/admin/users");
    await expect(page.getByRole("heading", { name: "User Management" })).toBeVisible();
    await expect(page.getByText("pending@smracing.com")).toBeVisible();
    await expect(page.getByTitle("Pending Approval")).toBeVisible();

    await page.getByRole("button", { name: "Approve Pending Driver" }).click();

    await expect(page.getByText("Account approved successfully. The user can now sign in.")).toBeVisible();
    expect(state.users[0].approval_status).toBe("APPROVED");
    expect(state.users[0].approved_by_id).toBe(OWNER_USER.id);

    await page.goto("/admin/signout?next=/login");
    await page.getByRole("button", { name: "Return to Login" }).click();
    await page.waitForURL("**/login");
    await page.getByLabel("Email Address").fill("pending@smracing.com");
    await page.locator("#login-password").fill("Password123");
    await page.getByRole("button", { name: "Login" }).click();

    await page.waitForURL("**/events");
    await expect(page.getByRole("heading", { name: "Select Your Event" })).toBeVisible();
    expect(state.users.filter((user) => user.email === "pending@smracing.com")).toHaveLength(1);
  });
});
