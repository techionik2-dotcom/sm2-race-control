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

const TRACK_NAME = "Legacy Ridge Motorsports Park";

const makeIso = (offsetMinutes = 0) =>
  new Date(Date.now() + offsetMinutes * 60_000).toISOString();

const seedTrack = (body) => {
  const isActive = body.is_active ?? body.active ?? true;
  const now = makeIso();

  return {
    name: body.name,
    display_name: body.display_name || body.name,
    short_code: body.short_code,
    country: body.country,
    latitude: body.latitude ?? null,
    longitude: body.longitude ?? null,
    notes: body.notes ?? null,
    active: isActive,
    is_active: isActive,
    archived_at: isActive ? null : now,
    created_at: now,
    updated_at: now,
  };
};

const findTrackIndex = (tracks, name) =>
  tracks.findIndex((track) => String(track.name).toLowerCase() === String(name).toLowerCase());

async function mockTrackBackend(page) {
  const tracks = [];

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const { pathname, searchParams } = new URL(request.url());
    const method = request.method();

    if (pathname === "/api/v1/auth/me" && method === "GET") {
      return route.fulfill({
        json: ADMIN_USER,
      });
    }

    if (pathname === "/api/v1/admin/chatbot/context" && method === "GET") {
      return route.fulfill({
        json: {
          events: [],
          sessions: [],
          drivers: [],
          vehicles: [],
          default_event_id: null,
        },
      });
    }

    if (pathname === "/api/v1/admin/chatbot/query" && method === "POST") {
      return route.fulfill({
        json: {
          answer: "Chatbot disabled for track persistence smoke test.",
          response: {
            summary: "Chatbot disabled for track persistence smoke test.",
          },
        },
      });
    }

    if (pathname === "/api/v1/tracks" && method === "GET") {
      const includeArchived = searchParams.get("include_archived") === "true";
      const payload = includeArchived ? tracks : tracks.filter((track) => track.is_active !== false);

      return route.fulfill({
        json: {
          tracks: payload,
        },
      });
    }

    if (pathname === "/api/v1/tracks" && method === "POST") {
      const body = request.postDataJSON();
      const record = seedTrack(body);

      tracks.unshift(record);

      return route.fulfill({
        status: 201,
        json: record,
      });
    }

    if (pathname.startsWith("/api/v1/tracks/") && method === "PUT") {
      const trackName = decodeURIComponent(pathname.replace("/api/v1/tracks/", ""));
      const index = findTrackIndex(tracks, trackName);

      if (index < 0) {
        return route.fulfill({
          status: 404,
          json: {
            detail: "Track not found",
          },
        });
      }

      const body = request.postDataJSON();
      const current = tracks[index];
      const nextActive =
        typeof body.is_active === "boolean"
          ? body.is_active
          : typeof body.active === "boolean"
            ? body.active
            : current.is_active;
      const updatedAt = makeIso(1);

      tracks[index] = {
        ...current,
        name: body.name || current.name,
        display_name: body.display_name || current.display_name || body.name || current.name,
        short_code: body.short_code || current.short_code,
        country: body.country || current.country,
        latitude: body.latitude ?? current.latitude,
        longitude: body.longitude ?? current.longitude,
        notes: body.notes === undefined ? current.notes : body.notes || null,
        active: nextActive,
        is_active: nextActive,
        archived_at: nextActive ? null : current.archived_at || updatedAt,
        updated_at: updatedAt,
      };

      return route.fulfill({
        json: tracks[index],
      });
    }

    if (pathname.startsWith("/api/v1/tracks/") && method === "DELETE") {
      const trackName = decodeURIComponent(pathname.replace("/api/v1/tracks/", ""));
      const index = findTrackIndex(tracks, trackName);

      if (index < 0) {
        return route.fulfill({
          status: 404,
          json: {
            detail: "Track not found",
          },
        });
      }

      tracks[index] = {
        ...tracks[index],
        active: false,
        is_active: false,
        archived_at: tracks[index].archived_at || makeIso(1),
        updated_at: makeIso(1),
      };

      return route.fulfill({
        json: tracks[index],
      });
    }

    return route.fulfill({
      status: 200,
      json: {},
    });
  });

  return tracks;
}

test.describe("admin track persistence", () => {
  test("tracks survive refresh and archive / restore through the backend contract", async ({ page }) => {
    await page.addInitScript((user) => {
      localStorage.clear();
      localStorage.setItem("sm2_token", "admin-token");
      localStorage.setItem("sm2_user", JSON.stringify(user));
    }, ADMIN_USER);

    const tracks = await mockTrackBackend(page);
    await page.addStyleTag({
      content: ".chatbot-launcher { display: none !important; }",
    });

    await page.goto("/admin/tracks");
    await expect(page.getByRole("heading", { name: "Track Management" })).toBeVisible();
    await expect(page.getByText("No tracks yet")).toBeVisible();

    const apiRequest = async (method, path, body = null) =>
      page.evaluate(
        async ({ method: requestMethod, path: requestPath, body: requestBody }) => {
          const response = await fetch(`/api/v1${requestPath}`, {
            method: requestMethod,
            headers: {
              Authorization: "Bearer admin-token",
              "Content-Type": "application/json",
            },
            body: requestBody ? JSON.stringify(requestBody) : undefined,
          });

          const contentType = response.headers.get("content-type") || "";
          const data = contentType.includes("application/json") ? await response.json() : null;

          return {
            status: response.status,
            data,
          };
        },
        { method, path, body },
      );

    await apiRequest("POST", "/tracks", {
      name: TRACK_NAME,
      display_name: "Legacy Ridge",
      short_code: "LRP",
      country: "United States",
      latitude: 27.451,
      longitude: -81.351,
      notes: "Created during backend CRUD smoke test",
      is_active: true,
    });

    await expect.poll(() => tracks.length).toBe(1);
    await page.reload();
    const createdRow = page.locator(".fleet-table-row").filter({ hasText: TRACK_NAME }).first();
    await expect(createdRow).toBeVisible();
    await expect(createdRow).toContainText("Legacy Ridge");

    await page.reload();
    await expect(createdRow).toBeVisible();

    await apiRequest("PUT", `/tracks/${encodeURIComponent(TRACK_NAME)}`, {
      display_name: "Legacy Ridge Updated",
    });

    await page.reload();
    await expect(createdRow).toContainText("Legacy Ridge Updated");

    await apiRequest("DELETE", `/tracks/${encodeURIComponent(TRACK_NAME)}`);
    await page.reload();
    await page.locator("#track-status-filter").selectOption("archived");
    await expect(createdRow).toBeVisible();

    await apiRequest("PUT", `/tracks/${encodeURIComponent(TRACK_NAME)}`, {
      is_active: true,
    });

    await page.reload();
    await expect(createdRow).toContainText("Legacy Ridge Updated");
  });
});
