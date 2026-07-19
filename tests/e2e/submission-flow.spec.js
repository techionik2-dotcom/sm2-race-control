const { test, expect } = require("@playwright/test");

const EVENT_ID = "event-1";
const TRACK_NAME = "Sebring International Raceway";
const SUBMISSION_REF = "SEB-20260423-1531-PRACTICE-3-NG-NG-GT4-2025";
const QUICK_TRANSCRIPT = "voice transcript note";
const QUICK_PHOTO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+X2XW4wAAAABJRU5ErkJggg==",
  "base64",
);
const QUICK_PHOTO_RED = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64",
);
const QUICK_PHOTO_GREEN = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNg+M/wHwAEAQH/cetH5QAAAABJRU5ErkJggg==",
  "base64",
);
const QUICK_PHOTO_BLUE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/5ncLrgAAAABJRU5ErkJggg==",
  "base64",
);

const makeDateTime = (isoString) => new Date(isoString).toISOString();

const makeSessionData = ({ tireStatus = "DISCARDED" } = {}) => ({
  date: "2026-04-23",
  time: "15:31",
  track: TRACK_NAME,
  driver_id: "NG",
  vehicle_id: "NG-GT4-2025",
  session_type: "Practice",
  session_number: 3,
  duration_min: 10,
  tire_set: "Y-S3",
  wheelbase_mm: 2550,
  pressures: {
    cold: { fl: 22, fr: 21, rl: 22, rr: 23 },
    hot: { fl: 24, fr: 23, rl: 24, rr: 25 },
  },
  suspension: {
    rebound_fl: 12,
    rebound_fr: 12,
    rebound_rl: 11,
    rebound_rr: 11,
    bump_fl: 5,
    bump_fr: 5,
    bump_rl: 4,
    bump_rr: 4,
    sway_bar_f: "1",
    sway_bar_r: "2",
    wing_angle_deg: 15,
  },
  alignment: {
    camber_fl: -1.5,
    camber_fr: -1.4,
    camber_rl: -2.0,
    camber_rr: -2.0,
    toe_front: "0.05",
    toe_rear: "0.10",
    caster_l: 6.5,
    caster_r: 6.4,
    ride_height_f: 65,
    ride_height_r: 68,
    corner_weight_fl: 310,
    corner_weight_fr: 315,
    corner_weight_rl: 320,
    corner_weight_rr: 322,
    cross_weight_pct: 50.5,
    rake_mm: 3.0,
    wheelbase_mm: 2550,
  },
  tire_temperatures: {
    fl_in: 78.5,
    fl_mid: 80.0,
    fl_out: 82.1,
    fr_in: 77.2,
    fr_mid: 79.0,
    fr_out: 81.3,
    rl_in: 74.0,
    rl_mid: 75.1,
    rl_out: 76.8,
    rr_in: 73.8,
    rr_mid: 75.0,
    rr_out: 76.5,
  },
  tire_inventory: {
    tire_id: "Y-S3",
    manufacturer: "Yokohama",
    model: "S3",
    size: "S3",
    purchase_date: "2026-04-14",
    heat_cycles: 2,
    track_time_min: 15,
    status: tireStatus,
  },
});

async function mockSubmissionApp(page, options = {}) {
  const submissionRequests = [];
  const rawSubmissionRequests = [];
  const ocrPreviewRequests = [];
  const ocrDraftStatusRequests = [];
  const latestOcrDraftRequests = [];
  const buildSubmissionResponse =
    options.buildSubmissionResponse ||
    ((body) => ({
      submission_ref: body.submission_ref,
      correlation_id: body.correlation_id,
      status: "SENT",
      raw_text: body.raw_text ?? null,
      image_url: body.image_url ?? null,
      payload: body.payload,
      analysis_result: body.analysis_result,
      created_at: makeDateTime("2026-04-23T15:31:00.000Z"),
      updated_at: makeDateTime("2026-04-23T15:33:00.000Z"),
    }));
  const buildRawSubmissionResponse =
    options.buildRawSubmissionResponse ||
    ((body) => ({
      status: "SUCCESS",
      id_seance: "20260423-NG-S01",
      message: "Session stored successfully",
      raw_text: body.raw_text,
    }));
  const buildOcrPreviewResponse =
    options.buildOcrPreviewResponse ||
    (() => ({
      status: "success",
      message: null,
      doc_type: "handwritten_setup_grid",
      confidence: 0.84,
      model_used: "gpt-5.4",
      fallback_used: false,
      metadata: {
        driver_text: "NG",
        track_text: TRACK_NAME,
        session_text: "Practice S3",
      },
      structured_data: {
        session: {
          date: "2026-04-23",
          time: "15:31",
          track: TRACK_NAME,
          session_type: "Practice",
          session_number: "3",
          duration_min: "30",
          driver_id: "NG",
          vehicle_id: "NG-GT4-2025",
        },
        alignment: {
          rh_fl: "65",
          rh_fr: "65",
          rh_rl: "68",
          rh_rr: "68",
          ride_height_f: "65",
          ride_height_r: "68",
          camber_fl: "-1.5",
          camber_fr: "-1.4",
          camber_rl: "-2.0",
          camber_rr: "-2.0",
          toe_fl: "0.05",
          toe_fr: "0.05",
          toe_rl: "0.10",
          toe_rr: "0.10",
          toe_front: "0.05",
          toe_rear: "0.10",
          caster_l: "6.5",
          caster_r: "6.4",
          rake_mm: "3",
          wheelbase_mm: "2550",
        },
        pressures: {
          cold: { fl: "22.0", fr: "22.1", rl: "22.4", rr: "22.5" },
          hot: { fl: "24.0", fr: "24.1", rl: "24.4", rr: "24.5" },
        },
        suspension: {
          rebound_fl: "12",
          rebound_fr: "12",
          rebound_rl: "11",
          rebound_rr: "11",
          bump_fl: "5",
          bump_fr: "5",
          bump_rl: "4",
          bump_rr: "4",
          hsr_fl: "7",
          hsr_fr: "7",
          hsr_rl: "6",
          hsr_rr: "6",
          lsr_fl: "4",
          lsr_fr: "4",
          lsr_rl: "3",
          lsr_rr: "3",
          hsb_fl: "8",
          hsb_fr: "8",
          hsb_rl: "7",
          hsb_rr: "7",
          lsb_fl: "5",
          lsb_fr: "5",
          lsb_rl: "4",
          lsb_rr: "4",
          sway_bar_f: "1",
          sway_bar_r: "2",
          wing_angle_deg: "15",
        },
        shock_setup: {
          rr: { position: "RR", hsr: "7", lsr: "6", hsb: "9", lsb: "8", total_setup: "30" },
          lr: { position: "LR", hsr: "", lsr: "", hsb: "", lsb: "", total_setup: "" },
          lf: { position: "LF", hsr: "", lsr: "", hsb: "", lsb: "", total_setup: "" },
          rf: { position: "RF", hsr: "", lsr: "", hsb: "", lsb: "", total_setup: "" },
        },
        notes: ["Rear ride height was hard to read"],
      },
      raw_evidence: {
        visible_text: ["RH front 65 rear 68", "camber -1.5 -1.4 -2.0 -2.0"],
        detected_grids: [{ label: "RH" }, { label: "Camber" }],
        detected_labels: [{ label: "RH" }, { label: "Camber" }],
        unmapped_values: ["Rear ride height was hard to read"],
      },
      review_flags: ["ambiguous handwriting"],
      raw_text: "RH front 65 rear 68",
      extracted_text: "RH front 65 rear 68",
      summary: "Setup sheet parsed",
      recommended_review_status: "PENDING",
      parser_version: "ocr-v1",
      model: "gpt-5.4",
    }));
  const buildOcrDraftStatusResponse =
    options.buildOcrDraftStatusResponse ||
    ((context = {}) => buildOcrPreviewResponse(context.body || {}));
  const buildLatestOcrDraftResponse =
    options.buildLatestOcrDraftResponse ||
    ((context = {}) => buildOcrDraftStatusResponse(context));

  await page.addInitScript(
    ({ transcript, token }) => {
      localStorage.setItem("sm2_token", token);
      localStorage.setItem(
        "sm2_user",
        JSON.stringify({
          id: "user-1",
          role: "MECHANIC",
          name: "Mechanic One",
        }),
      );

      class FakeSpeechRecognition {
        constructor() {
          this.lang = "en-US";
          this.interimResults = true;
          this.maxAlternatives = 1;
          this.continuous = false;
        }

        start() {
          if (typeof this.onstart === "function") {
            this.onstart();
          }

          queueMicrotask(() => {
            if (typeof this.onresult === "function") {
              this.onresult({
                resultIndex: 0,
                results: [
                  {
                    isFinal: true,
                    0: { transcript },
                  },
                ],
              });
            }

            if (typeof this.onend === "function") {
              this.onend();
            }
          });
        }

        stop() {
          if (typeof this.onend === "function") {
            this.onend();
          }
        }

        abort() {}
      }

      window.SpeechRecognition = FakeSpeechRecognition;
      window.webkitSpeechRecognition = FakeSpeechRecognition;
    },
    { transcript: QUICK_TRANSCRIPT, token: "test-token" },
  );

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();

    if (pathname === "/api/v1/auth/me") {
      return route.fulfill({
        json: {
          user: {
            id: "user-1",
            role: "MECHANIC",
            name: "Mechanic One",
            email: "mechanic@example.com",
          },
        },
      });
    }

    if (pathname === `/api/v1/events/${EVENT_ID}` && method === "GET") {
      return route.fulfill({
        json: {
          event: {
            id: EVENT_ID,
            name: "Sebring",
            track: TRACK_NAME,
            start_date: "2026-05-10T00:00:00.000Z",
            end_date: "2026-05-20T00:00:00.000Z",
            is_active: true,
          },
        },
      });
    }

    if (pathname === `/api/v1/events/${EVENT_ID}/select` && method === "POST") {
      return route.fulfill({
        json: {
          event: {
            id: EVENT_ID,
            name: "Sebring",
            track: TRACK_NAME,
          },
        },
      });
    }

    if (pathname === `/api/v1/run-groups/event/${EVENT_ID}` && method === "GET") {
      return route.fulfill({
        json: {
          runGroup: {
            id: "run-group-1",
            event_id: EVENT_ID,
            normalized: "BLUE",
            raw_text: "BLUE",
            locked: false,
          },
        },
      });
    }

    if (pathname === "/api/v1/drivers" && method === "GET") {
      return route.fulfill({
        json: {
          drivers: [
            {
              id: "driver-1",
              driver_id: "NG",
              first_name: "Nicolas",
              last_name: "Guigère",
              driver_name: "Nicolas Guigère",
              team_name: "Blue",
              is_active: true,
            },
          ],
        },
      });
    }

    if (pathname === "/api/v1/vehicles" && method === "GET") {
      return route.fulfill({
        json: {
          vehicles: [
            {
              id: "vehicle-1",
              vehicle_id: "NG-GT4-2025",
              driver_id: "NG",
              make: "Porsche",
              model: "GT4 RS Clubsport",
              year: 2025,
              is_active: true,
            },
          ],
        },
      });
    }

    if (pathname === "/api/v1/tracks" && method === "GET") {
      return route.fulfill({
        json: {
          tracks: [
            {
              name: TRACK_NAME,
              country: "USA",
              active: true,
            },
          ],
        },
      });
    }

    if (pathname === "/api/v1/submissions" && method === "POST") {
      const body = request.postDataJSON();
      submissionRequests.push(body);
      return route.fulfill({
        status: 201,
        json: {
          submission: buildSubmissionResponse(body),
        },
      });
    }

    if (pathname === "/api/v1/submissions/ocr-preview" && method === "POST") {
      const body = request.postDataJSON();
      ocrPreviewRequests.push(body);

      if (options.ocrPreviewDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.ocrPreviewDelayMs));
      }

      if (options.ocrPreviewError) {
        return route.fulfill({
          status: options.ocrPreviewError.status || 502,
          json: {
            error: options.ocrPreviewError.code || "OCR_EXTRACTION_FAILED",
            message:
              options.ocrPreviewError.message ||
              "OCR extraction did not return a usable draft. Retry with a clearer image.",
            missing_requirements: options.ocrPreviewError.missingRequirements || [],
            detail: {
              code: options.ocrPreviewError.code || "OCR_EXTRACTION_FAILED",
              message:
                options.ocrPreviewError.message ||
                "OCR extraction did not return a usable draft. Retry with a clearer image.",
            },
          },
        });
      }

      return route.fulfill({
        status: 200,
        json: buildOcrPreviewResponse(body),
      });
    }

    if (pathname.startsWith("/api/v1/submissions/ocr-preview/latest/event/") && method === "GET") {
      const eventId = decodeURIComponent(pathname.split("/").pop() || "");
      latestOcrDraftRequests.push(eventId);

      return route.fulfill({
        status: 200,
        json: buildLatestOcrDraftResponse({ eventId, pathname }),
      });
    }

    if (pathname.startsWith("/api/v1/submissions/ocr-preview/") && method === "GET") {
      const correlationId = decodeURIComponent(pathname.split("/").pop() || "");
      ocrDraftStatusRequests.push(correlationId);

      return route.fulfill({
        status: 200,
        json: buildOcrDraftStatusResponse({ correlationId, pathname }),
      });
    }

    if (pathname === "/api/v1/submissions/raw" && method === "POST") {
      const body = request.postDataJSON();
      rawSubmissionRequests.push(body);
      const rawResponse = buildRawSubmissionResponse(body);
      const statusCode =
        rawResponse?.statusCode ||
        rawResponse?.httpStatus ||
        (String(rawResponse?.status || "").toUpperCase() === "VALIDATION_FAILED" ? 400 : 201);
      const responseBody = rawResponse?.body || rawResponse;

      return route.fulfill({
        status: statusCode,
        json: responseBody,
      });
    }

    return route.fulfill({ status: 200, json: {} });
  });

  submissionRequests.rawSubmissionRequests = rawSubmissionRequests;
  submissionRequests.ocrPreviewRequests = ocrPreviewRequests;
  submissionRequests.ocrDraftStatusRequests = ocrDraftStatusRequests;
  submissionRequests.latestOcrDraftRequests = latestOcrDraftRequests;
  return submissionRequests;
}

