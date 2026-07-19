const { test, expect } = require("@playwright/test");

const ADMIN_USER = {
  id: "admin-1",
  name: "Admin One",
  email: "admin@smracing.com",
  role: "OWNER",
  is_active: true,
  created_at: "2026-05-04T12:00:00.000Z",
  updated_at: "2026-05-04T12:00:00.000Z",
  last_login_at: "2026-05-04T12:00:00.000Z",
  last_logout_at: null,
};

const DRIVER_USER = {
  id: "driver-1",
  name: "Alex Driver",
  email: "alex@smracing.com",
  role: "DRIVER",
  is_active: true,
  created_at: "2026-05-04T12:00:00.000Z",
  updated_at: "2026-05-04T12:00:00.000Z",
  last_login_at: "2026-05-04T12:00:00.000Z",
  last_logout_at: null,
};

async function mockAdminAuthRoutes(page) {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();

    if (pathname === "/api/v1/auth/login" && method === "POST") {
      const body = request.postDataJSON();

      if (body?.email === "admin@smracing.com" && body?.password === "123456") {
        return route.fulfill({
          json: {
            access_token: "admin-token",
            token_type: "bearer",
          },
        });
      }

      if (body?.email === "alex@smracing.com" && body?.password === "Alex@123") {
        return route.fulfill({
          json: {
            access_token: "driver-token",
            token_type: "bearer",
          },
        });
      }

      return route.fulfill({
        status: 401,
        json: {
          detail: "Invalid email or password",
        },
      });
    }

    if (pathname === "/api/v1/auth/me" && method === "GET") {
      const authHeader = request.headers().authorization || "";
      const token = authHeader.replace(/^Bearer\s+/i, "");

      if (token === "admin-token") {
        return route.fulfill({
          json: ADMIN_USER,
        });
      }

      if (token === "driver-token") {
        return route.fulfill({
          json: DRIVER_USER,
        });
      }

      return route.fulfill({
        status: 401,
        json: {
          detail: "Unauthorized",
        },
      });
    }

    if (pathname === "/api/v1/auth/logout" && method === "POST") {
      return route.fulfill({
        json: {
          message: "Logged out successfully",
        },
      });
    }

    if (pathname === "/api/v1/users" && method === "GET") {
      return route.fulfill({
        json: {
          users: [],
        },
      });
    }

    if (pathname === "/api/v1/events" && method === "GET") {
      return route.fulfill({
        json: {
          events: [],
        },
      });
    }

    return route.fulfill({
      status: 200,
      json: {},
    });
  });
}

test.describe("admin auth flow", () => {
  test("owner login reaches the admin portal", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("sm2_token");
      localStorage.removeItem("sm2_user");
      localStorage.removeItem("sm2_saved_portal_logins");
    });

    await mockAdminAuthRoutes(page);

    await page.goto("/login");
    await expect(page.getByText("RACE CONTROL")).toBeVisible();
    await expect(page.getByText("Owner and Driver Access")).toBeVisible();

    await page.getByLabel("Email Address").fill("admin@smracing.com");
    await page.getByLabel("Password", { exact: true }).fill("123456");
    await page.getByRole("button", { name: "Login" }).click();

    await page.waitForURL("**/admin/users");
    await expect(page).toHaveURL(/\/admin\/users/);
    await expect(page.getByRole("heading", { name: "User Management" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("sm2_saved_portal_logins"))).toBeNull();
  });

  test("driver login reaches the driver portal", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem("sm2_token");
      localStorage.removeItem("sm2_user");
      localStorage.removeItem("sm2_saved_portal_logins");
    });

    await mockAdminAuthRoutes(page);

    await page.goto("/login");
    await page.getByLabel("Email Address").fill("alex@smracing.com");
    await page.getByLabel("Password", { exact: true }).fill("Alex@123");
    await page.getByRole("button", { name: "Login" }).click();

    await page.waitForURL("**/events");
    await expect(page).toHaveURL(/\/events/);
    await expect(page.getByRole("heading", { name: "Select Your Event" })).toBeVisible();
  });

  test("admin sign out revokes the token and returns to login", async ({ page }) => {
    await page.addInitScript((user) => {
      localStorage.setItem("sm2_token", "admin-token");
      localStorage.setItem("sm2_user", JSON.stringify(user));
    }, ADMIN_USER);

    await mockAdminAuthRoutes(page);

    await page.goto("/admin/signout?next=/login");
    await page.waitForURL("**/login");
    await expect(page).toHaveURL(/\/login/);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("sm2_token"))).toBeNull();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("sm2_user"))).toBeNull();
  });
});
