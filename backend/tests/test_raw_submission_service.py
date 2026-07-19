import unittest
from datetime import datetime, timezone
from types import SimpleNamespace

from app.services.raw_submission_service import (
    RawSubmissionValidationError,
    build_raw_submission_payload,
    describe_raw_exception,
    parse_raw_note,
    resolve_driver_alias,
    resolve_vehicle_alias,
    validate_raw_submission_payload,
)


class RawSubmissionServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.captured_at = datetime(2026, 4, 30, 15, 45, tzinfo=timezone.utc)
        self.drivers = [
            SimpleNamespace(
                driver_id="JFB",
                driver_name="J-F Breton",
                first_name="J-F",
                last_name="Breton",
                aliases=["jf", "jeff"],
            ),
            SimpleNamespace(
                driver_id="JA",
                driver_name="Jean Audet",
                first_name="Jean",
                last_name="Audet",
                aliases=["jean"],
            ),
            SimpleNamespace(
                driver_id="NG",
                driver_name="Nicolas Guigere",
                first_name="Nicolas",
                last_name="Guigere",
                aliases=["nicolas", "nico"],
            ),
        ]
        self.vehicles = [
            SimpleNamespace(
                vehicle_id="JA-400Z-2025",
                driver_id="JA",
                make="Nissan",
                model="400Z",
                registration_number=None,
                vehicle_class=None,
            ),
            SimpleNamespace(
                vehicle_id="JA-997-2012",
                driver_id="JA",
                make="Porsche",
                model="997.2 Cup",
                registration_number=None,
                vehicle_class=None,
            ),
            SimpleNamespace(
                vehicle_id="JA-MICRA-2017",
                driver_id="JA",
                make="Nissan",
                model="Micra",
                registration_number=None,
                vehicle_class=None,
            ),
            SimpleNamespace(
                vehicle_id="JFB-GT4-2025",
                driver_id="JFB",
                make="Porsche",
                model="GT4 RS Clubsport",
                registration_number=None,
                vehicle_class=None,
            ),
            SimpleNamespace(
                vehicle_id="NG-GT4-2025",
                driver_id="NG",
                make="Porsche",
                model="GT4 RS Clubsport",
                registration_number=None,
                vehicle_class=None,
            ),
        ]

    def _build_submission(self, raw_text: str):
        parsed = parse_raw_note(raw_text)
        driver = resolve_driver_alias(self.drivers, parsed.driver_alias)
        driver_vehicles = [vehicle for vehicle in self.vehicles if vehicle.driver_id == driver.driver_id]
        vehicle = resolve_vehicle_alias(driver_vehicles, parsed.vehicle_alias)
        payload, analysis_result, id_seance = build_raw_submission_payload(
            parsed,
            driver_id=driver.driver_id,
            vehicle_id=vehicle.vehicle_id,
            track="Sebring International Raceway",
            run_group="RED",
            created_by="Alexandre",
            captured_at=self.captured_at,
            confidence=0.93,
        )
        errors = validate_raw_submission_payload(
            created_by="Alexandre",
            raw_text=raw_text,
            payload=payload,
            analysis_result=analysis_result,
        )
        self.assertEqual(errors, [])
        return parsed, driver, vehicle, payload, id_seance

    def test_required_sample_raw_notes_parse_into_structured_payloads(self) -> None:
        samples = [
            {
                "raw_text": "s1 30min nico gt4 Y-S3 pf 27 wb 2450",
                "driver_id": "NG",
                "vehicle_id": "NG-GT4-2025",
                "id_seance": "20260430-NG-S01",
                "assertions": lambda self, payload: (
                    self.assertEqual(payload["data"]["pressures"]["cold"], {"fl": 27.0, "fr": 27.0, "rl": 27.0, "rr": 27.0}),
                    self.assertEqual(payload["data"]["wheelbase_mm"], 2450.0),
                ),
            },
            {
                "raw_text": "s2 25min nico gt4 Y-S3 pf 26/26/27/27 pc 31/31/32/32",
                "driver_id": "NG",
                "vehicle_id": "NG-GT4-2025",
                "id_seance": "20260430-NG-S02",
                "assertions": lambda self, payload: (
                    self.assertEqual(payload["data"]["pressures"]["cold"]["rl"], 27.0),
                    self.assertEqual(payload["data"]["pressures"]["hot"]["rr"], 32.0),
                    self.assertNotIn("wheelbase_mm", payload["data"]),
                ),
            },
            {
                "raw_text": "s1 20min jf gt4 M-S2 pf 28/28/29/29 wb 2450",
                "driver_id": "JFB",
                "vehicle_id": "JFB-GT4-2025",
                "id_seance": "20260430-JFB-S01",
                "assertions": lambda self, payload: (
                    self.assertEqual(payload["data"]["tire_set"], "M-S2"),
                    self.assertEqual(payload["data"]["wheelbase_mm"], 2450.0),
                ),
            },
            {
                "raw_text": "s2 30min jf gt4 M-S2 pf 27/27/28/28 pc 32/32/33/33",
                "driver_id": "JFB",
                "vehicle_id": "JFB-GT4-2025",
                "id_seance": "20260430-JFB-S02",
                "assertions": lambda self, payload: (
                    self.assertEqual(payload["data"]["pressures"]["cold"]["fl"], 27.0),
                    self.assertEqual(payload["data"]["pressures"]["hot"]["rl"], 33.0),
                ),
            },
            {
                "raw_text": "s1 35min jean 997 P-S1 pf 26/26/27/27 wb 2350",
                "driver_id": "JA",
                "vehicle_id": "JA-997-2012",
                "id_seance": "20260430-JA-S01",
                "assertions": lambda self, payload: (
                    self.assertEqual(payload["data"]["vehicle_id"], "JA-997-2012"),
                    self.assertEqual(payload["data"]["wheelbase_mm"], 2350.0),
                ),
            },
            {
                "raw_text": "s2 25min jean 400z Y-S4 pf 27/27/28/28 pc 31/32/33/33",
                "driver_id": "JA",
                "vehicle_id": "JA-400Z-2025",
                "id_seance": "20260430-JA-S02",
                "assertions": lambda self, payload: (
                    self.assertEqual(payload["data"]["vehicle_id"], "JA-400Z-2025"),
                    self.assertEqual(payload["data"]["pressures"]["hot"]["fr"], 32.0),
                ),
            },
            {
                "raw_text": "s3 30min nicolas gt4 Y-S3 pf 26/26/27/27 c -3.2/-3.1/-2.8/-2.8",
                "driver_id": "NG",
                "vehicle_id": "NG-GT4-2025",
                "id_seance": "20260430-NG-S03",
                "assertions": lambda self, payload: (
                    self.assertEqual(payload["data"]["alignment"]["camber_fl"], -3.2),
                    self.assertEqual(payload["data"]["alignment"]["camber_rr"], -2.8),
                ),
            },
            {
                "raw_text": "s1 20min jeff gt4 M-S5 pf 28 pc 33 wb 2450",
                "driver_id": "JFB",
                "vehicle_id": "JFB-GT4-2025",
                "id_seance": "20260430-JFB-S01",
                "assertions": lambda self, payload: (
                    self.assertEqual(payload["data"]["pressures"]["cold"]["rr"], 28.0),
                    self.assertEqual(payload["data"]["pressures"]["hot"]["fl"], 33.0),
                ),
            },
            {
                "raw_text": "s2 30min jean micra P-S2 pf 24/24/25/25 best 1:42.300",
                "driver_id": "JA",
                "vehicle_id": "JA-MICRA-2017",
                "id_seance": "20260430-JA-S02",
                "assertions": lambda self, payload: (
                    self.assertEqual(payload["data"]["best_lap"], "1:42.300"),
                    self.assertEqual(payload["data"]["pressures"]["cold"]["rl"], 25.0),
                ),
            },
            {
                "raw_text": "s3 30min nico gt4 Y-S3 pf 26/26/27/27 rb 7/7/5/5 bp 4/4/3/3",
                "driver_id": "NG",
                "vehicle_id": "NG-GT4-2025",
                "id_seance": "20260430-NG-S03",
                "assertions": lambda self, payload: (
                    self.assertEqual(payload["data"]["suspension"]["rebound_rl"], 5),
                    self.assertEqual(payload["data"]["suspension"]["bump_rr"], 3),
                ),
            },
        ]

        for sample in samples:
            with self.subTest(raw_text=sample["raw_text"]):
                _, driver, vehicle, payload, id_seance = self._build_submission(sample["raw_text"])
                self.assertEqual(driver.driver_id, sample["driver_id"])
                self.assertEqual(vehicle.vehicle_id, sample["vehicle_id"])
                self.assertEqual(id_seance, sample["id_seance"])
                self.assertEqual(payload["schema_version"], "2.6.1")
                self.assertEqual(payload["action"], "ADD_SEANCE")
                self.assertEqual(payload["data"]["session_type"], "Practice")
                self.assertEqual(payload["data"]["time"], "00:00:00")
                sample["assertions"](self, payload)

    def test_raw_note_without_session_number_defaults_to_backend_session_one(self) -> None:
        parsed = parse_raw_note("30min nico gt4 Y-S3 pf 27 wb 2450")
        self.assertIsNone(parsed.session_number)

        driver = resolve_driver_alias(self.drivers, parsed.driver_alias)
        driver_vehicles = [vehicle for vehicle in self.vehicles if vehicle.driver_id == driver.driver_id]
        vehicle = resolve_vehicle_alias(driver_vehicles, parsed.vehicle_alias)
        payload, analysis_result, id_seance = build_raw_submission_payload(
            parsed,
            driver_id=driver.driver_id,
            vehicle_id=vehicle.vehicle_id,
            track="Sebring International Raceway",
            run_group="RED",
            created_by="Alexandre",
            captured_at=self.captured_at,
            confidence=0.93,
        )

        self.assertEqual(payload["data"]["session_number"], 1)
        self.assertEqual(id_seance, "20260430-NG-S01")
        self.assertEqual(analysis_result["confidence"], 0.93)

    def test_vehicle_alias_must_belong_to_driver(self) -> None:
        parsed = parse_raw_note("s1 20min jean gt4 Y-S3 pf 27")
        driver = resolve_driver_alias(self.drivers, parsed.driver_alias)
        driver_vehicles = [vehicle for vehicle in self.vehicles if vehicle.driver_id == driver.driver_id]

        with self.assertRaises(RawSubmissionValidationError) as context:
            resolve_vehicle_alias(driver_vehicles, parsed.vehicle_alias)

        self.assertEqual(context.exception.errors[0]["message"], "vehicle_id does not belong to driver_id")

    def test_describe_raw_exception_prefers_original_db_error(self) -> None:
        class FakeIntegrityError(Exception):
            def __init__(self) -> None:
                super().__init__("SQLAlchemy wrapper")
                self.orig = RuntimeError("duplicate key value violates unique constraint")

        context = describe_raw_exception(FakeIntegrityError())

        self.assertEqual(context["exception_type"], "FakeIntegrityError")
        self.assertEqual(context["original_exception_type"], "RuntimeError")
        self.assertEqual(
            context["display_message"],
            "FakeIntegrityError: RuntimeError: duplicate key value violates unique constraint",
        )


if __name__ == "__main__":
    unittest.main()