test.describe("submission flow", () => {
  test("detail submissions only render structured inputs and reject empty submits", async ({
    page,
  }) => {
    const requests = await mockSubmissionApp(page);

    await page.goto(`/event/${EVENT_ID}/notes`);
    await expect(page.getByRole("heading", { name: "Submit Notes" })).toBeVisible();
    await page.getByTestId("submission-tab-detail").click();
    await expect(
      page.locator('select[data-testid="submission-track-select"] option[value="__OTHER__"]'),
    ).toHaveText("Other (type manually)");

    await expect(page.getByTestId("quick-raw-notes")).toHaveCount(0);
    await expect(page.getByTestId("quick-photo-input")).toHaveCount(0);
    await expect(page.getByTestId("quick-voice-control")).toHaveCount(0);

    await page.getByRole("button", { name: "Submit Notes" }).click();
    await expect(page.getByText("Please fix the highlighted fields before submitting.")).toBeVisible({
      timeout: 5000,
    });
    await expect.poll(() => requests.length).toBe(0);

    await page.getByTestId("submission-date").fill("2026-04-23");
    await page.getByTestId("submission-time").fill("15:31");
    await page.getByTestId("submission-session-id").fill(SUBMISSION_REF);
    await page.getByTestId("submission-track-select").selectOption("__OTHER__");
    await page.getByTestId("submission-track-manual").fill(TRACK_NAME);
    await page.getByTestId("submission-driver-select").selectOption("NG");
    await page.getByTestId("submission-vehicle-select").selectOption("NG-GT4-2025");
    await page.getByTestId("submission-session-type").selectOption("Practice");
    await page.getByTestId("detail-tire-set").fill("Y-S3");
    await page.getByTestId("detail-tire-status").selectOption("DISCARDED");
    await page.getByTestId("detail-pressure-fl").fill("22.1");
    await page.getByTestId("detail-suspension-rebound-fl").fill("12");
    await page.getByTestId("detail-alignment-camber-fl").fill("-1.5");
    await page.getByTestId("detail-temp-fl-in").fill("78.5");

    await page.getByRole("button", { name: "Submit Notes" }).click();
    await expect.poll(() => requests.length).toBe(1);
    await expect(page.locator(".status-message.status-success")).toBeVisible({
      timeout: 5000,
    });

    const body = requests[0];
    expect(body.raw_text).toBeUndefined();
    expect(body.image_url).toBeUndefined();
    expect(body.analysis_result.voice_input_used).toBeUndefined();
    expect(body.analysis_result.submission_mode).toBe("detail");
    expect(body.payload.track).toBe(TRACK_NAME);
    expect(body.payload.tire_inventory.status).toBe("DISCARDED");
    expect(body.payload.pressures.cold.fl).toBe(22.1);
    expect(body.payload.suspension.rebound_fl).toBe(12);
    expect(body.payload.alignment.camber_fl).toBe(-1.5);
    expect(body.payload.tire_temperatures.fl_in).toBe(78.5);
  });

  test("detail drafts autosave and restore on reload", async ({ page }) => {
    await mockSubmissionApp(page);

    const draftKey = `sm2:submission-draft:${EVENT_ID}:user-1`;

    await page.goto(`/event/${EVENT_ID}/notes`);
    await page.getByTestId("submission-tab-detail").click();
    await page.getByTestId("submission-date").fill("2026-04-23");
    await page.getByTestId("submission-time").fill("15:31");
    await page.getByTestId("submission-session-id").fill(`${SUBMISSION_REF}-DRAFT`);
    await page.getByTestId("submission-track-select").selectOption("__OTHER__");
    await page.getByTestId("submission-track-manual").fill(TRACK_NAME);
    await page.getByTestId("submission-driver-select").selectOption("NG");
    await page.getByTestId("submission-vehicle-select").selectOption("NG-GT4-2025");
    await page.getByTestId("submission-session-type").selectOption("Practice");
    await page.getByTestId("detail-pressure-fl").fill("22.1");

    await expect
      .poll(() => page.evaluate((key) => localStorage.getItem(key), draftKey))
      .not.toBeNull();
    await expect(page.getByText("Draft saved locally on this device.")).toBeVisible({
      timeout: 5000,
    });

    await page.reload();
    await page.getByTestId("submission-tab-detail").click();
    await expect(page.getByTestId("submission-date")).toHaveValue("2026-04-23");
    await expect(page.getByTestId("submission-session-id")).toHaveValue(`${SUBMISSION_REF}-DRAFT`);
    await expect(page.getByTestId("submission-track-manual")).toHaveValue(TRACK_NAME);
    await expect(page.getByTestId("submission-driver-select")).toHaveValue("NG");
    await expect(page.getByTestId("submission-vehicle-select")).toHaveValue("NG-GT4-2025");
  });

  test("detail submissions show structured warnings when normalized pressure values are skipped", async ({
    page,
  }) => {
    const requests = await mockSubmissionApp(page, {
      buildSubmissionResponse: (body) => ({
        submission_ref: body.submission_ref,
        correlation_id: body.correlation_id,
        status: "SENT",
        raw_text: body.raw_text ?? null,
        image_url: body.image_url ?? null,
        payload: body.payload,
        analysis_result: body.analysis_result,
        structured_ingest_status: "saved_with_warnings",
        structured_ingest_warnings: [
          {
            section: "pressures",
            code: "VALUE_TOO_HIGH",
            field: "cold_fl",
            value: 112,
            message: "cold_fl must be at most 60.0 to be normalized.",
          },
        ],
        created_at: makeDateTime("2026-04-23T15:31:00.000Z"),
        updated_at: makeDateTime("2026-04-23T15:33:00.000Z"),
      }),
    });

    await page.goto(`/event/${EVENT_ID}/notes`);
    await page.getByTestId("submission-tab-detail").click();
    await page.getByTestId("submission-date").fill("2026-04-23");
    await page.getByTestId("submission-time").fill("15:31");
    await page.getByTestId("submission-session-id").fill(`${SUBMISSION_REF}-WARN`);
    await page.getByTestId("submission-track-select").selectOption("__OTHER__");
    await page.getByTestId("submission-track-manual").fill(TRACK_NAME);
    await page.getByTestId("submission-driver-select").selectOption("NG");
    await page.getByTestId("submission-vehicle-select").selectOption("NG-GT4-2025");
    await page.getByTestId("submission-session-type").selectOption("Practice");
    await page.getByTestId("detail-tire-set").fill("Y-S3");
    await page.getByTestId("detail-pressure-fl").fill("112");

    await expect(page.getByText("Pressure values outside the SM2 normalized DB limits")).toBeVisible();

    await page.getByRole("button", { name: "Submit Notes" }).click();
    await expect.poll(() => requests.length).toBe(1);
    await expect(
      page.getByText("Note saved. Some structured fields could not be normalized, so review the warnings below."),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByText("cold_fl: cold_fl must be at most 60.0 to be normalized."),
    ).toBeVisible();
  });

  test("quick submissions preserve raw text, photos, and voice data", async ({ page }) => {
    const requests = await mockSubmissionApp(page);

    await page.goto(`/event/${EVENT_ID}/notes`);
    await expect(page.getByTestId("quick-raw-notes")).toBeVisible();
    await expect(page.getByTestId("quick-photo-input")).toBeVisible();
    await expect(page.getByTestId("quick-voice-control")).toBeVisible();
    await expect(
      page.locator('select[data-testid="submission-track-select"] option[value="__OTHER__"]'),
    ).toHaveText("Other (type manually)");

    await page.getByTestId("quick-raw-notes").fill("front pressures were stable");
    await page.getByTestId("quick-photo-input").setInputFiles({
      name: "quick-photo.png",
      mimeType: "image/png",
      buffer: QUICK_PHOTO,
    });
    await page.waitForTimeout(100);

    await page.getByRole("button", { name: "Start Voice Note" }).click();
    await expect(page.getByTestId("quick-raw-notes")).toHaveValue(/voice transcript note/, {
      timeout: 5000,
    });

    await page.getByTestId("submission-date").fill("2026-04-23");
    await page.getByTestId("submission-time").fill("15:31");
    await page.getByTestId("submission-session-id").fill(`${SUBMISSION_REF}-QUICK`);
    await page.getByTestId("submission-track-select").selectOption("__OTHER__");
    await page.getByTestId("submission-track-manual").fill(TRACK_NAME);
    await page.getByTestId("submission-driver-select").selectOption("NG");
    await page.getByTestId("submission-vehicle-select").selectOption("NG-GT4-2025");
    await page.getByTestId("submission-session-type").selectOption("Practice");

    await page.getByRole("button", { name: "Submit Notes" }).click();
    await expect.poll(() => requests.length).toBe(1);
    await expect(page.locator(".status-message.status-success")).toBeVisible({
      timeout: 5000,
    });

    const body = requests[0];
    expect(body.raw_text).toContain("front pressures were stable");
    expect(body.raw_text).toContain(QUICK_TRANSCRIPT);
    expect(body.image_url).toContain("data:image/png;base64,");
    expect(body.analysis_result.voice_input_used).toBe(true);
    expect(body.analysis_result.submission_mode).toBe("quick");
    expect(body.payload.track).toBe(TRACK_NAME);
    expect(body.payload.session_type).toBe("Practice");
  });

  test("quick shorthand submissions route to the raw endpoint even when session number is empty", async ({
    page,
  }) => {
    const requests = await mockSubmissionApp(page, {
      buildRawSubmissionResponse: (body) => ({
        status: "SUCCESS",
        id_seance: "20260423-NG-S01",
        message: "Session stored successfully",
        raw_text: body.raw_text,
      }),
    });

    await page.goto(`/event/${EVENT_ID}/notes`);
    await page.getByTestId("quick-raw-notes").fill("s1 30min nico gt4 Y-S3 pf 27 wb 2450");
    await page.getByTestId("submission-date").fill("2026-04-23");
    await page.getByTestId("submission-time").fill("15:31");
    await page.getByTestId("submission-session-id").fill(`${SUBMISSION_REF}-RAW`);
    await page.getByTestId("submission-track-select").selectOption("__OTHER__");
    await page.getByTestId("submission-track-manual").fill(TRACK_NAME);
    await page.getByTestId("submission-driver-select").selectOption("NG");
    await page.getByTestId("submission-vehicle-select").selectOption("NG-GT4-2025");
    await page.getByTestId("submission-session-type").selectOption("Practice");
    await page.getByTestId("submission-session-number").fill("");

    await page.getByRole("button", { name: "Submit Notes" }).click();
    await expect.poll(() => requests.rawSubmissionRequests.length).toBe(1);
    await expect.poll(() => requests.length).toBe(0);
    await expect(page.getByText("Session stored successfully")).toBeVisible({
      timeout: 5000,
    });

    expect(requests.rawSubmissionRequests[0]).toEqual({
      source: "pwa",
      created_by: "Mechanic One",
      eventId: EVENT_ID,
      runGroup: "BLUE",
      raw_text: "s1 30min nico gt4 Y-S3 pf 27 wb 2450",
    });
  });

  test("raw validation failures are shown clearly in the quick submit flow", async ({ page }) => {
    const requests = await mockSubmissionApp(page, {
      buildRawSubmissionResponse: () => ({
        status: "VALIDATION_FAILED",
        message: "vehicle_id does not belong to driver_id",
        errors: [
          {
            field: "vehicle_id",
            message: "vehicle_id does not belong to driver_id",
          },
        ],
      }),
    });

    await page.goto(`/event/${EVENT_ID}/notes`);
    await page.getByTestId("quick-raw-notes").fill("s1 30min nico gt4 Y-S3 pf 27 wb 2450");
    await page.getByTestId("submission-date").fill("2026-04-23");
    await page.getByTestId("submission-time").fill("15:31");
    await page.getByTestId("submission-session-id").fill(`${SUBMISSION_REF}-RAW-ERR`);
    await page.getByTestId("submission-track-select").selectOption("__OTHER__");
    await page.getByTestId("submission-track-manual").fill(TRACK_NAME);
    await page.getByTestId("submission-driver-select").selectOption("NG");
    await page.getByTestId("submission-vehicle-select").selectOption("NG-GT4-2025");
    await page.getByTestId("submission-session-type").selectOption("Practice");

    await page.getByRole("button", { name: "Submit Notes" }).click();
    await expect.poll(() => requests.rawSubmissionRequests.length).toBe(1);
    await expect(page.getByText("vehicle_id does not belong to driver_id")).toBeVisible({
      timeout: 5000,
    });
  });

  test("quick submissions handle raw-only, voice-only, and image-only payloads", async ({
    page,
  }) => {
    const requests = await mockSubmissionApp(page);

    const scenarios = [
      {
        name: "raw-only",
        sessionId: `${SUBMISSION_REF}-RAW`,
        setup: async () => {
          await page.getByTestId("quick-raw-notes").fill("rear pressures were stable");
        },
        assert: (body) => {
          expect(body.raw_text).toBe("rear pressures were stable");
          expect(body.image_url).toBeUndefined();
          expect(body.analysis_result.voice_input_used).toBe(false);
        },
      },
      {
        name: "voice-only",
        sessionId: `${SUBMISSION_REF}-VOICE`,
        setup: async () => {
          await page.getByRole("button", { name: "Start Voice Note" }).click();
          await expect(page.getByTestId("quick-raw-notes")).toHaveValue(/voice transcript note/, {
            timeout: 5000,
          });
        },
        assert: (body) => {
          expect(body.raw_text).toContain(QUICK_TRANSCRIPT);
          expect(body.image_url).toBeUndefined();
          expect(body.analysis_result.voice_input_used).toBe(true);
        },
      },
      {
        name: "image-only",
        sessionId: `${SUBMISSION_REF}-IMAGE`,
        setup: async () => {
          await page.getByTestId("quick-photo-input").setInputFiles({
            name: "quick-photo.png",
            mimeType: "image/png",
            buffer: QUICK_PHOTO,
          });
        },
        assert: (body) => {
          expect(body.raw_text).toBeUndefined();
          expect(body.image_url).toContain("data:image/png;base64,");
          expect(body.analysis_result.voice_input_used).toBe(false);
        },
      },
    ];

    for (const scenario of scenarios) {
      requests.length = 0;
      await page.goto(`/event/${EVENT_ID}/notes`);
      await expect(page.getByTestId("quick-raw-notes")).toBeVisible();

      await page.getByTestId("submission-date").fill("2026-04-23");
      await page.getByTestId("submission-time").fill("15:31");
      await page.getByTestId("submission-session-id").fill(scenario.sessionId);
      await page.getByTestId("submission-track-select").selectOption("__OTHER__");
      await page.getByTestId("submission-track-manual").fill(TRACK_NAME);
      await page.getByTestId("submission-driver-select").selectOption("NG");
      await page.getByTestId("submission-vehicle-select").selectOption("NG-GT4-2025");
      await page.getByTestId("submission-session-type").selectOption("Practice");

      await scenario.setup();
      await page.getByRole("button", { name: "Submit Notes" }).click();

      await expect.poll(() => requests.length).toBe(1);
      const body = requests[0];
      scenario.assert(body);
      expect(body.payload.track).toBe(TRACK_NAME);
      expect(body.payload.session_type).toBe("Practice");
      expect(body.analysis_result.submission_mode).toBe("quick");
    }
  });

  test("ocr notes wait for an image before extraction and keep event context visible", async ({
    page,
  }) => {
    await mockSubmissionApp(page);

    await page.goto(`/event/${EVENT_ID}/ocr-notes`);
    await expect(page.getByRole("heading", { name: "OCR Notes" })).toBeVisible();
    await expect(page.getByText(TRACK_NAME)).toBeVisible();
    await expect(page.getByText("BLUE")).toBeVisible();
    await expect(page.getByTestId("ocr-extract-button")).toBeDisabled();

    await page.getByTestId("ocr-submission-image-input").setInputFiles({
      name: "ocr-sheet.png",
      mimeType: "image/png",
      buffer: QUICK_PHOTO,
    });

    await expect(page.getByAltText("OCR note preview")).toBeVisible();
    await expect(page.getByTestId("ocr-extract-button")).toBeEnabled();
  });

  test("ocr notes show extraction loading and reveal editable review sections on success", async ({
    page,
  }) => {
    const requests = await mockSubmissionApp(page, { ocrPreviewDelayMs: 300 });

    await page.goto(`/event/${EVENT_ID}/ocr-notes`);
    await page.getByTestId("ocr-submission-image-input").setInputFiles({
      name: "ocr-sheet.png",
      mimeType: "image/png",
      buffer: QUICK_PHOTO,
    });

    await page.getByTestId("ocr-extract-button").click();
    await expect(page.getByTestId("ocr-extract-button")).toHaveText("Extracting...", {
      timeout: 5000,
    });
    await expect.poll(() => requests.ocrPreviewRequests.length).toBe(1);
    await expect(page.getByTestId("ocr-review-sections")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ride Height" })).toBeVisible();
    await expect(
      page.getByTestId("ocr-review-sections").getByText("ambiguous handwriting", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("gpt-5.4").first()).toBeVisible();
    await expect(page.getByText("handwritten setup grid").first()).toBeVisible();

    expect(requests.ocrPreviewRequests[0].context.track).toBe(TRACK_NAME);
  });

  test("ocr notes show a partial-extracted warning and raw OCR text instead of hard failure", async ({
    page,
  }) => {
    await mockSubmissionApp(page, {
      buildOcrPreviewResponse: () => ({
        status: "partial_extracted",
        message: "Partial OCR extracted. Please review highlighted fields.",
        doc_type: "handwritten_setup_grid",
        confidence: 0.46,
        model_used: "gpt-5.4",
        fallback_used: false,
        metadata: {
          driver_text: "NG",
          track_text: TRACK_NAME,
          session_text: "Practice S1",
        },
        structured_data: {
          alignment: {
            rh_fl: "102",
            rh_fr: "101",
            rh_rl: "",
            rh_rr: "",
            ride_height_f: "",
            ride_height_r: "",
            camber_fl: "",
            camber_fr: "",
            camber_rl: "",
            camber_rr: "",
            toe_fl: "",
            toe_fr: "",
            toe_rl: "",
            toe_rr: "",
            toe_front: "",
            toe_rear: "",
            caster_l: "",
            caster_r: "",
            rake_mm: "",
            wheelbase_mm: "",
          },
          pressures: {
            cold: { fl: "", fr: "", rl: "", rr: "" },
            hot: { fl: "", fr: "", rl: "", rr: "" },
          },
          suspension: {},
          shock_setup: { rr: {}, lr: {}, lf: {}, rf: {} },
          notes: ["Some values could not be mapped"],
        },
        raw_evidence: {
          visible_text: ["RH", "102", "101", "Sebring Daniel"],
          detected_grids: [{ label: "RH" }],
          detected_labels: [{ label: "RH" }],
          unmapped_values: ["Sebring Daniel"],
        },
        review_flags: ["Low confidence extraction", "Manual review required"],
        raw_text: "RH 102 101 Sebring Daniel",
        extracted_text: "RH 102 101 Sebring Daniel",
        summary: "Partial OCR draft",
        recommended_review_status: "PENDING",
        parser_version: "ocr-v1",
        field_evidence: [],
        normalized_sections: {},
        preprocessing: { selected_variant: "high_contrast_grayscale" },
      }),
    });

    await page.goto(`/event/${EVENT_ID}/ocr-notes`);
    await page.getByTestId("ocr-submission-image-input").setInputFiles({
      name: "ocr-sheet.png",
      mimeType: "image/png",
      buffer: QUICK_PHOTO,
    });

    await page.getByTestId("ocr-extract-button").click();
    const reviewBanner = page.getByTestId("ocr-review-required-banner");
    await expect(reviewBanner).toBeVisible({ timeout: 5000 });
    await expect(reviewBanner.getByText("Partial OCR extracted. Please review highlighted fields.")).toBeVisible();
    const rawOcrField = page
      .locator(".ocr-notes-field")
      .filter({ has: page.locator("label", { hasText: "Raw OCR Text" }) });
    await expect(rawOcrField.locator("textarea")).toHaveValue("RH 102 101 Sebring Daniel");
    await expect(page.getByAltText("OCR note preview")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ride Height" })).toBeVisible();
    await expect(page.getByText("Low confidence extraction").first()).toBeVisible();
  });

  test("ocr notes show a blank-template warning while keeping manual correction available", async ({
    page,
  }) => {
    await mockSubmissionApp(page, {
      buildOcrPreviewResponse: () => ({
        status: "blank_template_detected",
        message: "Blank setup template detected. No handwritten values found.",
        doc_type: "blank_setup_sheet",
        confidence: 0.11,
        model_used: "gpt-5.4",
        fallback_used: false,
        metadata: {
          driver_text: "",
          track_text: TRACK_NAME,
          session_text: "",
        },
        structured_data: {
          alignment: {},
          pressures: { cold: {}, hot: {} },
          suspension: {},
          shock_setup: { rr: {}, lr: {}, lf: {}, rf: {} },
          notes: [],
        },
        raw_evidence: {
          visible_text: ["DATE", "DRIVER", "TRACK", "CAMBER"],
          detected_grids: [],
          detected_labels: [{ label: "CAMBER" }],
          unmapped_values: [],
          template_labels: ["CAMBER"],
          quality_flags: [],
        },
        review_flags: ["No handwritten values found"],
        raw_text: "DATE DRIVER TRACK CAMBER",
        extracted_text: "",
        summary: "Blank setup template",
        recommended_review_status: "PENDING",
        parser_version: "ocr-v1",
        field_evidence: [],
        normalized_sections: {},
        preprocessing: { selected_variant: "cropped_paper" },
      }),
    });

    await page.goto(`/event/${EVENT_ID}/ocr-notes`);
    await page.getByTestId("ocr-submission-image-input").setInputFiles({
      name: "blank-template.jpg",
      mimeType: "image/jpeg",
      buffer: QUICK_PHOTO,
    });

    await page.getByTestId("ocr-extract-button").click();
    const reviewBanner = page.getByTestId("ocr-review-required-banner");
    await expect(reviewBanner).toBeVisible({ timeout: 5000 });
    await expect(reviewBanner.getByText("Blank setup template detected. No handwritten values found.")).toBeVisible();
    await expect(page.getByTestId("ocr-review-sections")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Editable OCR review" })).toBeVisible();
    await expect(page.getByLabel("RH FL")).toBeVisible();
    await expect(page.getByAltText("OCR note preview")).toBeVisible();
  });

  test("ocr notes keep printed-form review focused on the upper setup block", async ({ page }) => {
    await mockSubmissionApp(page, {
      buildOcrPreviewResponse: () => ({
        status: "partial_extracted",
        message: "Partial OCR extracted. Please review highlighted fields.",
        doc_type: "printed_form_with_values",
        confidence: 0.74,
        model_used: "gpt-5.4",
        fallback_used: false,
        metadata: {
          driver_text: "Alex G",
          track_text: TRACK_NAME,
          session_text: "04/18/26 10:15 AM",
        },
        structured_data: {
          alignment: {
            rh_fl: "80.0",
            rh_fr: "81.1",
            rh_rl: "121.0",
            rh_rr: "120.8",
            ride_height_f: "80.0",
            ride_height_r: "121.0",
            camber_fl: "3.8",
            camber_fr: "4.0",
            camber_rl: "3.3",
            camber_rr: "3.7",
            toe_fl: "0.10 out",
            toe_fr: "0.12 out",
            toe_rl: "0.05 in",
            toe_rr: "0.06 in",
            toe_front: "0.10 out",
            toe_rear: "0.05 in",
            caster_l: "",
            caster_r: "",
            rake_mm: "2.5",
            wheelbase_mm: "109.9",
          },
          pressures: {
            cold: { fl: "22.8", fr: "23.1", rl: "21.9", rr: "22.2" },
            hot: { fl: "", fr: "", rl: "", rr: "" },
          },
          suspension: {},
          sheet_fields: {
            fuel_liters: "42",
            driver_weight_lbs: "178",
            scale_weight_lbs: "1278",
            cross_weight_percent: "50.2%",
            roll_bar_text: "3 front / 2 rear",
            spacer_text: "8",
            bump_text: "6",
            rebound_text: "9",
            springs_front: "900",
            springs_rear: "1050",
            bump_stops_front: "6",
            bump_stops_rear: "8",
            wheelbase_left_mm: "109.8",
            wheelbase_right_mm: "109.9",
            wing_rake_deg: "2.5",
            wing_angle_deg: "7",
            wing_gurney_mm: "12",
            notes_block: "Good overall balance; slight push on entry.",
            fuel_pumped_out_liters: "",
          },
          post_session: {
            camber_text: "3.6 / 3.8 / 3.1 / 3.5",
            toe_text: "0.08 out / 0.10 out / 0.04 in / 0.05 in",
            weight_text: "528 / 533 / 842 / 846",
            height_text: "80.2 / 81.3 / 121.1 / 120.9",
            shocks_text: "6 / 9 / 6 / 9",
          },
          shock_setup: { rr: {}, lr: {}, lf: {}, rf: {} },
          notes: [
            "Good overall balance, slight push on entry.",
            "Entry stability improved with more front bar.",
          ],
        },
        raw_evidence: {
          visible_text: ["Alex G", "Sebring", "Fuel 42", "Camber 3.8 4.0 3.3 3.7"],
          detected_grids: [{ label: "Camber" }, { label: "Toe" }, { label: "Height" }],
          detected_labels: [{ label: "CAMBER" }, { label: "TOE" }],
          unmapped_values: ["Good overall balance, slight push on entry."],
          template_labels: ["CAMBER", "TOE", "HEIGHT", "WEIGHT"],
          quality_flags: [],
        },
        review_flags: ["Manual review required"],
        raw_text: "Alex G Sebring Fuel 42 Camber 3.8 4.0 3.3 3.7",
        extracted_text: "Alex G Sebring Fuel 42 Camber 3.8 4.0 3.3 3.7",
        summary: "Printed setup sheet parsed with upper and lower sections",
        recommended_review_status: "PENDING",
        parser_version: "ocr-v1",
        field_evidence: [
          {
            category: "alignment",
            key: "camber_fl",
            raw: "3.8",
            value: "3.8",
            unit: "",
            confidence: 0.74,
            needs_review: true,
            source: "layout_grid",
            inferred_from_layout: true,
          },
          {
            category: "session_context",
            key: "track_text",
            raw: TRACK_NAME,
            value: TRACK_NAME,
            unit: "",
            confidence: 0.74,
            needs_review: true,
            source: "ocr_text",
            inferred_from_layout: false,
          },
          {
            category: "post_session",
            key: "camber_text",
            raw: "3.6 / 3.8 / 3.1 / 3.5",
            value: "3.6 / 3.8 / 3.1 / 3.5",
            unit: "",
            confidence: 0.74,
            needs_review: true,
            source: "after_session_block",
            inferred_from_layout: false,
          },
        ],
        normalized_sections: {
          session_context: {
            driver_text: "Alex G",
            track_text: TRACK_NAME,
            session_text: "04/18/26 10:15 AM",
          },
          post_session: {
            camber_text: "3.6 / 3.8 / 3.1 / 3.5",
            toe_text: "0.08 out / 0.10 out / 0.04 in / 0.05 in",
            weight_text: "528 / 533 / 842 / 846",
            height_text: "80.2 / 81.3 / 121.1 / 120.9",
            shocks_text: "6 / 9 / 6 / 9",
            fuel_pumped_out_liters: "",
          },
        },
        preprocessing: { selected_variant: "cropped_paper" },
      }),
    });

    await page.goto(`/event/${EVENT_ID}/ocr-notes`);
    await page.getByTestId("ocr-submission-image-input").setInputFiles({
      name: "printed-form.png",
      mimeType: "image/png",
      buffer: QUICK_PHOTO,
    });

    await page.getByTestId("ocr-extract-button").click();
    await expect(page.getByLabel("Fuel (Liters)")).toBeVisible();
    await expect(page.getByLabel("Driver Weight (lbs)")).toBeVisible();
    await expect(page.getByLabel("Roll-Bar")).toBeVisible();
    await expect(page.getByText("Header / Session").first()).toBeVisible();
    const afterSessionTrigger = page.getByRole("button", { name: /After Session Set-Down & Notes/i });
    await expect(afterSessionTrigger).toBeVisible();
    await expect(afterSessionTrigger).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByLabel("After Session Camber")).not.toBeVisible();
    await expect(page.getByRole("button", { name: /Shock setup sheet/i })).not.toBeVisible();
  });

  test("ocr notes keep raw OCR text visible when parser fallback is used", async ({ page }) => {
    await mockSubmissionApp(page, {
      buildOcrPreviewResponse: () => ({
        status: "parser_failed_but_raw_text_available",
        message: "Parser failed, but raw OCR text is available.",
        doc_type: "unknown",
        confidence: 0.22,
        model_used: "gpt-5.5",
        fallback_used: true,
        metadata: {
          driver_text: "",
          track_text: TRACK_NAME,
          session_text: "Practice S1",
        },
        structured_data: {
          alignment: {},
          pressures: { cold: {}, hot: {} },
          suspension: {},
          shock_setup: { rr: {}, lr: {}, lf: {}, rf: {} },
          notes: ["Unmapped text preserved"],
        },
        raw_evidence: {
          visible_text: ["RH 102 101 100 99", "toe 1 out 2.5 in"],
          detected_grids: [],
          detected_labels: [],
          unmapped_values: ["toe 1 out 2.5 in"],
          quality_flags: ["parser_fallback"],
        },
        review_flags: ["Parser failed, raw OCR text preserved"],
        raw_text: "RH 102 101 100 99\ntoe 1 out 2.5 in",
        extracted_text: "RH 102 101 100 99",
        summary: "Parser fallback returned raw OCR text only",
        recommended_review_status: "PENDING",
        parser_version: "ocr-v1",
        field_evidence: [],
        normalized_sections: {},
        preprocessing: { selected_variant: "sharpened" },
      }),
    });

    await page.goto(`/event/${EVENT_ID}/ocr-notes`);
    await page.getByTestId("ocr-submission-image-input").setInputFiles({
      name: "parser-fallback.jpg",
      mimeType: "image/jpeg",
      buffer: QUICK_PHOTO,
    });

    await page.getByTestId("ocr-extract-button").click();
    const reviewBanner = page.getByTestId("ocr-review-required-banner");
    await expect(reviewBanner.getByText("Parser failed, but raw OCR text is available.")).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText("gpt-5.5").first()).toBeVisible();
    const rawOcrField = page
      .locator(".ocr-notes-field")
      .filter({ has: page.locator("label", { hasText: "Raw OCR Text" }) });
    await expect(rawOcrField.locator("textarea")).toHaveValue("RH 102 101 100 99\ntoe 1 out 2.5 in");
    await expect(page.getByTestId("ocr-review-sections")).toBeVisible();
  });

  test("ocr notes preserve the uploaded image and manual correction fields after extraction_failed", async ({
    page,
  }) => {
    await mockSubmissionApp(page, {
      buildOcrPreviewResponse: () => ({
        status: "extraction_failed",
        message: "OCR extraction did not return a safe draft.",
        doc_type: "unknown",
        confidence: 0,
        model_used: "gpt-5.4",
        fallback_used: true,
        metadata: {
          driver_text: "",
          track_text: TRACK_NAME,
          session_text: "",
        },
        structured_data: {
          alignment: {},
          pressures: { cold: {}, hot: {} },
          suspension: {},
          shock_setup: { rr: {}, lr: {}, lf: {}, rf: {} },
          notes: [],
        },
        raw_evidence: {
          visible_text: [],
          detected_grids: [],
          detected_labels: [],
          unmapped_values: [],
        },
        review_flags: ["Manual review required"],
        raw_text: "",
        extracted_text: "",
        summary: "",
        recommended_review_status: "PENDING",
        parser_version: "ocr-v1",
      }),
    });

    await page.goto(`/event/${EVENT_ID}/ocr-notes`);
    await page.getByTestId("ocr-submission-image-input").setInputFiles({
      name: "ocr-sheet.png",
      mimeType: "image/png",
      buffer: QUICK_PHOTO,
    });

    await page.getByTestId("ocr-extract-button").click();
    await expect(page.getByText("OCR service failed. Please retry or enter manually.")).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByAltText("OCR note preview")).toBeVisible();
    await expect(page.getByTestId("ocr-review-sections")).toBeVisible();
    await expect(page.getByLabel("RH FL")).toBeVisible();
    await expect(page.getByTestId("ocr-submit-review-button")).toBeDisabled();

    await page.getByLabel("RH FL").fill("102");
    await expect(page.getByTestId("ocr-submit-review-button")).toBeEnabled();
    await expect(page.getByTestId("ocr-extract-button")).toBeEnabled();
  });

  test("ocr notes show a clear disabled error when backend OCR is unavailable", async ({ page }) => {
    await mockSubmissionApp(page, {
      ocrPreviewError: {
        status: 503,
        code: "OCR_EXTRACTION_DISABLED",
        message: "OCR extraction is disabled because backend image analysis is not configured.",
        missingRequirements: ["OPENAI_API_KEY"],
      },
    });

    await page.goto(`/event/${EVENT_ID}/ocr-notes`);
    await page.getByTestId("ocr-submission-image-input").setInputFiles({
      name: "ocr-sheet.png",
      mimeType: "image/png",
      buffer: QUICK_PHOTO,
    });

    await page.getByTestId("ocr-extract-button").click();
    await expect(
      page.getByText(
        "OCR extraction is unavailable right now. Please try again later or use the typed notes flow.",
      ),
    ).toBeVisible({ timeout: 5000 });
    await expect(page.getByAltText("OCR note preview")).toBeVisible();
  });

  test("ocr notes support up to three source images for OCR review", async ({ page }) => {
    const requests = await mockSubmissionApp(page, {
      buildOcrPreviewResponse: (body) => ({
        status: "submitted_to_make",
        message: "Submitted to Make.com. Waiting for the OCR draft response.",
        submission_ref: "OCR-PREVIEW-MULTI-1",
        correlation_id: "corr-multi-1",
        source: "make.com",
        image_url: body.image_url ?? null,
        image_urls: body.image_urls ?? [],
        doc_type: "unknown",
        confidence: 0,
        model_used: "make.com",
        fallback_used: false,
        metadata: {},
        structured_data: {
          alignment: {},
          pressures: { cold: {}, hot: {} },
          suspension: {},
          shock_setup: { rr: {}, lr: {}, lf: {}, rf: {} },
          notes: [],
        },
        raw_evidence: {
          visible_text: [],
          detected_grids: [],
          detected_labels: [],
          unmapped_values: [],
        },
        review_flags: [],
        raw_text: "",
        extracted_text: "",
        summary: "Waiting for Make OCR callback",
        recommended_review_status: "PENDING",
        parser_version: "ocr-v1",
        model: "make.com",
      }),
    });

    await page.goto(`/event/${EVENT_ID}/ocr-notes`);
    await page.getByTestId("ocr-submission-image-input").setInputFiles([
      {
        name: "ocr-sheet-1.png",
        mimeType: "image/png",
        buffer: QUICK_PHOTO_RED,
      },
      {
        name: "ocr-sheet-2.png",
        mimeType: "image/png",
        buffer: QUICK_PHOTO_GREEN,
      },
      {
        name: "ocr-sheet-3.png",
        mimeType: "image/png",
        buffer: QUICK_PHOTO_BLUE,
      },
    ]);

    await expect(page.getByRole("img", { name: /^OCR note preview$/ })).toBeVisible();
    await expect(page.getByAltText("OCR note preview 2")).toBeVisible();
    await expect(page.getByAltText("OCR note preview 3")).toBeVisible();
    await expect(page.getByText("3 source images selected").first()).toBeVisible();

    await page.getByTestId("ocr-extract-button").click();
    await expect.poll(() => requests.ocrPreviewRequests.length).toBe(1);
    expect(requests.ocrPreviewRequests[0].image_url).toContain("data:image/png;base64,");
    expect(requests.ocrPreviewRequests[0].image_urls).toHaveLength(3);
    expect(requests.ocrPreviewRequests[0].image_urls[0]).toContain("data:image/png;base64,");
  });

  test("ocr review keeps sparse make payload values blank and submits missing fields as null", async ({
    page,
  }) => {
    const requests = await mockSubmissionApp(page, {
      buildOcrDraftStatusResponse: ({ correlationId }) => ({
        status: "review_required",
        message: "OCR draft needs review. Some values may be incomplete or uncertain.",
        submission_ref: "OCR-PREVIEW-SPARSE-1",
        correlation_id: correlationId || "corr-sparse-1",
        source: "make.com",
        doc_type: "printed_form_with_values",
        confidence: 0.9,
        model_used: "make.com",
        fallback_used: false,
        metadata: {
          driver_text: "N. Green",
          track_text: "N. Green",
          session_text: "04/18/26 | 2:40 AM | Grand-Am Rolex Series | Farnbacher-Loles Racing",
        },
        structured_data: {
          session: {
            date: "04/18/26",
            time: "2:40 AM",
            track: "N. Green",
            session_type: "",
            session_number: "",
            duration_min: "",
            driver_id: "",
            vehicle_id: "",
          },
          alignment: {
            rh_fl: "79.7",
            rh_fr: "80.8",
            rh_rl: "120.6",
            rh_rr: "120.3",
            ride_height_f: "",
            ride_height_r: "",
            camber_fl: "3.6",
            camber_fr: "",
            camber_rl: "",
            camber_rr: "",
            toe_fl: "0.08 OUT",
            toe_fr: "",
            toe_rl: "0.09 OUT",
            toe_rr: "",
            toe_front: "",
            toe_rear: "",
            caster_l: "",
            caster_r: "",
            rake_mm: "",
            wheelbase_mm: "",
          },
          pressures: {
            cold: { fl: "23", fr: "23.4", rl: "22", rr: "22.3" },
            hot: { fl: "", fr: "", rl: "", rr: "" },
          },
          suspension: {},
          sheet_fields: {
            fuel_liters: "36",
            driver_weight_lbs: "182",
            scale_weight_lbs: "",
            percentage_box_weight_lbs: "1274",
            cross_weight_percent: "49.8",
            roll_bar_text: "875 / 1025",
            spacer_text: "10",
            bump_text: "5",
            rebound_text: "8",
            springs_front: "875",
            springs_rear: "1025",
            bump_stops_front: "5",
            bump_stops_rear: "7",
            wheelbase_left_mm: "109.7",
            wheelbase_right_mm: "109.8",
            wing_rake_deg: "2",
            wing_angle_deg: "6",
            wing_gurney_mm: "10",
            wicker_text: "",
            specs_toe_text: "",
            corner_weight_text: "528 / 533 / 846 / 850",
            static_ride_height_text: "",
            bump_stop_height_text: "",
            arb_front_text: "",
            arb_rear_text: "",
            fuel_pumped_out_liters: "4",
            notes_block: "",
          },
          post_session: {
            camber_text: "",
            toe_text: "",
            weight_text: "",
            height_text: "",
            shocks_text: "",
          },
          shock_setup: { rr: {}, lr: {}, lf: {}, rf: {} },
          notes: ["Manual review required"],
        },
        raw_evidence: {
          visible_text: [
            "04/18/26 2:40 AM",
            "Grand-Am Rolex Series",
            "Farnbacher-Loles Racing",
            "N. Green",
          ],
          detected_grids: [],
          detected_labels: [],
          unmapped_values: [],
          quality_flags: [],
        },
        review_flags: ["Manual review required"],
        raw_text: "04/18/26 2:40 AM Grand-Am Rolex Series Farnbacher-Loles Racing N. Green",
        extracted_text: "04/18/26 2:40 AM Grand-Am Rolex Series Farnbacher-Loles Racing N. Green",
        summary: "Printed setup sheet parsed with sparse toe and camber capture",
        recommended_review_status: "PENDING",
        parser_version: "ocr-v1",
        model: "make.com",
      }),
    });

    await page.goto(`/event/${EVENT_ID}/ocr-review?correlation_id=corr-sparse-1&submission_ref=OCR-PREVIEW-SPARSE-1`);
    await expect(page.getByTestId("ocr-review-sections")).toBeVisible();
    await expect.poll(() => requests.ocrDraftStatusRequests.length).toBeGreaterThan(0);

    const reviewSnapshot = page.locator(".ocr-notes-review-list");
    await expect(reviewSnapshot.locator("li").nth(2)).toContainText("Optional");
    await expect(page.getByLabel("Toe FL")).toHaveValue("0.08 OUT");
    await expect(page.getByLabel("Toe FR")).toHaveValue("");
    await expect(page.getByLabel("Toe RL")).toHaveValue("0.09 OUT");
    await expect(page.getByLabel("Toe RR")).toHaveValue("");
    await expect(page.getByLabel("Camber FL")).toHaveValue("3.6");
    await expect(page.getByLabel("Camber FR")).toHaveValue("");
    await expect(page.getByLabel("Camber RL")).toHaveValue("");
    await expect(page.getByLabel("Camber RR")).toHaveValue("");
    await expect(page.getByLabel("RH FL")).toHaveValue("79.7");
    await expect(page.getByLabel("RH FR")).toHaveValue("80.8");

    await page.getByTestId("ocr-submit-review-button").click();
    await expect.poll(() => requests.length).toBe(1);

    expect(requests[0].payload.data.date).toBe("04/18/26");
    expect(requests[0].payload.data.time).toBe("2:40 AM");
    expect(requests[0].payload.data.track).toBe("N. Green");
    expect(requests[0].payload.data.session_type).toBeNull();
    expect(requests[0].payload.data.session_number).toBeNull();
    expect(requests[0].payload.data.alignment.toe_front).toBeNull();
    expect(requests[0].payload.data.alignment.toe_rear).toBeNull();
    expect(requests[0].payload.data.alignment.ride_height_f).toBeNull();
    expect(requests[0].payload.data.alignment.ride_height_r).toBeNull();
    expect(requests[0].analysis_result.image_analysis.setup.alignment.toe_fl).toBe("0.08 OUT");
    expect(requests[0].analysis_result.image_analysis.setup.alignment.toe_fr).toBeNull();
    expect(requests[0].analysis_result.image_analysis.setup.alignment.toe_rl).toBe("0.09 OUT");
    expect(requests[0].analysis_result.image_analysis.setup.alignment.toe_rr).toBeNull();
  });

  test("ocr review can submit an extracted draft even when the source image is no longer attached", async ({
    page,
  }) => {
    const requests = await mockSubmissionApp(page);

    await page.addInitScript(({ storageKey, draftPayload }) => {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          savedAt: new Date().toISOString(),
          draft: draftPayload,
        }),
      );
    }, {
      storageKey: "sm2:ocr-draft:event-1:user-1",
      draftPayload: {
        intakeState: {
          date: "2026-04-23",
          time: "15:31",
          track: TRACK_NAME,
          driver_id: "NG",
          vehicle_id: "NG-GT4-2025",
          session_type: "Practice",
          session_number: "3",
          duration_min: "30",
          notes: "",
        },
        reviewDraft: {
          status: "review_required",
          message: "",
          submissionRef: "OCR-PREVIEW-LOCAL-1",
          correlationId: "corr-local-1",
          source: "make.com",
          docType: "printed_form_with_values",
          templateName: "general_setup_note",
          confidence: 0.9,
          summary: "Setup sheet parsed",
          rawText: "RH front 80 rear 121",
          extractedText: "RH front 80 rear 121",
          recommendedReviewStatus: "PENDING",
          parserVersion: "ocr-v1",
          modelUsed: "make.com",
          fallbackUsed: false,
          model: "make.com",
          metadata: {
            driver_text: "Alex G",
            track_text: TRACK_NAME,
            session_text: "Practice / S1",
          },
          rawEvidence: {
            visible_text: [],
            detected_grids: [],
            detected_labels: [],
            unmapped_values: [],
            quality_flags: [],
            template_labels: [],
          },
          fieldEvidence: [],
          normalizedSections: {},
          preprocessing: {},
          reviewFlags: ["Manual review required"],
          parsedSession: {
            date: "2026-04-23",
            time: "15:31",
            track: TRACK_NAME,
            session_type: "Practice",
            session_number: "1",
            duration_min: "",
            driver_id: "NG",
            vehicle_id: "NG-GT4-2025",
          },
          alignment: {
            rh_fl: "80",
            rh_fr: "81",
            rh_rl: "121",
            rh_rr: "120.8",
            ride_height_f: "",
            ride_height_r: "",
            camber_fl: "3.8",
            camber_fr: "4.0",
            camber_rl: "3.3",
            camber_rr: "3.7",
            toe_fl: "0.10 out",
            toe_fr: "0.12 out",
            toe_rl: "0.05 in",
            toe_rr: "0.06 in",
            toe_front: "",
            toe_rear: "",
            caster_l: "",
            caster_r: "",
            rake_mm: "",
            wheelbase_mm: "",
          },
          pressures: {
            cold: { fl: "22.8", fr: "23.1", rl: "21.9", rr: "22.2" },
            hot: { fl: "", fr: "", rl: "", rr: "" },
          },
          suspension: {},
          tireTemperatures: {},
          sheetFields: {
            fuel_liters: "42",
            driver_weight_lbs: "178",
            scale_weight_lbs: "",
            percentage_box_weight_lbs: "",
            cross_weight_percent: "50.2",
            roll_bar_text: "900 / 1050",
            spacer_text: "8",
            bump_text: "6",
            rebound_text: "9",
            springs_front: "900",
            springs_rear: "1050",
            bump_stops_front: "6",
            bump_stops_rear: "8",
            wheelbase_left_mm: "109.8",
            wheelbase_right_mm: "109.9",
            wing_rake_deg: "2.5",
            wing_angle_deg: "7",
            wing_gurney_mm: "12",
            wicker_text: "",
            specs_toe_text: "",
            corner_weight_text: "531 / 536 / 848 / 853",
            static_ride_height_text: "",
            bump_stop_height_text: "",
            arb_front_text: "",
            arb_rear_text: "",
            fuel_pumped_out_liters: "",
            notes_block: "",
          },
          postSession: {
            camber_text: "",
            toe_text: "",
            weight_text: "",
            height_text: "",
            shocks_text: "",
          },
          shockSetup: {
            rr_position: "",
            rr_hsr: "",
            rr_lsr: "",
            rr_hsb: "",
            rr_lsb: "",
            rr_total_setup: "",
            lr_position: "",
            lr_hsr: "",
            lr_lsr: "",
            lr_hsb: "",
            lr_lsb: "",
            lr_total_setup: "",
            lf_position: "",
            lf_hsr: "",
            lf_lsr: "",
            lf_hsb: "",
            lf_lsb: "",
            lf_total_setup: "",
            rf_position: "",
            rf_hsr: "",
            rf_lsr: "",
            rf_hsb: "",
            rf_lsb: "",
            rf_total_setup: "",
          },
          notes: [],
        },
        imageAttachments: [],
        imageDataUrl: null,
        imageName: "",
        reviewDirty: false,
        workflowState: "extract_success",
      },
    });

    await page.goto(`/event/${EVENT_ID}/ocr-review?correlation_id=corr-local-1`);
    await expect(page.getByTestId("ocr-review-sections")).toBeVisible();
    await expect(
      page.getByText(
        "No source image is attached in this browser session. You can still submit this reviewed draft, and any empty OCR fields will be sent as null.",
      ),
    ).toBeVisible();

    await page.getByTestId("ocr-submit-review-button").click();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0].image_url).toBeUndefined();
    expect(requests[0].image_urls).toBeUndefined();
    expect(requests[0].payload.data.track).toBe(TRACK_NAME);
  });

  test("submission drawer keeps sparse OCR submissions aligned without null placeholders", async ({
    page,
  }) => {
    await mockSubmissionApp(page);

    const sparseSubmission = {
      id: "submission-preview-1",
      submission_ref: "OCR-SUB-1",
      correlation_id: "corr-preview-1",
      event_id: EVENT_ID,
      run_group_id: "run-group-1",
      created_by_id: "user-1",
      created_at: "2026-05-18T17:28:00.000Z",
      raw_text: "Flexible OCR setup payload adapted for review.",
      image_url: null,
      payload: {
        data: {
          date: "04/18/26",
          time: "2:40 AM",
          track: "N. Green",
          run_group: "BLUE",
          driver_id: null,
          vehicle_id: null,
          session_type: null,
          session_number: null,
          duration_min: null,
          pressures: {
            cold: { fl: 23, fr: 23.4, rl: 22, rr: 22.3 },
            hot: { fl: null, fr: null, rl: null, rr: null },
          },
          suspension: {},
          alignment: {
            camber_fl: 3.6,
            camber_fr: null,
            camber_rl: null,
            camber_rr: null,
            rake_mm: null,
          },
          extended_setup: {
            sheet_fields: {
              cross_weight_percent: "49.8",
            },
          },
        },
        ocr_review: {
          metadata: {
            driver_text: "N. Green",
            track_text: "N. Green",
          },
        },
      },
      analysis_result: {
        submission_mode: "detail",
        confidence: 0.9,
        image_analysis: {
          metadata: {
            driver_text: "N. Green",
            track_text: "N. Green",
          },
          setup: {
            sheet_fields: {
              cross_weight_percent: "49.8",
            },
          },
          summary: "Flexible OCR setup payload adapted for review.",
        },
      },
      status: "SENT",
      event: {
        id: EVENT_ID,
        name: "Sebring",
        track: TRACK_NAME,
        start_date: "2026-05-10T00:00:00.000Z",
        end_date: "2026-05-20T00:00:00.000Z",
        is_active: true,
      },
      run_group: {
        id: "run-group-1",
        event_id: EVENT_ID,
        normalized: "BLUE",
        raw_text: "BLUE",
      },
      driver: {
        id: "driver-1",
        driver_id: "NG",
        driver_name: "Nicolas Guigere",
        first_name: "Nicolas",
        last_name: "Guigere",
        is_active: true,
      },
      vehicle: {
        id: "vehicle-1",
        vehicle_id: "NG-GT4-2025",
        driver_id: "NG",
        make: "Porsche",
        model: "GT4 RS Clubsport",
        year: 2025,
        is_active: true,
      },
    };

    await page.route(`**/api/v1/submissions/event/${EVENT_ID}`, async (route) =>
      route.fulfill({
        json: {
          submissions: [sparseSubmission],
        },
      }),
    );
    await page.route(`**/api/v1/submissions/ocr-intake/event/${EVENT_ID}`, async (route) =>
      route.fulfill({
        json: {
          drafts: [],
        },
      }),
    );
    await page.route("**/api/v1/submissions/submission-preview-1", async (route) =>
      route.fulfill({
        json: {
          submission: sparseSubmission,
        },
      }),
    );

    await page.goto(`/event/${EVENT_ID}/submissions`);
    await expect(page.getByText("TRACK: N. Green")).toBeVisible();

    await page.getByRole("button", { name: "VIEW" }).click();
    await expect(page.getByRole("heading", { name: "Submission Preview" })).toBeVisible();

    const previewRoot = page.locator("#submission-preview-submission-preview-1");
    await expect(previewRoot).toContainText("N. Green");
    await expect(previewRoot).toContainText("Nicolas Guigere (NG)");
    await expect(previewRoot).toContainText("Porsche GT4 RS Clubsport (NG-GT4-2025)");
    await expect(previewRoot).toContainText("04/18/26 2:40 AM");
    await expect(previewRoot).toContainText("49.8%");
    await expect(previewRoot).not.toContainText("Run #1");
    await expect(previewRoot).not.toContainText("null min");
    await expect(previewRoot).not.toContainText("undefined%");
    await expect(previewRoot).not.toContainText("Pressure (undefined)");
  });

  test("ocr notes can save a local draft and submit the reviewed draft for review", async ({
    page,
  }) => {
    const requests = await mockSubmissionApp(page);

    await page.goto(`/event/${EVENT_ID}/ocr-notes`);
    await page.getByTestId("ocr-submission-image-input").setInputFiles({
      name: "ocr-sheet.png",
      mimeType: "image/png",
      buffer: QUICK_PHOTO,
    });
    await page.getByTestId("ocr-extract-button").click();
    await expect(page.getByTestId("ocr-review-sections")).toBeVisible();

    await page.getByTestId("ocr-save-draft-button").click();
    await expect(page.getByText("OCR draft saved locally on this device.")).toBeVisible({
      timeout: 5000,
    });
    await expect
      .poll(() =>
        page.evaluate(() => localStorage.getItem("sm2:ocr-draft:event-1:user-1")),
      )
      .not.toBeNull();

    await page.getByTestId("ocr-submit-review-button").click();
    await expect.poll(() => requests.length).toBe(1);
    await expect(page.getByRole("button", { name: /Open Submissions/i })).toBeVisible({
      timeout: 5000,
    });

    const body = requests[0];
    expect(body.image_url).toContain("data:image/png;base64,");
    expect(body.driver_id).toBe("NG");
    expect(body.vehicle_id).toBe("NG-GT4-2025");
    expect(body.analysis_result.force_review_staging).toBe(true);
    expect(body.analysis_result.image_analysis.document_type).toBe("handwritten_setup_grid");
    expect(body.analysis_result.image_analysis.model).toBe("gpt-5.4");
    expect(body.payload.data.driver_id).toBe("NG");
    expect(body.payload.data.vehicle_id).toBe("NG-GT4-2025");
    expect(body.payload.data.track).toBe(TRACK_NAME);
    expect(body.payload.ocr_review.review_flags).toEqual(["ambiguous handwriting"]);
  });

  test("existing submissions can be reopened and overwritten from the notes screen", async ({
    page,
  }) => {
    await mockSubmissionApp(page);

    const existingSubmission = {
      id: "submission-1",
      submission_ref: "SUB-1",
      correlation_id: "corr-1",
      event_id: EVENT_ID,
      run_group_id: "run-group-1",
      created_by_id: "user-1",
      raw_text: "Initial short note",
      image_url: null,
      payload: {
        data: {
          ...makeSessionData(),
          session_id: "20260423-1531-NG-S3",
        },
      },
      analysis_result: {
        submission_mode: "detail",
        has_structured_data: true,
        confidence: 0.91,
      },
      status: "SENT",
      structured_ingest_status: "saved",
      structured_ingest_warnings: [],
      event: {
        id: EVENT_ID,
        name: "Sebring",
        track: TRACK_NAME,
        start_date: "2026-05-10T00:00:00.000Z",
        end_date: "2026-05-20T00:00:00.000Z",
        is_active: true,
      },
      run_group: {
        id: "run-group-1",
        event_id: EVENT_ID,
        normalized: "BLUE",
        raw_text: "BLUE",
      },
      driver: {
        id: "driver-1",
        driver_id: "NG",
        first_name: "Nicolas",
        last_name: "GuigÃ¨re",
        driver_name: "Nicolas GuigÃ¨re",
        team_name: "Blue",
        is_active: true,
      },
      vehicle: {
        id: "vehicle-1",
        vehicle_id: "NG-GT4-2025",
        driver_id: "NG",
        make: "Porsche",
        model: "GT4 RS Clubsport",
        year: 2025,
        is_active: true,
      },
    };
    const overwriteRequests = [];

    await page.route("**/api/v1/submissions/submission-1", async (route) => {
      const request = route.request();
      if (request.method() === "GET") {
        return route.fulfill({ json: { submission: existingSubmission } });
      }

      if (request.method() === "PUT") {
        const body = request.postDataJSON();
        overwriteRequests.push(body);
        return route.fulfill({
          json: {
            submission: {
              ...existingSubmission,
              raw_text: body.raw_text,
              image_url: body.image_url,
              payload: body.payload,
              analysis_result: body.analysis_result,
              updated_at: new Date().toISOString(),
            },
          },
        });
      }

      return route.fulfill({ status: 200, json: {} });
    });

    await page.goto(`/event/${EVENT_ID}/notes?submissionId=submission-1&tab=detail`);
    await expect(page.getByText("Overwrite mode enabled.")).toBeVisible();
    await expect(page.getByTestId("detail-raw-notes")).toHaveValue("Initial short note");

    await page.getByTestId("detail-raw-notes").fill("Updated short note");
    await page.getByRole("button", { name: "Overwrite Notes" }).click();

    await expect(
      page.getByText("Notes overwritten successfully! Redirecting..."),
    ).toBeVisible();
    expect(overwriteRequests).toHaveLength(1);
    expect(overwriteRequests[0].raw_text).toBe("Updated short note");
    expect(overwriteRequests[0].payload.session_id).toBe("20260423-1531-NG-S3");
  });
});
