from __future__ import annotations

import base64
import binascii
import io
import json
import logging
import re
import urllib.error
import urllib.request
from typing import Any

from app.core.config import get_ocr_config_status, get_settings
from app.models.driver import Driver
from app.models.event import Event
from app.models.run_group import RunGroup
from app.models.submission import Submission
from app.models.vehicle import Vehicle


logger = logging.getLogger(__name__)
IMAGE_ANALYSIS_SCHEMA_NAME = "sm_racing_image_analysis"
IMAGE_CLASSIFIER_SCHEMA_NAME = "sm_racing_image_classifier"
IMAGE_ANALYSIS_PARSER_VERSION = "ocr-v1"
OCR_PRIMARY_CONFIDENCE_THRESHOLD = 0.58
OCR_MIN_MEANINGFUL_FIELDS = 3
OCR_STATUS_SUCCESS = "success"
OCR_STATUS_PARTIAL_EXTRACTED = "partial_extracted"
OCR_STATUS_REVIEW_REQUIRED = "review_required"
OCR_STATUS_BLANK_TEMPLATE = "blank_template_detected"
OCR_STATUS_LOW_QUALITY = "low_quality_review_required"
OCR_STATUS_PARSER_FAILED_RAW = "parser_failed_but_raw_text_available"
OCR_STATUS_EXTRACTION_FAILED = "extraction_failed"
OCR_REVIEWABLE_STATUSES = {
    OCR_STATUS_PARTIAL_EXTRACTED,
    OCR_STATUS_REVIEW_REQUIRED,
    OCR_STATUS_BLANK_TEMPLATE,
    OCR_STATUS_LOW_QUALITY,
    OCR_STATUS_PARSER_FAILED_RAW,
}
SUPPORTED_IMAGE_MIME_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
}
OCR_REVIEW_FLAG_KEYWORDS = (
    "ambiguous",
    "unclear",
    "unreadable",
    "overwritten",
    "crossed-out",
    "crossed out",
    "uncertain",
    "low quality",
)
OCR_SEVERE_QUALITY_FLAG_KEYWORDS = (
    "unreadable",
    "low quality",
    "mostly unreadable",
    "too blurry",
)
OCR_DOCUMENT_TYPES = (
    "blank_setup_sheet",
    "handwritten_setup_grid",
    "printed_form_with_values",
    "shock_setup_sheet",
    "mixed_session_notes",
    "low_quality_review_required",
    "unknown",
)
PRINTED_FORM_PRIMARY_SHEET_FIELD_KEYS = (
    "fuel_liters",
    "driver_weight_lbs",
    "scale_weight_lbs",
    "percentage_box_weight_lbs",
    "cross_weight_percent",
    "roll_bar_text",
    "spacer_text",
    "bump_text",
    "rebound_text",
    "springs_front",
    "springs_rear",
    "bump_stops_front",
    "bump_stops_rear",
    "wheelbase_left_mm",
    "wheelbase_right_mm",
    "wing_rake_deg",
    "wing_angle_deg",
    "wing_gurney_mm",
    "wicker_text",
    "specs_toe_text",
    "corner_weight_text",
    "static_ride_height_text",
    "bump_stop_height_text",
    "arb_front_text",
    "arb_rear_text",
)
PRINTED_FORM_AFTER_SESSION_FIELD_KEYS = (
    "camber_text",
    "toe_text",
    "weight_text",
    "height_text",
    "shocks_text",
)
OCR_ABBREVIATION_MAP = {
    "RH": "ride_height",
    "R H": "ride_height",
    "R.H": "ride_height",
    "R.H.": "ride_height",
    "RH2": "ride_height_after",
    "RIDE HGT": "ride_height",
    "RIDE HEIGHT": "ride_height",
    "HEIGHT": "ride_height",
    "C": "camber",
    "CW": "corner_weight",
    "C.W": "corner_weight",
    "C.W.": "corner_weight",
    "C2": "camber_after",
    "CAMBER": "camber",
    "TOE": "toe",
    "IN": "toe_in",
    "OUT": "toe_out",
    "WB": "wheelbase",
    "WHEEL BASE": "wheelbase",
    "WHEELBASE": "wheelbase",
    "TP": "tire_pressure",
    "TIRE PRESSURE": "tire_pressure",
    "COLD": "cold_pressure",
    "HOT": "hot_pressure",
    "SHOCK": "shock_setup",
    "SHOCKS": "shock_setup",
    "RR": "rear_right",
    "LR": "rear_left",
    "LF": "left_front",
    "RF": "right_front",
    "HSR": "high_speed_rebound",
    "LSR": "low_speed_rebound",
    "HSB": "high_speed_bump",
    "HBS": "high_speed_bump",
    "LSB": "low_speed_bump",
    "LS": "low_speed_shock",
    "HS": "high_speed_shock",
    "BUMP": "bump",
    "REBOUND": "rebound",
    "PSI": "tire_pressure",
    "G": "fuel_gallons",
    "GAL": "fuel_gallons",
    "CROSS": "cross_weight",
    "ARB": "anti_roll_bar",
    "BAR": "anti_roll_bar",
    "ROLL BAR": "anti_roll_bar",
    "ROLL-BAR": "anti_roll_bar",
    "GURNEY": "rear_wing_flap",
    "WICKER": "rear_wing_flap",
}
DATA_URL_PATTERN = re.compile(r"^data:(?P<mime>[\w.+/-]+);base64,(?P<data>[A-Za-z0-9+/=\s]+)$", re.IGNORECASE)
DEFAULT_EXTRACTION_FAILED_MESSAGE = (
    "OCR extraction could not build a safe draft from this image. Retry with a clearer image or use manual correction."
)
OCR_REQUEST_MODE_STRICT = "strict_schema"
OCR_REQUEST_MODE_RELAXED = "json_object"

try:
    from PIL import Image, ImageEnhance, ImageFilter, ImageOps
except ImportError:  # pragma: no cover - exercised only when Pillow is unavailable in runtime
    Image = None
    ImageEnhance = None
    ImageFilter = None
    ImageOps = None


OCR_FIELD_EVIDENCE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "category": {"type": "string"},
        "key": {"type": "string"},
        "raw": {"type": "string"},
        "value": {"type": "string"},
        "unit": {"type": "string"},
        "confidence": {"type": "number"},
        "needs_review": {"type": "boolean"},
        "source": {"type": "string"},
        "inferred_from_layout": {"type": "boolean"},
    },
    "required": [
        "category",
        "key",
        "raw",
        "value",
        "unit",
        "confidence",
        "needs_review",
        "source",
        "inferred_from_layout",
    ],
}

IMAGE_CLASSIFIER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "document_type": {
            "type": "string",
            "enum": list(OCR_DOCUMENT_TYPES),
        },
        "template_name": {"type": "string"},
        "confidence": {"type": "number"},
        "has_values": {"type": "boolean"},
        "blocked_by_hand": {"type": "boolean"},
        "quality_flags": {"type": "array", "items": {"type": "string"}},
        "warnings": {"type": "array", "items": {"type": "string"}},
        "visible_text_hint": {"type": "string"},
    },
    "required": [
        "document_type",
        "template_name",
        "confidence",
        "has_values",
        "blocked_by_hand",
        "quality_flags",
        "warnings",
        "visible_text_hint",
    ],
}


IMAGE_ANALYSIS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "document_type": {
            "type": "string",
            "enum": list(OCR_DOCUMENT_TYPES),
        },
        "template_name": {"type": "string"},
        "confidence": {"type": "number"},
        "has_values": {"type": "boolean"},
        "summary": {"type": "string"},
        "extracted_text": {"type": "string"},
        "quality_flags": {"type": "array", "items": {"type": "string"}},
        "metadata": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "driver_text": {"type": "string"},
                "track_text": {"type": "string"},
                "session_text": {"type": "string"},
                "session_notes": {"type": "string"},
            },
            "required": ["driver_text", "track_text", "session_text", "session_notes"],
        },
        "raw_evidence": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "visible_text": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "detected_grids": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "label": {"type": "string"},
                            "canonical_label": {"type": "string"},
                            "top_left": {"type": "string"},
                            "top_right": {"type": "string"},
                            "bottom_left": {"type": "string"},
                            "bottom_right": {"type": "string"},
                            "note": {"type": "string"},
                        },
                        "required": [
                            "label",
                            "canonical_label",
                            "top_left",
                            "top_right",
                            "bottom_left",
                            "bottom_right",
                            "note",
                        ],
                    },
                },
                "detected_labels": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "label": {"type": "string"},
                            "canonical_label": {"type": "string"},
                            "note": {"type": "string"},
                        },
                        "required": ["label", "canonical_label", "note"],
                    },
                },
                "unmapped_values": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "quality_flags": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                "template_labels": {
                    "type": "array",
                    "items": {"type": "string"},
                },
            },
            "required": [
                "visible_text",
                "detected_grids",
                "detected_labels",
                "unmapped_values",
                "quality_flags",
                "template_labels",
            ],
        },
        "data_blocks": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "sequence_id": {"type": "integer"},
                    "label": {"type": "string"},
                    "coordinates_context": {"type": "string"},
                    "data": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "fl": {"type": "string"},
                            "fr": {"type": "string"},
                            "rl": {"type": "string"},
                            "rr": {"type": "string"},
                        },
                        "required": ["fl", "fr", "rl", "rr"],
                    },
                    "raw_text_found": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "fl": {"type": "string"},
                            "fr": {"type": "string"},
                            "rl": {"type": "string"},
                            "rr": {"type": "string"},
                        },
                        "required": ["fl", "fr", "rl", "rr"],
                    },
                    "adjustments_applied": {"type": "string"},
                },
                "required": [
                    "sequence_id",
                    "label",
                    "coordinates_context",
                    "data",
                    "raw_text_found",
                    "adjustments_applied",
                ],
            },
        },
        "unstructured_elements": {
            "type": "array",
            "items": {"type": "string"},
        },
        "field_evidence": {
            "type": "array",
            "items": OCR_FIELD_EVIDENCE_SCHEMA,
        },
        "setup": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "pressures": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "cold_fl": {"type": "string"},
                        "cold_fr": {"type": "string"},
                        "cold_rl": {"type": "string"},
                        "cold_rr": {"type": "string"},
                        "hot_fl": {"type": "string"},
                        "hot_fr": {"type": "string"},
                        "hot_rl": {"type": "string"},
                        "hot_rr": {"type": "string"},
                    },
                    "required": [
                        "cold_fl",
                        "cold_fr",
                        "cold_rl",
                        "cold_rr",
                        "hot_fl",
                        "hot_fr",
                        "hot_rl",
                        "hot_rr",
                    ],
                },
                "suspension": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "rebound_fl": {"type": "string"},
                        "rebound_fr": {"type": "string"},
                        "rebound_rl": {"type": "string"},
                        "rebound_rr": {"type": "string"},
                        "bump_fl": {"type": "string"},
                        "bump_fr": {"type": "string"},
                        "bump_rl": {"type": "string"},
                        "bump_rr": {"type": "string"},
                        "hsr_fl": {"type": "string"},
                        "hsr_fr": {"type": "string"},
                        "hsr_rl": {"type": "string"},
                        "hsr_rr": {"type": "string"},
                        "lsr_fl": {"type": "string"},
                        "lsr_fr": {"type": "string"},
                        "lsr_rl": {"type": "string"},
                        "lsr_rr": {"type": "string"},
                        "hsb_fl": {"type": "string"},
                        "hsb_fr": {"type": "string"},
                        "hsb_rl": {"type": "string"},
                        "hsb_rr": {"type": "string"},
                        "lsb_fl": {"type": "string"},
                        "lsb_fr": {"type": "string"},
                        "lsb_rl": {"type": "string"},
                        "lsb_rr": {"type": "string"},
                        "sway_bar_f": {"type": "string"},
                        "sway_bar_r": {"type": "string"},
                        "wing_angle_deg": {"type": "string"},
                    },
                    "required": [
                        "rebound_fl",
                        "rebound_fr",
                        "rebound_rl",
                        "rebound_rr",
                        "bump_fl",
                        "bump_fr",
                        "bump_rl",
                        "bump_rr",
                        "hsr_fl",
                        "hsr_fr",
                        "hsr_rl",
                        "hsr_rr",
                        "lsr_fl",
                        "lsr_fr",
                        "lsr_rl",
                        "lsr_rr",
                        "hsb_fl",
                        "hsb_fr",
                        "hsb_rl",
                        "hsb_rr",
                        "lsb_fl",
                        "lsb_fr",
                        "lsb_rl",
                        "lsb_rr",
                        "sway_bar_f",
                        "sway_bar_r",
                        "wing_angle_deg",
                    ],
                },
                "alignment": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "rh_fl": {"type": "string"},
                        "rh_fr": {"type": "string"},
                        "rh_rl": {"type": "string"},
                        "rh_rr": {"type": "string"},
                        "camber_fl": {"type": "string"},
                        "camber_fr": {"type": "string"},
                        "camber_rl": {"type": "string"},
                        "camber_rr": {"type": "string"},
                        "toe_fl": {"type": "string"},
                        "toe_fr": {"type": "string"},
                        "toe_rl": {"type": "string"},
                        "toe_rr": {"type": "string"},
                        "toe_front": {"type": "string"},
                        "toe_rear": {"type": "string"},
                        "caster_l": {"type": "string"},
                        "caster_r": {"type": "string"},
                        "ride_height_f": {"type": "string"},
                        "ride_height_r": {"type": "string"},
                        "rake_mm": {"type": "string"},
                        "wheelbase_mm": {"type": "string"},
                    },
                    "required": [
                        "rh_fl",
                        "rh_fr",
                        "rh_rl",
                        "rh_rr",
                        "camber_fl",
                        "camber_fr",
                        "camber_rl",
                        "camber_rr",
                        "toe_fl",
                        "toe_fr",
                        "toe_rl",
                        "toe_rr",
                        "toe_front",
                        "toe_rear",
                        "caster_l",
                        "caster_r",
                        "ride_height_f",
                        "ride_height_r",
                        "rake_mm",
                        "wheelbase_mm",
                    ],
                },
                "tire_temperatures": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "fl_in": {"type": "string"},
                        "fl_mid": {"type": "string"},
                        "fl_out": {"type": "string"},
                        "fr_in": {"type": "string"},
                        "fr_mid": {"type": "string"},
                        "fr_out": {"type": "string"},
                        "rl_in": {"type": "string"},
                        "rl_mid": {"type": "string"},
                        "rl_out": {"type": "string"},
                        "rr_in": {"type": "string"},
                        "rr_mid": {"type": "string"},
                        "rr_out": {"type": "string"},
                    },
                    "required": [
                        "fl_in",
                        "fl_mid",
                        "fl_out",
                        "fr_in",
                        "fr_mid",
                        "fr_out",
                        "rl_in",
                        "rl_mid",
                        "rl_out",
                        "rr_in",
                        "rr_mid",
                        "rr_out",
                    ],
                },
                "sheet_fields": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "fuel_liters": {"type": "string"},
                        "driver_weight_lbs": {"type": "string"},
                        "scale_weight_lbs": {"type": "string"},
                        "percentage_box_weight_lbs": {"type": "string"},
                        "cross_weight_percent": {"type": "string"},
                        "roll_bar_text": {"type": "string"},
                        "spacer_text": {"type": "string"},
                        "bump_text": {"type": "string"},
                        "rebound_text": {"type": "string"},
                        "springs_front": {"type": "string"},
                        "springs_rear": {"type": "string"},
                        "bump_stops_front": {"type": "string"},
                        "bump_stops_rear": {"type": "string"},
                        "wheelbase_left_mm": {"type": "string"},
                        "wheelbase_right_mm": {"type": "string"},
                        "wing_rake_deg": {"type": "string"},
                        "wing_angle_deg": {"type": "string"},
                        "wing_gurney_mm": {"type": "string"},
                        "wicker_text": {"type": "string"},
                        "specs_toe_text": {"type": "string"},
                        "corner_weight_text": {"type": "string"},
                        "static_ride_height_text": {"type": "string"},
                        "bump_stop_height_text": {"type": "string"},
                        "arb_front_text": {"type": "string"},
                        "arb_rear_text": {"type": "string"},
                        "fuel_pumped_out_liters": {"type": "string"},
                        "notes_block": {"type": "string"},
                    },
                    "required": [
                        "fuel_liters",
                        "driver_weight_lbs",
                        "scale_weight_lbs",
                        "percentage_box_weight_lbs",
                        "cross_weight_percent",
                        "roll_bar_text",
                        "spacer_text",
                        "bump_text",
                        "rebound_text",
                        "springs_front",
                        "springs_rear",
                        "bump_stops_front",
                        "bump_stops_rear",
                        "wheelbase_left_mm",
                        "wheelbase_right_mm",
                        "wing_rake_deg",
                        "wing_angle_deg",
                        "wing_gurney_mm",
                        "wicker_text",
                        "specs_toe_text",
                        "corner_weight_text",
                        "static_ride_height_text",
                        "bump_stop_height_text",
                        "arb_front_text",
                        "arb_rear_text",
                        "fuel_pumped_out_liters",
                        "notes_block",
                    ],
                },
                "post_session": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "camber_text": {"type": "string"},
                        "toe_text": {"type": "string"},
                        "weight_text": {"type": "string"},
                        "height_text": {"type": "string"},
                        "shocks_text": {"type": "string"},
                    },
                    "required": [
                        "camber_text",
                        "toe_text",
                        "weight_text",
                        "height_text",
                        "shocks_text",
                    ],
                },
                "shock_setup": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "rr": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "position": {"type": "string"},
                                "hsr": {"type": "string"},
                                "lsr": {"type": "string"},
                                "hsb": {"type": "string"},
                                "lsb": {"type": "string"},
                                "total_setup": {"type": "string"},
                            },
                            "required": ["position", "hsr", "lsr", "hsb", "lsb", "total_setup"],
                        },
                        "lr": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "position": {"type": "string"},
                                "hsr": {"type": "string"},
                                "lsr": {"type": "string"},
                                "hsb": {"type": "string"},
                                "lsb": {"type": "string"},
                                "total_setup": {"type": "string"},
                            },
                            "required": ["position", "hsr", "lsr", "hsb", "lsb", "total_setup"],
                        },
                        "lf": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "position": {"type": "string"},
                                "hsr": {"type": "string"},
                                "lsr": {"type": "string"},
                                "hsb": {"type": "string"},
                                "lsb": {"type": "string"},
                                "total_setup": {"type": "string"},
                            },
                            "required": ["position", "hsr", "lsr", "hsb", "lsb", "total_setup"],
                        },
                        "rf": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "position": {"type": "string"},
                                "hsr": {"type": "string"},
                                "lsr": {"type": "string"},
                                "hsb": {"type": "string"},
                                "lsb": {"type": "string"},
                                "total_setup": {"type": "string"},
                            },
                            "required": ["position", "hsr", "lsr", "hsb", "lsb", "total_setup"],
                        },
                    },
                    "required": ["rr", "lr", "lf", "rf"],
                },
                "notes": {
                    "type": "array",
                    "items": {"type": "string"},
                },
            },
            "required": [
                "pressures",
                "suspension",
                "alignment",
                "tire_temperatures",
                "sheet_fields",
                "post_session",
                "shock_setup",
                "notes",
            ],
        },
        "warnings": {"type": "array", "items": {"type": "string"}},
        "recommended_review_status": {
            "type": "string",
            "enum": ["PENDING", "APPROVED", "REJECTED", "CORRECTED"],
        },
    },
    "required": [
        "document_type",
        "template_name",
        "confidence",
        "has_values",
        "summary",
        "extracted_text",
        "quality_flags",
        "metadata",
        "raw_evidence",
        "data_blocks",
        "unstructured_elements",
        "field_evidence",
        "setup",
        "warnings",
        "recommended_review_status",
    ],
}


def _empty_alignment() -> dict[str, str]:
    return {
        "rh_fl": "",
        "rh_fr": "",
        "rh_rl": "",
        "rh_rr": "",
        "ride_height_f": "",
        "ride_height_r": "",
        "camber_fl": "",
        "camber_fr": "",
        "camber_rl": "",
        "camber_rr": "",
        "toe_fl": "",
        "toe_fr": "",
        "toe_rl": "",
        "toe_rr": "",
        "toe_front": "",
        "toe_rear": "",
        "caster_l": "",
        "caster_r": "",
        "rake_mm": "",
        "wheelbase_mm": "",
    }


def _empty_pressures() -> dict[str, str]:
    return {
        "cold_fl": "",
        "cold_fr": "",
        "cold_rl": "",
        "cold_rr": "",
        "hot_fl": "",
        "hot_fr": "",
        "hot_rl": "",
        "hot_rr": "",
    }


def _empty_suspension() -> dict[str, str]:
    return {
        "rebound_fl": "",
        "rebound_fr": "",
        "rebound_rl": "",
        "rebound_rr": "",
        "bump_fl": "",
        "bump_fr": "",
        "bump_rl": "",
        "bump_rr": "",
        "hsr_fl": "",
        "hsr_fr": "",
        "hsr_rl": "",
        "hsr_rr": "",
        "lsr_fl": "",
        "lsr_fr": "",
        "lsr_rl": "",
        "lsr_rr": "",
        "hsb_fl": "",
        "hsb_fr": "",
        "hsb_rl": "",
        "hsb_rr": "",
        "lsb_fl": "",
        "lsb_fr": "",
        "lsb_rl": "",
        "lsb_rr": "",
        "sway_bar_f": "",
        "sway_bar_r": "",
        "wing_angle_deg": "",
    }


def _empty_tire_temperatures() -> dict[str, str]:
    return {
        "fl_in": "",
        "fl_mid": "",
        "fl_out": "",
        "fr_in": "",
        "fr_mid": "",
        "fr_out": "",
        "rl_in": "",
        "rl_mid": "",
        "rl_out": "",
        "rr_in": "",
        "rr_mid": "",
        "rr_out": "",
    }


def _empty_sheet_fields() -> dict[str, str]:
    return {
        "fuel_liters": "",
        "driver_weight_lbs": "",
        "scale_weight_lbs": "",
        "percentage_box_weight_lbs": "",
        "cross_weight_percent": "",
        "roll_bar_text": "",
        "spacer_text": "",
        "bump_text": "",
        "rebound_text": "",
        "springs_front": "",
        "springs_rear": "",
        "bump_stops_front": "",
        "bump_stops_rear": "",
        "wheelbase_left_mm": "",
        "wheelbase_right_mm": "",
        "wing_rake_deg": "",
        "wing_angle_deg": "",
        "wing_gurney_mm": "",
        "wicker_text": "",
        "specs_toe_text": "",
        "corner_weight_text": "",
        "static_ride_height_text": "",
        "bump_stop_height_text": "",
        "arb_front_text": "",
        "arb_rear_text": "",
        "fuel_pumped_out_liters": "",
        "notes_block": "",
    }


def _empty_post_session() -> dict[str, str]:
    return {
        "camber_text": "",
        "toe_text": "",
        "weight_text": "",
        "height_text": "",
        "shocks_text": "",
    }


def _empty_shock_corner() -> dict[str, str]:
    return {
        "position": "",
        "hsr": "",
        "lsr": "",
        "hsb": "",
        "lsb": "",
        "total_setup": "",
    }


def _empty_shock_setup() -> dict[str, dict[str, str]]:
    return {
        "rr": _empty_shock_corner(),
        "lr": _empty_shock_corner(),
        "lf": _empty_shock_corner(),
        "rf": _empty_shock_corner(),
    }


def _empty_raw_evidence() -> dict[str, list[Any]]:
    return {
        "visible_text": [],
        "detected_grids": [],
        "detected_labels": [],
        "unmapped_values": [],
        "quality_flags": [],
        "template_labels": [],
    }


def _normalize_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def _normalize_float(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(number, 1.0))


def _normalize_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    text = _normalize_text(value).lower()
    if text in {"true", "1", "yes", "y"}:
        return True
    if text in {"false", "0", "no", "n"}:
        return False
    return default


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _normalize_notes(values: Any) -> list[str]:
    normalized: list[str] = []
    for entry in _list(values):
        text = _normalize_text(entry)
        if text and text not in normalized:
            normalized.append(text)
    return normalized


def _normalize_quality_flags(values: Any) -> list[str]:
    return _normalize_notes(values)


def _normalize_flags(values: Any) -> list[str]:
    normalized: list[str] = []
    for entry in _list(values):
        text = _normalize_text(entry)
        if text and text not in normalized:
            normalized.append(text)
    return normalized


def _append_warning(warnings: list[str], warning: str) -> None:
    text = _normalize_text(warning)
    if text and text not in warnings:
        warnings.append(text)


def _canonicalize_label(value: Any) -> str:
    normalized = re.sub(r"[^A-Z0-9]+", " ", _normalize_text(value).upper()).strip()
    if not normalized:
        return ""
    if re.fullmatch(r"RH\d+", normalized):
        return "ride_height_after"
    if re.fullmatch(r"C\d+", normalized):
        return "camber_after"
    return OCR_ABBREVIATION_MAP.get(normalized, normalized.lower())


def _normalize_block_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (int, float)):
        return str(value)
    return _normalize_text(value)


def _normalize_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _normalize_data_blocks(value: Any) -> list[dict[str, Any]]:
    normalized_blocks: list[dict[str, Any]] = []
    for index, entry in enumerate(_list(value), start=1):
        block = _dict(entry)
        label = _normalize_text(block.get("label"))
        coordinates_context = _normalize_text(block.get("coordinates_context"))
        data = _dict(block.get("data"))
        raw_text_found = _dict(block.get("raw_text_found"))

        normalized_block = {
            "sequence_id": _normalize_int(block.get("sequence_id"), index),
            "label": label,
            "canonical_label": _canonicalize_label(label),
            "coordinates_context": coordinates_context,
            "data": {
                "fl": _normalize_block_value(data.get("fl")),
                "fr": _normalize_block_value(data.get("fr")),
                "rl": _normalize_block_value(data.get("rl")),
                "rr": _normalize_block_value(data.get("rr")),
            },
            "raw_text_found": {
                "fl": _normalize_block_value(raw_text_found.get("fl")),
                "fr": _normalize_block_value(raw_text_found.get("fr")),
                "rl": _normalize_block_value(raw_text_found.get("rl")),
                "rr": _normalize_block_value(raw_text_found.get("rr")),
            },
            "adjustments_applied": _normalize_text(block.get("adjustments_applied")),
        }
        if (
            normalized_block["label"]
            or any(normalized_block["data"].values())
            or any(normalized_block["raw_text_found"].values())
            or normalized_block["adjustments_applied"]
        ):
            normalized_blocks.append(normalized_block)
    return normalized_blocks


def _normalize_raw_evidence(value: Any) -> dict[str, Any]:
    raw = _dict(value)
    normalized = _empty_raw_evidence()
    normalized["visible_text"] = _normalize_notes(raw.get("visible_text"))
    normalized["unmapped_values"] = _normalize_notes(raw.get("unmapped_values"))
    normalized["quality_flags"] = _normalize_quality_flags(raw.get("quality_flags"))
    normalized["template_labels"] = _normalize_notes(raw.get("template_labels"))

    detected_labels: list[dict[str, str]] = []
    for entry in _list(raw.get("detected_labels")):
        entry_map = _dict(entry)
        label = _normalize_text(entry_map.get("label") or entry)
        canonical_label = _normalize_text(entry_map.get("canonical_label")) or _canonicalize_label(label)
        note = _normalize_text(entry_map.get("note"))
        if label or canonical_label or note:
            detected_labels.append(
                {
                    "label": label,
                    "canonical_label": canonical_label,
                    "note": note,
                }
            )
    normalized["detected_labels"] = detected_labels

    detected_grids: list[dict[str, str]] = []
    for entry in _list(raw.get("detected_grids")):
        entry_map = _dict(entry)
        label = _normalize_text(entry_map.get("label"))
        canonical_label = _normalize_text(entry_map.get("canonical_label")) or _canonicalize_label(label)
        grid = {
            "label": label,
            "canonical_label": canonical_label,
            "top_left": _normalize_text(entry_map.get("top_left")),
            "top_right": _normalize_text(entry_map.get("top_right")),
            "bottom_left": _normalize_text(entry_map.get("bottom_left")),
            "bottom_right": _normalize_text(entry_map.get("bottom_right")),
            "note": _normalize_text(entry_map.get("note")),
        }
        if any(grid.values()):
            detected_grids.append(grid)
    normalized["detected_grids"] = detected_grids
    return normalized


def _merge_data_blocks_into_raw_evidence(
    *,
    raw_evidence: dict[str, Any],
    data_blocks: list[dict[str, Any]],
    warnings: list[str],
) -> None:
    for block in data_blocks:
        data = _dict(block.get("data"))
        raw_text_found = _dict(block.get("raw_text_found"))
        label = _normalize_text(block.get("label"))
        canonical_label = _normalize_text(block.get("canonical_label")) or _canonicalize_label(label)
        adjustments_applied = _normalize_text(block.get("adjustments_applied"))
        coordinates_context = _normalize_text(block.get("coordinates_context"))

        note_parts = [part for part in (coordinates_context, adjustments_applied) if part]
        if adjustments_applied and adjustments_applied.lower() not in {"none", "n/a"}:
            _append_warning(warnings, f"{label or canonical_label}: {adjustments_applied}")

        detected_grid = {
            "label": label,
            "canonical_label": canonical_label,
            "top_left": _normalize_text(data.get("fl")),
            "top_right": _normalize_text(data.get("fr")),
            "bottom_left": _normalize_text(data.get("rl")),
            "bottom_right": _normalize_text(data.get("rr")),
            "note": " | ".join(note_parts),
        }
        if any(detected_grid.values()):
            raw_evidence["detected_grids"].append(detected_grid)

        visible_values = [
            _normalize_text(raw_text_found.get("fl")) or _normalize_text(data.get("fl")),
            _normalize_text(raw_text_found.get("fr")) or _normalize_text(data.get("fr")),
            _normalize_text(raw_text_found.get("rl")) or _normalize_text(data.get("rl")),
            _normalize_text(raw_text_found.get("rr")) or _normalize_text(data.get("rr")),
        ]
        for piece in [label, coordinates_context, *visible_values]:
            if piece and piece not in raw_evidence["visible_text"]:
                raw_evidence["visible_text"].append(piece)


def _normalize_doc_type(value: Any) -> str:
    doc_type = _normalize_text(value)
    legacy_map = {
        "setup_sheet": "printed_form_with_values",
        "session_note": "mixed_session_notes",
        "schedule": "unknown",
    }
    if doc_type in legacy_map:
        return legacy_map[doc_type]
    if doc_type in OCR_DOCUMENT_TYPES:
        return doc_type
    return "unknown"


def _is_blankish_document(*, doc_type: str, raw_text: str, field_count: int, notes: list[str]) -> bool:
    return doc_type == "blank_setup_sheet" or (
        doc_type == "unknown" and not raw_text and field_count == 0 and not notes
    )


def _normalize_shock_corner(value: Any) -> dict[str, str]:
    raw = _dict(value)
    return {
        "position": _normalize_text(raw.get("position")),
        "hsr": _normalize_text(raw.get("hsr")),
        "lsr": _normalize_text(raw.get("lsr")),
        "hsb": _normalize_text(raw.get("hsb") or raw.get("hbs")),
        "lsb": _normalize_text(raw.get("lsb")),
        "total_setup": _normalize_text(raw.get("total_setup")),
    }


def _normalize_shock_setup(value: Any) -> dict[str, dict[str, str]]:
    raw = _dict(value)
    normalized = _empty_shock_setup()
    for corner in normalized:
        nested_corner = _dict(raw.get(corner))
        if nested_corner:
            normalized[corner] = _normalize_shock_corner(nested_corner)
            continue

        normalized[corner] = {
            "position": _normalize_text(raw.get(f"{corner}_position")),
            "hsr": _normalize_text(raw.get(f"{corner}_hsr")),
            "lsr": _normalize_text(raw.get(f"{corner}_lsr")),
            "hsb": _normalize_text(raw.get(f"{corner}_hsb") or raw.get(f"{corner}_hbs")),
            "lsb": _normalize_text(raw.get(f"{corner}_lsb")),
            "total_setup": _normalize_text(raw.get(f"{corner}_total_setup")),
        }
    return normalized


def _normalize_pressures(value: Any) -> dict[str, str]:
    raw = _dict(value)
    cold = _dict(raw.get("cold"))
    hot = _dict(raw.get("hot"))
    normalized = _empty_pressures()
    normalized["cold_fl"] = _normalize_text(raw.get("cold_fl") or cold.get("fl"))
    normalized["cold_fr"] = _normalize_text(raw.get("cold_fr") or cold.get("fr"))
    normalized["cold_rl"] = _normalize_text(raw.get("cold_rl") or cold.get("rl"))
    normalized["cold_rr"] = _normalize_text(raw.get("cold_rr") or cold.get("rr"))
    normalized["hot_fl"] = _normalize_text(raw.get("hot_fl") or hot.get("fl"))
    normalized["hot_fr"] = _normalize_text(raw.get("hot_fr") or hot.get("fr"))
    normalized["hot_rl"] = _normalize_text(raw.get("hot_rl") or hot.get("rl"))
    normalized["hot_rr"] = _normalize_text(raw.get("hot_rr") or hot.get("rr"))
    return normalized


def _normalize_alignment(value: Any) -> dict[str, str]:
    raw = _dict(value)
    normalized = _empty_alignment()
    normalized["ride_height_f"] = _normalize_text(raw.get("ride_height_f"))
    normalized["ride_height_r"] = _normalize_text(raw.get("ride_height_r"))
    normalized["rh_fl"] = _normalize_text(raw.get("rh_fl"))
    normalized["rh_fr"] = _normalize_text(raw.get("rh_fr"))
    normalized["rh_rl"] = _normalize_text(raw.get("rh_rl"))
    normalized["rh_rr"] = _normalize_text(raw.get("rh_rr"))
    normalized["camber_fl"] = _normalize_text(raw.get("camber_fl"))
    normalized["camber_fr"] = _normalize_text(raw.get("camber_fr"))
    normalized["camber_rl"] = _normalize_text(raw.get("camber_rl"))
    normalized["camber_rr"] = _normalize_text(raw.get("camber_rr"))
    normalized["toe_front"] = _normalize_text(raw.get("toe_front"))
    normalized["toe_rear"] = _normalize_text(raw.get("toe_rear"))
    normalized["toe_fl"] = _normalize_text(raw.get("toe_fl"))
    normalized["toe_fr"] = _normalize_text(raw.get("toe_fr"))
    normalized["toe_rl"] = _normalize_text(raw.get("toe_rl"))
    normalized["toe_rr"] = _normalize_text(raw.get("toe_rr"))
    normalized["caster_l"] = _normalize_text(raw.get("caster_l"))
    normalized["caster_r"] = _normalize_text(raw.get("caster_r"))
    normalized["rake_mm"] = _normalize_text(raw.get("rake_mm"))
    normalized["wheelbase_mm"] = _normalize_text(raw.get("wheelbase_mm"))
    return normalized


def _normalize_string_map(value: Any, template: dict[str, str]) -> dict[str, str]:
    raw = _dict(value)
    normalized = template.copy()
    for key in normalized:
        normalized[key] = _normalize_text(raw.get(key))
    return normalized


def _field_unit_for(category: str, key: str) -> str:
    normalized_key = f"{category}.{key}".lower()
    if "pressure" in normalized_key or normalized_key.startswith("pressures"):
        return "psi"
    if any(token in normalized_key for token in ("weight", "corner_weight")):
        return "lbs"
    if any(token in normalized_key for token in ("ride_height", "wheelbase", "bump_stop", "rake_mm")):
        return "mm"
    if "fuel_liters" in normalized_key:
        return "liters"
    if "fuel_gallons" in normalized_key or normalized_key.endswith(".g"):
        return "gal"
    return ""


def _build_field_evidence_entry(
    *,
    category: str,
    key: str,
    raw: Any,
    value: Any,
    confidence: float,
    source: str,
    inferred_from_layout: bool = False,
    needs_review: bool = False,
) -> dict[str, Any] | None:
    normalized_value = _normalize_text(value)
    normalized_raw = _normalize_text(raw) or normalized_value
    if not normalized_value and not normalized_raw:
        return None

    return {
        "category": category,
        "key": key,
        "raw": normalized_raw,
        "value": normalized_value,
        "unit": _field_unit_for(category, key),
        "confidence": confidence,
        "needs_review": bool(needs_review),
        "source": source,
        "inferred_from_layout": bool(inferred_from_layout),
    }


def _normalize_field_evidence(values: Any) -> list[dict[str, Any]]:
    normalized_entries: list[dict[str, Any]] = []
    for entry in _list(values):
        item = _dict(entry)
        category = _normalize_text(item.get("category"))
        key = _normalize_text(item.get("key"))
        if not category or not key:
            continue
        normalized_entry = _build_field_evidence_entry(
            category=category,
            key=key,
            raw=item.get("raw"),
            value=item.get("value"),
            confidence=_normalize_float(item.get("confidence")),
            source=_normalize_text(item.get("source")) or "ocr",
            inferred_from_layout=_normalize_bool(item.get("inferred_from_layout")),
            needs_review=_normalize_bool(item.get("needs_review")),
        )
        if normalized_entry:
            normalized_entries.append(normalized_entry)
    return normalized_entries


def _append_field_evidence(
    field_evidence: list[dict[str, Any]],
    *,
    category: str,
    key: str,
    raw: Any,
    value: Any,
    confidence: float,
    source: str,
    inferred_from_layout: bool = False,
    needs_review: bool = False,
) -> None:
    entry = _build_field_evidence_entry(
        category=category,
        key=key,
        raw=raw,
        value=value,
        confidence=confidence,
        source=source,
        inferred_from_layout=inferred_from_layout,
        needs_review=needs_review,
    )
    if not entry:
        return

    if not any(existing["category"] == entry["category"] and existing["key"] == entry["key"] for existing in field_evidence):
        field_evidence.append(entry)


def _build_field_evidence_from_setup(
    *,
    setup: dict[str, Any],
    metadata: dict[str, Any],
    raw_evidence: dict[str, Any],
    confidence: float,
    needs_review: bool,
    notes: list[str],
) -> list[dict[str, Any]]:
    field_evidence = _normalize_field_evidence(setup.get("field_evidence"))
    evidence_confidence = confidence or 0.0

    alignment = _dict(setup.get("alignment"))
    for key in ("rh_fl", "rh_fr", "rh_rl", "rh_rr", "camber_fl", "camber_fr", "camber_rl", "camber_rr", "toe_fl", "toe_fr", "toe_rl", "toe_rr", "wheelbase_mm"):
        _append_field_evidence(
            field_evidence,
            category="alignment",
            key=key,
            raw=alignment.get(key),
            value=alignment.get(key),
            confidence=evidence_confidence,
            source="layout_grid",
            inferred_from_layout=key != "wheelbase_mm",
            needs_review=needs_review,
        )

    pressures = _dict(setup.get("pressures"))
    for key in ("cold_fl", "cold_fr", "cold_rl", "cold_rr", "hot_fl", "hot_fr", "hot_rl", "hot_rr"):
        _append_field_evidence(
            field_evidence,
            category="tire_pressure",
            key=key,
            raw=pressures.get(key),
            value=pressures.get(key),
            confidence=evidence_confidence,
            source="ocr_text",
            needs_review=needs_review,
        )

    suspension = _dict(setup.get("suspension"))
    for key, value in suspension.items():
        _append_field_evidence(
            field_evidence,
            category="shocks",
            key=key,
            raw=value,
            value=value,
            confidence=evidence_confidence,
            source="shock_table" if "hs" in key or "ls" in key else "ocr_text",
            needs_review=needs_review,
        )

    sheet_fields = _dict(setup.get("sheet_fields"))
    for key, value in sheet_fields.items():
        category = "notes"
        if "spring" in key:
            category = "springs"
        elif "arb" in key or "bar" in key:
            category = "anti_roll_bar"
        elif "wing" in key or "gurney" in key or "wicker" in key:
            category = "wing"
        elif "wheelbase" in key:
            category = "wheel_base"
        elif "bump_stop" in key:
            category = "bump_stops"
        elif "weight" in key:
            category = "corner_weight"
        elif "fuel" in key:
            category = "session_context"

        _append_field_evidence(
            field_evidence,
            category=category,
            key=key,
            raw=value,
            value=value,
            confidence=evidence_confidence,
            source="template_field",
            needs_review=needs_review,
        )

    post_session = _dict(setup.get("post_session"))
    for key, value in post_session.items():
        _append_field_evidence(
            field_evidence,
            category="post_session",
            key=key,
            raw=value,
            value=value,
            confidence=evidence_confidence,
            source="after_session_block",
            needs_review=needs_review,
        )

    shock_setup = _dict(setup.get("shock_setup"))
    for corner, values in shock_setup.items():
        for key, value in _dict(values).items():
            _append_field_evidence(
                field_evidence,
                category="shocks",
                key=f"{corner}_{key}",
                raw=value,
                value=value,
                confidence=evidence_confidence,
                source="shock_table",
                needs_review=needs_review,
            )

    for metadata_key in ("driver_text", "track_text", "session_text"):
        _append_field_evidence(
            field_evidence,
            category="session_context",
            key=metadata_key,
            raw=metadata.get(metadata_key),
            value=metadata.get(metadata_key),
            confidence=evidence_confidence,
            source="ocr_text",
            needs_review=needs_review,
        )

    for note_index, note in enumerate(notes, start=1):
        _append_field_evidence(
            field_evidence,
            category="notes",
            key=f"note_{note_index}",
            raw=note,
            value=note,
            confidence=evidence_confidence,
            source="freeform_note",
            needs_review=needs_review,
        )

    for value_index, value in enumerate(raw_evidence.get("unmapped_values", []), start=1):
        _append_field_evidence(
            field_evidence,
            category="unmapped_values",
            key=f"value_{value_index}",
            raw=value,
            value=value,
            confidence=evidence_confidence,
            source="raw_evidence",
            needs_review=True,
        )

    return field_evidence


def _build_normalized_sections(
    *,
    setup: dict[str, Any],
    metadata: dict[str, Any],
    raw_evidence: dict[str, Any],
    notes: list[str],
) -> dict[str, Any]:
    alignment = _dict(setup.get("alignment"))
    sheet_fields = _dict(setup.get("sheet_fields"))
    suspension = _dict(setup.get("suspension"))
    shock_setup = _dict(setup.get("shock_setup"))
    post_session = _dict(setup.get("post_session"))

    return {
        "session_context": {
            "driver_text": _normalize_text(metadata.get("driver_text")),
            "track_text": _normalize_text(metadata.get("track_text")),
            "session_text": _normalize_text(metadata.get("session_text")),
        },
        "tire_pressure": _dict(setup.get("pressures")),
        "camber": {key: alignment.get(key, "") for key in ("camber_fl", "camber_fr", "camber_rl", "camber_rr")},
        "toe": {
            key: alignment.get(key, "")
            for key in ("toe_fl", "toe_fr", "toe_rl", "toe_rr", "toe_front", "toe_rear")
        },
        "ride_height": {
            key: alignment.get(key, "")
            for key in ("rh_fl", "rh_fr", "rh_rl", "rh_rr", "ride_height_f", "ride_height_r")
        },
        "corner_weight": {
            "scale_weight_lbs": _normalize_text(sheet_fields.get("scale_weight_lbs")),
            "percentage_box_weight_lbs": _normalize_text(sheet_fields.get("percentage_box_weight_lbs")),
            "cross_weight_percent": _normalize_text(sheet_fields.get("cross_weight_percent")),
            "corner_weight_text": _normalize_text(sheet_fields.get("corner_weight_text")),
        },
        "shocks": {
            **suspension,
            "shock_setup": shock_setup,
        },
        "springs": {
            "front": _normalize_text(sheet_fields.get("springs_front")),
            "rear": _normalize_text(sheet_fields.get("springs_rear")),
        },
        "anti_roll_bar": {
            "front": _normalize_text(sheet_fields.get("arb_front_text") or suspension.get("sway_bar_f")),
            "rear": _normalize_text(sheet_fields.get("arb_rear_text") or suspension.get("sway_bar_r")),
            "roll_bar_text": _normalize_text(sheet_fields.get("roll_bar_text")),
        },
        "wing": {
            "rake_deg": _normalize_text(sheet_fields.get("wing_rake_deg") or alignment.get("rake_mm")),
            "angle_deg": _normalize_text(sheet_fields.get("wing_angle_deg") or suspension.get("wing_angle_deg")),
            "gurney_mm": _normalize_text(sheet_fields.get("wing_gurney_mm")),
            "wicker": _normalize_text(sheet_fields.get("wicker_text")),
        },
        "wheel_base": {
            "wheelbase_mm": _normalize_text(alignment.get("wheelbase_mm")),
            "left_mm": _normalize_text(sheet_fields.get("wheelbase_left_mm")),
            "right_mm": _normalize_text(sheet_fields.get("wheelbase_right_mm")),
        },
        "bump_stops": {
            "front": _normalize_text(sheet_fields.get("bump_stops_front")),
            "rear": _normalize_text(sheet_fields.get("bump_stops_rear")),
            "height_text": _normalize_text(sheet_fields.get("bump_stop_height_text")),
        },
        "post_session": {
            **post_session,
            "fuel_pumped_out_liters": _normalize_text(sheet_fields.get("fuel_pumped_out_liters")),
        },
        "notes": notes,
        "unmapped_values": raw_evidence.get("unmapped_values", []),
    }


def _count_meaningful_fields(setup: dict[str, Any], notes: list[str], raw_text: str) -> int:
    total = 0
    for group_key in ("alignment", "pressures", "suspension", "tire_temperatures", "sheet_fields", "post_session"):
        group = _dict(setup.get(group_key))
        total += sum(1 for value in group.values() if _normalize_text(value))

    shock_setup = _dict(setup.get("shock_setup"))
    for corner in ("rr", "lr", "lf", "rf"):
        total += sum(1 for value in _dict(shock_setup.get(corner)).values() if _normalize_text(value))

    if notes:
        total += len(notes)
    if raw_text:
        total += 1
    return total


def _count_non_empty_fields(group: dict[str, Any], keys: tuple[str, ...]) -> int:
    return sum(1 for key in keys if _normalize_text(group.get(key)))


def _count_printed_form_primary_fields(setup: dict[str, Any]) -> int:
    alignment = _dict(setup.get("alignment"))
    pressures = _dict(setup.get("pressures"))
    sheet_fields = _dict(setup.get("sheet_fields"))

    return (
        _count_non_empty_fields(
            alignment,
            (
                "rh_fl",
                "rh_fr",
                "rh_rl",
                "rh_rr",
                "ride_height_f",
                "ride_height_r",
                "camber_fl",
                "camber_fr",
                "camber_rl",
                "camber_rr",
                "toe_fl",
                "toe_fr",
                "toe_rl",
                "toe_rr",
                "toe_front",
                "toe_rear",
                "wheelbase_mm",
            ),
        )
        + _count_non_empty_fields(
            pressures,
            (
                "cold_fl",
                "cold_fr",
                "cold_rl",
                "cold_rr",
                "hot_fl",
                "hot_fr",
                "hot_rl",
                "hot_rr",
            ),
        )
        + _count_non_empty_fields(sheet_fields, PRINTED_FORM_PRIMARY_SHEET_FIELD_KEYS)
    )


def _count_printed_form_after_session_fields(setup: dict[str, Any]) -> int:
    sheet_fields = _dict(setup.get("sheet_fields"))
    post_session = _dict(setup.get("post_session"))
    return _count_non_empty_fields(post_session, PRINTED_FORM_AFTER_SESSION_FIELD_KEYS) + (
        1 if _normalize_text(sheet_fields.get("fuel_pumped_out_liters")) else 0
    )


def _has_strong_printed_form_layout(
    *,
    doc_type: str,
    classifier: dict[str, Any],
    raw_evidence: dict[str, Any],
    template_name: str,
) -> bool:
    if doc_type != "printed_form_with_values":
        return False

    classifier_confidence = _normalize_float(classifier.get("confidence"))
    template_label_count = len(raw_evidence.get("template_labels", []))
    return (
        classifier_confidence >= 0.7
        or template_label_count >= 3
        or bool(template_name)
    )


def _apply_corner_grid(
    alignment: dict[str, str],
    *,
    key_prefix: str,
    grid: dict[str, str],
    warnings: list[str],
    use_after_values: bool = False,
) -> None:
    existing_values = [
        alignment.get(f"{key_prefix}_fl", ""),
        alignment.get(f"{key_prefix}_fr", ""),
        alignment.get(f"{key_prefix}_rl", ""),
        alignment.get(f"{key_prefix}_rr", ""),
    ]
    incoming_values = [
        _normalize_text(grid.get("top_left")),
        _normalize_text(grid.get("top_right")),
        _normalize_text(grid.get("bottom_left")),
        _normalize_text(grid.get("bottom_right")),
    ]

    if use_after_values and any(existing_values) and any(incoming_values):
        _append_warning(warnings, "Before and after values detected; after value used.")

    if not any(incoming_values):
        return

    if use_after_values or not any(existing_values):
        alignment[f"{key_prefix}_fl"] = incoming_values[0]
        alignment[f"{key_prefix}_fr"] = incoming_values[1]
        alignment[f"{key_prefix}_rl"] = incoming_values[2]
        alignment[f"{key_prefix}_rr"] = incoming_values[3]


def _sync_alignment_rollups(alignment: dict[str, str]) -> None:
    if not _normalize_text(alignment.get("ride_height_f")):
        if alignment.get("rh_fl") and alignment.get("rh_fl") == alignment.get("rh_fr"):
            alignment["ride_height_f"] = alignment["rh_fl"]
    if not _normalize_text(alignment.get("ride_height_r")):
        if alignment.get("rh_rl") and alignment.get("rh_rl") == alignment.get("rh_rr"):
            alignment["ride_height_r"] = alignment["rh_rl"]
    if not _normalize_text(alignment.get("toe_front")):
        if alignment.get("toe_fl") and alignment.get("toe_fl") == alignment.get("toe_fr"):
            alignment["toe_front"] = alignment["toe_fl"]
    if not _normalize_text(alignment.get("toe_rear")):
        if alignment.get("toe_rl") and alignment.get("toe_rl") == alignment.get("toe_rr"):
            alignment["toe_rear"] = alignment["toe_rl"]


def _apply_raw_grid_mapping(
    *,
    alignment: dict[str, str],
    sheet_fields: dict[str, str],
    raw_evidence: dict[str, Any],
    warnings: list[str],
) -> None:
    for grid in raw_evidence.get("detected_grids", []):
        label = _normalize_text(grid.get("label"))
        canonical_label = _normalize_text(grid.get("canonical_label")) or _canonicalize_label(label)
        if not canonical_label:
            _append_warning(warnings, "Grid label could not be mapped confidently.")
            continue

        if canonical_label == "ride_height":
            _apply_corner_grid(alignment, key_prefix="rh", grid=grid, warnings=warnings)
        elif canonical_label == "ride_height_after":
            _apply_corner_grid(
                alignment,
                key_prefix="rh",
                grid=grid,
                warnings=warnings,
                use_after_values=True,
            )
        elif canonical_label == "camber":
            _apply_corner_grid(alignment, key_prefix="camber", grid=grid, warnings=warnings)
        elif canonical_label == "camber_after":
            _apply_corner_grid(
                alignment,
                key_prefix="camber",
                grid=grid,
                warnings=warnings,
                use_after_values=True,
            )
        elif canonical_label == "toe":
            _apply_corner_grid(alignment, key_prefix="toe", grid=grid, warnings=warnings)
        elif canonical_label == "wheelbase":
            wheelbase_candidates = [
                _normalize_text(grid.get("top_left")),
                _normalize_text(grid.get("top_right")),
                _normalize_text(grid.get("bottom_left")),
                _normalize_text(grid.get("bottom_right")),
            ]
            wheelbase_candidates = [candidate for candidate in wheelbase_candidates if candidate]
            if wheelbase_candidates:
                if not alignment.get("wheelbase_mm"):
                    alignment["wheelbase_mm"] = wheelbase_candidates[-1]
                if not sheet_fields.get("wheelbase_left_mm"):
                    sheet_fields["wheelbase_left_mm"] = wheelbase_candidates[0]
                if len(wheelbase_candidates) > 1 and not sheet_fields.get("wheelbase_right_mm"):
                    sheet_fields["wheelbase_right_mm"] = wheelbase_candidates[1]
        else:
            if grid.get("note"):
                _append_warning(warnings, f"Grid mapping uncertain for label '{label or canonical_label}'.")

    _sync_alignment_rollups(alignment)


def _derive_ocr_status(
    *,
    requested_status: str,
    doc_type: str,
    has_values: bool,
    confidence: float,
    field_count: int,
    primary_field_count: int = 0,
    layout_confident: bool = False,
    raw_text: str,
    raw_evidence: dict[str, Any],
    warnings: list[str],
) -> str:
    if requested_status == OCR_STATUS_EXTRACTION_FAILED or doc_type == OCR_STATUS_EXTRACTION_FAILED:
        return OCR_STATUS_EXTRACTION_FAILED

    if (
        doc_type == "blank_setup_sheet"
        and field_count == 0
        and (not has_values or raw_evidence.get("template_labels"))
    ):
        return OCR_STATUS_BLANK_TEMPLATE

    if requested_status == OCR_STATUS_PARSER_FAILED_RAW:
        return OCR_STATUS_PARSER_FAILED_RAW

    if doc_type == "low_quality_review_required":
        return OCR_STATUS_LOW_QUALITY

    raw_signal_count = len(raw_evidence.get("visible_text", [])) + len(raw_evidence.get("unmapped_values", []))

    if doc_type == "printed_form_with_values":
        if (
            primary_field_count >= max(OCR_MIN_MEANINGFUL_FIELDS * 2, 6)
            and layout_confident
            and raw_text
            and confidence >= 0.45
        ):
            return OCR_STATUS_PARTIAL_EXTRACTED if warnings else OCR_STATUS_SUCCESS

        if primary_field_count >= OCR_MIN_MEANINGFUL_FIELDS and (layout_confident or raw_text):
            return OCR_STATUS_PARTIAL_EXTRACTED

    if field_count >= OCR_MIN_MEANINGFUL_FIELDS and confidence >= OCR_PRIMARY_CONFIDENCE_THRESHOLD and raw_text:
        if warnings:
            return OCR_STATUS_PARTIAL_EXTRACTED
        return OCR_STATUS_SUCCESS

    if field_count > 0:
        return OCR_STATUS_PARTIAL_EXTRACTED

    if raw_text or raw_signal_count:
        return OCR_STATUS_REVIEW_REQUIRED

    if doc_type in OCR_DOCUMENT_TYPES:
        return OCR_STATUS_REVIEW_REQUIRED

    return OCR_STATUS_EXTRACTION_FAILED


def _status_message_for_status(status: str) -> str:
    if status == OCR_STATUS_SUCCESS:
        return "OCR draft ready. Review and correct the extracted setup values before submitting."
    if status == OCR_STATUS_PARTIAL_EXTRACTED:
        return "Partial OCR extracted. Please review highlighted fields."
    if status == OCR_STATUS_BLANK_TEMPLATE:
        return "Blank setup template detected. No handwritten values found."
    if status == OCR_STATUS_LOW_QUALITY:
        return "Low-quality image. Manual review is required."
    if status == OCR_STATUS_PARSER_FAILED_RAW:
        return "Parser failed, but raw OCR text is available."
    if status == OCR_STATUS_EXTRACTION_FAILED:
        return "OCR service failed. Please retry or enter manually."
    return "OCR draft needs review. Some values may be incomplete or uncertain."


def normalize_image_analysis_result(image_analysis: dict[str, Any] | None) -> dict[str, Any]:
    analysis = _dict(image_analysis)
    raw_setup = _dict(analysis.get("setup"))
    metadata = _dict(analysis.get("metadata"))
    classifier = _dict(analysis.get("classifier"))
    preprocessing = _dict(analysis.get("preprocessing"))
    raw_evidence = _normalize_raw_evidence(analysis.get("raw_evidence"))
    data_blocks = _normalize_data_blocks(analysis.get("data_blocks"))
    unstructured_elements = _normalize_notes(analysis.get("unstructured_elements"))
    requested_status = _normalize_text(analysis.get("status"))
    quality_flags = _normalize_quality_flags(analysis.get("quality_flags"))

    normalized_setup = {
        "alignment": _normalize_alignment(raw_setup.get("alignment")),
        "pressures": _normalize_pressures(raw_setup.get("pressures")),
        "suspension": _normalize_string_map(
            raw_setup.get("suspension") or raw_setup.get("suspensions"),
            _empty_suspension(),
        ),
        "tire_temperatures": _normalize_string_map(
            raw_setup.get("tire_temperatures"),
            _empty_tire_temperatures(),
        ),
        "sheet_fields": _normalize_string_map(raw_setup.get("sheet_fields"), _empty_sheet_fields()),
        "post_session": _normalize_string_map(raw_setup.get("post_session"), _empty_post_session()),
        "shock_setup": _normalize_shock_setup(raw_setup.get("shock_setup")),
        "notes": _normalize_notes(raw_setup.get("notes") or analysis.get("notes")),
    }

    doc_type = _normalize_doc_type(analysis.get("document_type") or classifier.get("document_type"))
    template_name = _normalize_text(analysis.get("template_name") or classifier.get("template_name"))
    blocked_by_hand = _normalize_bool(classifier.get("blocked_by_hand"))
    has_values = _normalize_bool(
        analysis.get("has_values"),
        default=_normalize_bool(classifier.get("has_values"), default=False),
    )
    extracted_text = _normalize_text(analysis.get("raw_text")) or _normalize_text(analysis.get("extracted_text"))
    if (
        not extracted_text
        and raw_evidence["visible_text"]
        and not (doc_type in {"blank_setup_sheet", "shock_setup_sheet"} and not has_values)
    ):
        extracted_text = "\n".join(raw_evidence["visible_text"])
    warnings = _normalize_flags(analysis.get("warnings"))
    confidence = _normalize_float(analysis.get("confidence"))

    for quality_flag in _normalize_quality_flags(classifier.get("quality_flags")) + quality_flags:
        if quality_flag not in raw_evidence["quality_flags"]:
            raw_evidence["quality_flags"].append(quality_flag)
        _append_warning(warnings, quality_flag)

    visible_text_hint = _normalize_text(classifier.get("visible_text_hint"))
    if visible_text_hint and visible_text_hint not in raw_evidence["template_labels"]:
        raw_evidence["template_labels"].append(visible_text_hint)

    for note in _normalize_notes(preprocessing.get("preprocessing_notes")):
        if note not in raw_evidence["quality_flags"]:
            raw_evidence["quality_flags"].append(note)

    if blocked_by_hand:
        _append_warning(warnings, "blocked_by_hand")

    if data_blocks:
        _merge_data_blocks_into_raw_evidence(
            raw_evidence=raw_evidence,
            data_blocks=data_blocks,
            warnings=warnings,
        )

    _apply_raw_grid_mapping(
        alignment=normalized_setup["alignment"],
        sheet_fields=normalized_setup["sheet_fields"],
        raw_evidence=raw_evidence,
        warnings=warnings,
    )

    if normalized_setup["notes"] == [] and raw_evidence["unmapped_values"]:
        normalized_setup["notes"] = raw_evidence["unmapped_values"]
    for note in unstructured_elements:
        if note not in normalized_setup["notes"]:
            normalized_setup["notes"].append(note)
        if note not in raw_evidence["unmapped_values"]:
            raw_evidence["unmapped_values"].append(note)

    if (
        not extracted_text
        and raw_evidence["visible_text"]
        and not (doc_type in {"blank_setup_sheet", "shock_setup_sheet"} and not has_values)
    ):
        extracted_text = "\n".join(raw_evidence["visible_text"])
    if not extracted_text and normalized_setup["notes"]:
        extracted_text = "\n".join(normalized_setup["notes"])

    field_count = _count_meaningful_fields(normalized_setup, normalized_setup["notes"], extracted_text)
    printed_form_primary_field_count = _count_printed_form_primary_fields(normalized_setup)
    printed_form_after_session_field_count = _count_printed_form_after_session_fields(normalized_setup)
    printed_form_layout_confident = _has_strong_printed_form_layout(
        doc_type=doc_type,
        classifier=classifier,
        raw_evidence=raw_evidence,
        template_name=template_name,
    )
    has_values = has_values or field_count > 0 or (
        bool(extracted_text) and doc_type not in {"blank_setup_sheet", "shock_setup_sheet"}
    )

    if requested_status != OCR_STATUS_EXTRACTION_FAILED and (not doc_type or doc_type == "unknown"):
        if _is_blankish_document(
            doc_type=doc_type,
            raw_text=extracted_text,
            field_count=field_count,
            notes=normalized_setup["notes"],
        ):
            doc_type = "blank_setup_sheet"
        elif field_count > 0:
            doc_type = "mixed_session_notes"
        else:
            doc_type = "unknown"

    if confidence < OCR_PRIMARY_CONFIDENCE_THRESHOLD and "low confidence extraction" not in warnings:
        warnings.append("low confidence extraction")

    if field_count == 0 and not extracted_text and "no readable setup values detected" not in warnings:
        warnings.append("no readable setup values detected")

    if field_count < OCR_MIN_MEANINGFUL_FIELDS:
        _append_warning(warnings, "Some values could not be mapped")

    flag_text = " ".join(warnings).lower()
    should_downgrade_for_quality = (
        requested_status not in {OCR_STATUS_EXTRACTION_FAILED, OCR_STATUS_BLANK_TEMPLATE}
        and doc_type not in {"blank_setup_sheet", "unknown"}
        and (
            confidence < OCR_PRIMARY_CONFIDENCE_THRESHOLD
            or any(keyword in flag_text for keyword in OCR_SEVERE_QUALITY_FLAG_KEYWORDS)
        )
    )
    if should_downgrade_for_quality:
        if not (
            doc_type == "printed_form_with_values"
            and printed_form_layout_confident
            and printed_form_primary_field_count >= OCR_MIN_MEANINGFUL_FIELDS
        ):
            doc_type = "low_quality_review_required"

    recommended_review_status = _normalize_text(analysis.get("recommended_review_status")) or "PENDING"
    if doc_type != "unknown":
        recommended_review_status = "PENDING"

    status = requested_status or _derive_ocr_status(
        requested_status=requested_status,
        doc_type=doc_type,
        has_values=has_values,
        confidence=confidence,
        field_count=field_count,
        primary_field_count=printed_form_primary_field_count,
        layout_confident=printed_form_layout_confident,
        raw_text=extracted_text,
        raw_evidence=raw_evidence,
        warnings=warnings,
    )
    if status in OCR_REVIEWABLE_STATUSES:
        _append_warning(warnings, "Manual review required")

    normalized_metadata = {
        "driver_text": _normalize_text(metadata.get("driver_text")),
        "track_text": _normalize_text(metadata.get("track_text")),
        "session_text": _normalize_text(metadata.get("session_text") or metadata.get("session_notes")),
    }
    field_evidence = _build_field_evidence_from_setup(
        setup=normalized_setup,
        metadata=normalized_metadata,
        raw_evidence=raw_evidence,
        confidence=confidence,
        needs_review=status != OCR_STATUS_SUCCESS,
        notes=normalized_setup["notes"],
    )
    normalized_sections = _build_normalized_sections(
        setup=normalized_setup,
        metadata=normalized_metadata,
        raw_evidence=raw_evidence,
        notes=normalized_setup["notes"],
    )

    return {
        "status": status,
        "document_type": doc_type,
        "template_name": template_name,
        "confidence": confidence,
        "has_values": has_values,
        "summary": _normalize_text(analysis.get("summary")),
        "extracted_text": extracted_text,
        "raw_text": extracted_text,
        "quality_flags": raw_evidence["quality_flags"],
        "metadata": normalized_metadata,
        "raw_evidence": raw_evidence,
        "data_blocks": data_blocks,
        "unstructured_elements": unstructured_elements,
        "field_evidence": field_evidence,
        "normalized_sections": normalized_sections,
        "setup": normalized_setup,
        "warnings": warnings,
        "recommended_review_status": recommended_review_status,
        "parser_version": _normalize_text(analysis.get("parser_version")) or IMAGE_ANALYSIS_PARSER_VERSION,
        "model": _normalize_text(analysis.get("model")),
        "fallback_model_used": bool(analysis.get("fallback_model_used")),
        "message": _normalize_text(analysis.get("message")) or _status_message_for_status(status),
        "blocked_by_hand": blocked_by_hand,
        "preprocessing": {
            "variant_used": _normalize_text(preprocessing.get("selected_variant")),
            "mime_type": _normalize_text(preprocessing.get("mime_type")),
            "size_bytes": preprocessing.get("size_bytes"),
            "width": preprocessing.get("width"),
            "height": preprocessing.get("height"),
            "notes": _normalize_notes(preprocessing.get("preprocessing_notes")),
        },
        "_field_count": field_count,
        "_printed_form_primary_field_count": printed_form_primary_field_count,
        "_printed_form_after_session_field_count": printed_form_after_session_field_count,
    }


def _should_retry_with_fallback(image_analysis: dict[str, Any], fallback_model: str | None) -> tuple[bool, str | None]:
    if not fallback_model:
        return False, None

    doc_type = _normalize_doc_type(image_analysis.get("document_type"))
    status = _normalize_text(image_analysis.get("status"))
    confidence = _normalize_float(image_analysis.get("confidence"))
    review_flags = _normalize_flags(image_analysis.get("warnings"))
    field_count = int(image_analysis.get("_field_count") or 0)
    raw_text = _normalize_text(image_analysis.get("raw_text"))
    has_values = _normalize_bool(image_analysis.get("has_values"), default=field_count > 0 or bool(raw_text))
    flag_text = " ".join(review_flags).lower()

    if status == OCR_STATUS_BLANK_TEMPLATE and doc_type in {"blank_setup_sheet", "shock_setup_sheet"}:
        return False, None
    if status == OCR_STATUS_PARSER_FAILED_RAW:
        return True, "primary_parser_failed_raw_text_available"
    if doc_type == "unknown":
        return True, "primary_unknown_doc_type"
    if doc_type == "low_quality_review_required":
        return True, "primary_marked_low_quality"
    if confidence < OCR_PRIMARY_CONFIDENCE_THRESHOLD:
        return True, "primary_low_confidence"
    if any(keyword in flag_text for keyword in OCR_REVIEW_FLAG_KEYWORDS):
        return True, "primary_high_ambiguity"
    if not raw_text and doc_type != "blank_setup_sheet":
        return True, "primary_missing_raw_text"
    if not has_values and doc_type not in {"blank_setup_sheet", "shock_setup_sheet"}:
        return True, "primary_missing_values"
    if doc_type not in {"blank_setup_sheet", "unknown"} and field_count < OCR_MIN_MEANINGFUL_FIELDS:
        return True, "primary_sparse_result"
    return False, None


def _parse_data_url(image_url: str) -> tuple[str, bytes] | None:
    match = DATA_URL_PATTERN.match(image_url.strip())
    if not match:
        return None

    try:
        decoded = base64.b64decode(match.group("data"), validate=True)
    except (ValueError, binascii.Error):
        return None

    return match.group("mime").lower(), decoded


def _png_dimensions(image_bytes: bytes) -> tuple[int | None, int | None]:
    if len(image_bytes) < 24 or not image_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return None, None
    return int.from_bytes(image_bytes[16:20], "big"), int.from_bytes(image_bytes[20:24], "big")


def _jpeg_dimensions(image_bytes: bytes) -> tuple[int | None, int | None]:
    if len(image_bytes) < 4 or image_bytes[:2] != b"\xff\xd8":
        return None, None

    index = 2
    while index + 9 < len(image_bytes):
        if image_bytes[index] != 0xFF:
            index += 1
            continue
        marker = image_bytes[index + 1]
        if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
            height = int.from_bytes(image_bytes[index + 5:index + 7], "big")
            width = int.from_bytes(image_bytes[index + 7:index + 9], "big")
            return width, height
        if index + 4 >= len(image_bytes):
            break
        segment_length = int.from_bytes(image_bytes[index + 2:index + 4], "big")
        if segment_length <= 0:
            break
        index += segment_length + 2
    return None, None


def _webp_dimensions(image_bytes: bytes) -> tuple[int | None, int | None]:
    if len(image_bytes) < 30 or image_bytes[:4] != b"RIFF" or image_bytes[8:12] != b"WEBP":
        return None, None

    chunk_type = image_bytes[12:16]
    if chunk_type == b"VP8X" and len(image_bytes) >= 30:
        width = int.from_bytes(image_bytes[24:27] + b"\x00", "little") + 1
        height = int.from_bytes(image_bytes[27:30] + b"\x00", "little") + 1
        return width, height
    return None, None


def _inspect_image_payload(image_url: str) -> dict[str, Any]:
    image_info = {
        "image_url": image_url,
        "mime_type": None,
        "size_bytes": None,
        "width": None,
        "height": None,
        "detail": "high",
        "preprocessing_notes": [],
    }
    parsed = _parse_data_url(image_url)
    if not parsed:
        return image_info

    mime_type, image_bytes = parsed
    image_info["mime_type"] = "image/jpeg" if mime_type == "image/jpg" else mime_type
    image_info["size_bytes"] = len(image_bytes)

    width, height = None, None
    if image_info["mime_type"] == "image/png":
        width, height = _png_dimensions(image_bytes)
    elif image_info["mime_type"] == "image/jpeg":
        width, height = _jpeg_dimensions(image_bytes)
    elif image_info["mime_type"] == "image/webp":
        width, height = _webp_dimensions(image_bytes)

    image_info["width"] = width
    image_info["height"] = height

    if image_info["size_bytes"] is not None and image_info["size_bytes"] < 1024:
        image_info["preprocessing_notes"].append("image payload is very small")
    if width is not None and height is not None and min(width, height) < 320:
        image_info["preprocessing_notes"].append("image resolution is very small")

    return image_info


def _mime_to_pillow_format(mime_type: str) -> str:
    if mime_type == "image/png":
        return "PNG"
    if mime_type == "image/webp":
        return "WEBP"
    return "JPEG"


def _image_to_data_url(image: Any, *, mime_type: str) -> str:
    output = io.BytesIO()
    save_kwargs: dict[str, Any] = {"format": _mime_to_pillow_format(mime_type)}
    if mime_type == "image/jpeg":
        save_kwargs.update({"quality": 92, "optimize": True})
        image = image.convert("RGB")
    image.save(output, **save_kwargs)
    encoded = base64.b64encode(output.getvalue()).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def _expand_bbox(bbox: tuple[int, int, int, int], width: int, height: int, padding: int = 16) -> tuple[int, int, int, int]:
    left, upper, right, lower = bbox
    return (
        max(0, left - padding),
        max(0, upper - padding),
        min(width, right + padding),
        min(height, lower + padding),
    )


def _crop_paper_area(image: Any) -> Any | None:
    if Image is None:
        return None

    grayscale = ImageOps.grayscale(image)
    bright_mask = grayscale.point(lambda px: 255 if px > 170 else 0)
    bbox = bright_mask.getbbox()
    if not bbox:
        return None

    expanded_bbox = _expand_bbox(bbox, image.width, image.height)
    bbox_width = expanded_bbox[2] - expanded_bbox[0]
    bbox_height = expanded_bbox[3] - expanded_bbox[1]
    bbox_area = bbox_width * bbox_height
    image_area = max(1, image.width * image.height)
    coverage = bbox_area / image_area
    if coverage < 0.28 or coverage > 0.98:
        return None

    cropped = image.crop(expanded_bbox)
    if cropped.width >= image.width and cropped.height >= image.height:
        return None

    return cropped


def _preprocess_image_payload(image_url: str) -> dict[str, Any]:
    image_info = _inspect_image_payload(image_url)
    result = {
        **image_info,
        "original_image_url": image_url,
        "selected_image_url": image_url,
        "selected_variant": "original",
        "variants": [{"name": "original", "image_url": image_url}],
        "valid": True,
        "error": None,
    }

    parsed = _parse_data_url(image_url)
    if not parsed:
        result["valid"] = False
        result["error"] = "Invalid image payload."
        return result

    mime_type, image_bytes = parsed
    normalized_mime = "image/jpeg" if mime_type == "image/jpg" else mime_type
    result["mime_type"] = normalized_mime
    result["size_bytes"] = len(image_bytes)

    if normalized_mime not in SUPPORTED_IMAGE_MIME_TYPES:
        result["valid"] = False
        result["error"] = f"Unsupported image type: {normalized_mime}."
        return result

    if Image is None:
        result["preprocessing_notes"].append("pillow unavailable; using original image")
        return result

    try:
        with Image.open(io.BytesIO(image_bytes)) as source_image:
            base_image = ImageOps.exif_transpose(source_image)
            if base_image.mode not in {"RGB", "L"}:
                base_image = base_image.convert("RGB")

            result["width"] = base_image.width
            result["height"] = base_image.height

            variants: list[tuple[str, Any]] = [("auto_rotated", base_image.copy())]

            cropped = _crop_paper_area(base_image)
            if cropped is not None:
                variants.append(("cropped_paper", cropped))

            grayscale = ImageOps.autocontrast(ImageOps.grayscale(cropped or base_image))
            variants.append(("high_contrast_grayscale", grayscale))
            variants.append(("sharpened", grayscale.filter(ImageFilter.SHARPEN)))

            chosen_name, chosen_image = variants[-1]
            result["selected_variant"] = chosen_name
            result["selected_image_url"] = _image_to_data_url(chosen_image, mime_type="image/png")
            result["variants"] = [{"name": "original", "image_url": image_url}]
            for variant_name, variant_image in variants:
                result["variants"].append(
                    {
                        "name": variant_name,
                        "image_url": _image_to_data_url(variant_image, mime_type="image/png"),
                    }
                )
    except OSError:
        if len(image_bytes) < 1024:
            result["preprocessing_notes"].append("image could not be opened; using original small payload")
            return result
        result["valid"] = False
        result["error"] = "Image could not be opened."
        return result

    return result


def _placeholder_analysis_from_raw_text(*, raw_text: str, model: str, warning: str) -> dict[str, Any]:
    lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
    return {
        "status": OCR_STATUS_PARSER_FAILED_RAW,
        "document_type": "low_quality_review_required",
        "template_name": "",
        "confidence": 0.2,
        "has_values": False,
        "summary": "Raw OCR text returned without a fully structured schema draft.",
        "raw_text": raw_text,
        "extracted_text": raw_text,
        "quality_flags": ["parser_failed"],
        "metadata": {
            "driver_text": "",
            "track_text": "",
            "session_text": "",
            "session_notes": "",
        },
        "raw_evidence": {
            "visible_text": lines,
            "detected_grids": [],
            "detected_labels": [],
            "unmapped_values": lines,
            "quality_flags": ["parser_failed"],
            "template_labels": [],
        },
        "data_blocks": [],
        "unstructured_elements": lines,
        "field_evidence": [],
        "setup": {},
        "warnings": [warning, "Manual review required", "Some values could not be mapped"],
        "recommended_review_status": "PENDING",
        "parser_version": IMAGE_ANALYSIS_PARSER_VERSION,
        "model": model,
    }


def _parse_model_payload(raw_text: str, model: str) -> dict[str, Any] | None:
    candidate = raw_text.strip()
    if not candidate:
        return None

    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        start = candidate.find("{")
        end = candidate.rfind("}")
        if start >= 0 and end > start:
            snippet = candidate[start : end + 1]
            try:
                return json.loads(snippet)
            except json.JSONDecodeError:
                logger.warning("OpenAI OCR returned non-normalizable JSON envelope for model=%s", model)
        logger.warning("OpenAI OCR returned unstructured text for model=%s; creating review-required placeholder", model)
        return _placeholder_analysis_from_raw_text(
            raw_text=raw_text,
            model=model,
            warning="Structured OCR mapping could not be parsed; raw OCR text preserved.",
        )


def _response_output_text(response_payload: dict[str, Any]) -> str:
    output_text = response_payload.get("output_text")
    if isinstance(output_text, str):
        return output_text

    pieces: list[str] = []
    for item in response_payload.get("output") or []:
        if not isinstance(item, dict):
            continue
        for content in item.get("content") or []:
            if not isinstance(content, dict):
                continue
            text_value = content.get("text")
            if isinstance(text_value, str):
                pieces.append(text_value)
    return "".join(pieces)


def _context_line(
    *,
    event: Event,
    run_group: RunGroup,
    driver: Driver | None,
    vehicle: Vehicle | None,
) -> str:
    return (
        f"Known context: event={event.name}, track={event.track}, run_group={run_group.raw_text}, "
        f"driver={driver.driver_id if driver else 'unknown'}, "
        f"vehicle={vehicle.vehicle_id if vehicle else 'unknown'}."
    )


def _build_classifier_prompt(
    *,
    event: Event,
    run_group: RunGroup,
    driver: Driver | None,
    vehicle: Vehicle | None,
) -> str:
    return (
        "Role: You are a racing document classifier for SM2 OCR. "
        "Classify the uploaded page before extraction. "
        "Return one JSON object only.\n"
        "Classify exactly one document_type from: "
        "blank_setup_sheet, printed_form_with_values, handwritten_setup_grid, shock_setup_sheet, "
        "mixed_session_notes, low_quality_review_required, unknown.\n"
        "Rules:\n"
        "- blank_setup_sheet: printed template only, no handwritten setup values.\n"
        "- printed_form_with_values: printed setup form with handwritten values in fields or grids.\n"
        "- handwritten_setup_grid: freeform handwritten page with 2x2 numeric grids or shorthand labels.\n"
        "- shock_setup_sheet: dedicated RR/LR/LF/RF shock table sheet.\n"
        "- mixed_session_notes: notebook page, sticky note, mixed handwriting, multiple evidence zones.\n"
        "- low_quality_review_required: blurry, shadowed, blocked, partially visible, or hard to read.\n"
        "- unknown: anything else.\n"
        "Also return template_name, confidence, has_values, blocked_by_hand, quality_flags, warnings, visible_text_hint.\n"
        "Use has_values=false if no handwritten or machine-filled setup values are visible.\n"
        f"{_context_line(event=event, run_group=run_group, driver=driver, vehicle=vehicle)}"
    )


def _document_specific_prompt_addendum(doc_type: str) -> str:
    if doc_type == "blank_setup_sheet":
        return (
            "Document-specific rules:\n"
            "- Detect template labels only.\n"
            "- Set has_values=false.\n"
            "- Do not invent setup values.\n"
            "- Preserve any visible template labels in raw_evidence.template_labels.\n"
        )
    if doc_type == "printed_form_with_values":
        return (
            "Document-specific rules:\n"
            "- This is a structured printed setup sheet with handwritten values.\n"
            "- Read it by zones instead of flattening the whole page at once.\n"
            "- Zone 1 header/session context: date, time, driver, track, and header/session labels.\n"
            "- Zone 2 upper/main setup block: map camber, toe, pressures, ride height, corner weight / weight / percentage, "
            "roll-bar, spacer, bump, rebound, fuel, driver weight, springs, bump-stops, wheel base, wing, and notes.\n"
            "- Zone 3 notes block: preserve the handwritten notes lines in setup.notes and sheet_fields.notes_block.\n"
            "- Zone 4 lower after-session block: map any values under 'After Session Set-Down' or similar labels into setup.post_session only.\n"
            "- Do not let lower after-session values overwrite the upper/main setup values.\n"
            "- Treat missing fields as empty, not failure.\n"
            "- Preserve field labels, nearby notes, and any unmatched printed-field values in raw_evidence and field_evidence.\n"
        )
    if doc_type == "handwritten_setup_grid":
        return (
            "Document-specific rules:\n"
            "- Focus on 2x2 numeric grids, nearby shorthand labels, and freeform notebook notes.\n"
            "- Preserve separate blocks like RH, RH2, C, C2, CW, TOE, WB.\n"
            "- If values are faint or partial, return raw evidence and partial mapped values.\n"
        )
    if doc_type == "shock_setup_sheet":
        return (
            "Document-specific rules:\n"
            "- Extract RR/LR/LF/RF shock table values for HSR, LSR, HSB/HBS, LSB, and total setup.\n"
            "- Preserve row/column labels even if values are sparse.\n"
            "- Blank shock sheets should still classify as shock_setup_sheet instead of failure.\n"
        )
    if doc_type == "mixed_session_notes":
        return (
            "Document-specific rules:\n"
            "- Extract main page notes, sticky-note values, duplicated evidence, and conflicts.\n"
            "- Preserve all visible numeric candidates in raw evidence and unmapped values.\n"
            "- Prefer review-safe partial extraction over aggressive mapping.\n"
        )
    if doc_type == "low_quality_review_required":
        return (
            "Document-specific rules:\n"
            "- Salvage only visible raw text and any highly confident numeric values.\n"
            "- Leave uncertain mapped fields empty.\n"
            "- Add review warnings instead of guessing.\n"
        )
    return (
        "Document-specific rules:\n"
        "- Unknown racing layout. Prefer raw evidence, visible labels, visible numbers, and review flags.\n"
        "- Do not fail simply because the layout is unfamiliar.\n"
    )


def _build_ocr_prompt(
    *,
    event: Event,
    run_group: RunGroup,
    driver: Driver | None,
    vehicle: Vehicle | None,
    doc_type: str = "unknown",
    request_mode: str = OCR_REQUEST_MODE_STRICT,
) -> str:
    prompt = (
        "Role: You are a senior computer-vision and racing telemetry digitization specialist. "
        "Your job is to convert handwritten or printed SM Racing setup sheets into a review-safe OCR draft "
        "with maximum numerical accuracy."
        "\n"
        "Method: deep scan and validate before mapping."
        "\n"
        "1. Spatial grid detection: find every 2x2 grid or quadrant block on the page."
        "\n"
        "2. Neighbor labeling: inspect nearby labels and shorthand such as RH, RH2, C, C2, TOE, WB, "
        "RIDE HGT, HSR, LSR, HSB, HBS, LSB, BUMP, REBOUND, RR, LR, LF, RF, ARB, ROLL-BAR."
        "\n"
        "3. Coordinate mapping rule is strict unless the page explicitly labels wheel positions differently: "
        "top-left=FL, top-right=FR, bottom-left=RL, bottom-right=RR."
        "\n"
        "4. Validation-first behavior: do not guess unclear values. If handwriting is ambiguous, preserve the "
        "raw text in raw_text_found, raw_evidence, or unstructured_elements and add review warnings."
        "\n"
        "5. Decimal fidelity: preserve all decimal points exactly."
        "\n"
        "6. Label fidelity: RH, RH2, RH3 or C, C2, C3 are separate chronological data blocks. "
        "Do not merge them during extraction. Preserve sequence in data_blocks."
        "\n"
        "7. Strike-through and modifier handling: if a value is crossed out or adjusted with visible arithmetic "
        "such as '+3' or '-2', use the corrected visible final value only when it is explicit. Summarize the "
        "operation in adjustments_applied. Never invent hidden math."
        "\n"
        "8. Document classification: classify exactly one of blank_setup_sheet, handwritten_setup_grid, "
        "printed_form_with_values, shock_setup_sheet, mixed_session_notes, low_quality_review_required, or unknown."
        "\n"
        "Output requirements:"
        "\n"
        "- Stage A raw evidence: fill raw_evidence with visible_text, detected_labels, detected_grids, and unmapped_values."
        "\n"
        "- Stage A verified blocks: fill data_blocks for every meaningful 2x2 data grid. Include sequence_id, label, "
        "coordinates_context, mapped fl/fr/rl/rr values, raw_text_found, and adjustments_applied."
        "\n"
        "- Stage B mapped schema: fill setup only for fields that are clearly supported by the evidence. Leave uncertain "
        "mapped fields empty rather than guessing."
        "\n"
        "- Preserve notebook text, fractions, circled values, margin notes, and unresolved items in unstructured_elements "
        "and extracted_text."
        "\n"
        "- If the page is blank, low quality, or partially readable, still return a review-safe draft instead of failing. "
        "Use warnings and recommended_review_status=PENDING."
        "\n"
        "- Also emit field_evidence entries for every extracted racing value using: category, key, raw, value, unit, "
        "confidence, needs_review, source, inferred_from_layout."
        "\n"
        "- Output JSON only."
        "\n\n"
        f"Classifier route: {doc_type}."
        "\n"
        f"{_document_specific_prompt_addendum(doc_type)}"
        "\n"
        f"{_context_line(event=event, run_group=run_group, driver=driver, vehicle=vehicle)}"
    )

    if request_mode == OCR_REQUEST_MODE_RELAXED:
        prompt += (
            "\n\n"
            "Relaxed salvage mode:\n"
            "- Return one JSON object even if the page is messy or only partially readable.\n"
            "- Prefer partial raw evidence over empty output.\n"
            "- If you cannot fill a mapped setup field safely, leave it as an empty string.\n"
            "- If you can only recover loose notes or visible text, return them in extracted_text, raw_evidence, "
            "and unstructured_elements.\n"
            "- If the page is blank or mostly blank, classify it as blank_setup_sheet and still return a valid JSON object.\n"
            "- Top-level keys to return: document_type, template_name, confidence, summary, extracted_text, metadata, "
            "raw_evidence, data_blocks, unstructured_elements, setup, warnings, recommended_review_status.\n"
            "- Do not output prose, markdown, or explanations outside the JSON object."
        )

    return prompt


def _request_text_format(
    *,
    request_mode: str,
    schema_name: str = IMAGE_ANALYSIS_SCHEMA_NAME,
    schema: dict[str, Any] = IMAGE_ANALYSIS_SCHEMA,
) -> dict[str, Any]:
    if request_mode == OCR_REQUEST_MODE_RELAXED:
        return {"format": {"type": "json_object"}}

    return {
        "format": {
            "type": "json_schema",
            "name": schema_name,
            "schema": schema,
            "strict": True,
        }
    }


def _safe_log_snippet(value: str, limit: int = 220) -> str:
    text = _normalize_text(value)
    if len(text) <= limit:
        return text
    return f"{text[:limit]}..."


def _request_image_classifier(
    *,
    api_key: str,
    image_url: str,
    model: str,
    prompt: str,
    timeout_seconds: float,
    preprocessing_info: dict[str, Any],
) -> dict[str, Any] | None:
    payload = {
        "model": model,
        "input": [
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt},
                    {"type": "input_image", "image_url": image_url, "detail": "high"},
                ],
            }
        ],
        "text": _request_text_format(
            request_mode=OCR_REQUEST_MODE_STRICT,
            schema_name=IMAGE_CLASSIFIER_SCHEMA_NAME,
            schema=IMAGE_CLASSIFIER_SCHEMA,
        ),
    }
    request = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    logger.info(
        "OCR classifier starting: model=%s mime_type=%s size_bytes=%s width=%s height=%s variant=%s",
        model,
        preprocessing_info.get("mime_type") or "unknown",
        preprocessing_info.get("size_bytes"),
        preprocessing_info.get("width"),
        preprocessing_info.get("height"),
        preprocessing_info.get("selected_variant") or "original",
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            response_payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        logger.warning("OCR classifier HTTP failure: status=%s model=%s", error.code, model)
        return None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as error:
        logger.warning("OCR classifier transport failure for model=%s: %s", model, error)
        return None

    raw_text = _response_output_text(response_payload).strip()
    logger.info(
        "OCR classifier raw response received=%s model=%s snippet=%s",
        bool(raw_text),
        model,
        _safe_log_snippet(raw_text),
    )
    if not raw_text:
        return None

    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError:
        start = raw_text.find("{")
        end = raw_text.rfind("}")
        if start >= 0 and end > start:
            try:
                parsed = json.loads(raw_text[start : end + 1])
            except json.JSONDecodeError:
                logger.warning("OCR classifier JSON parsing failed for model=%s", model)
                return None
        else:
            logger.warning("OCR classifier returned no parseable JSON for model=%s", model)
            return None

    logger.info(
        "OCR classifier success: model=%s doc_type=%s has_values=%s blocked_by_hand=%s warnings=%s",
        model,
        _normalize_doc_type(parsed.get("document_type")),
        _normalize_bool(parsed.get("has_values")),
        _normalize_bool(parsed.get("blocked_by_hand")),
        len(_normalize_flags(parsed.get("warnings"))),
    )
    return parsed


def _request_image_analysis(
    *,
    api_key: str,
    image_url: str,
    model: str,
    prompt: str,
    timeout_seconds: float,
    request_mode: str = OCR_REQUEST_MODE_STRICT,
    preprocessing_info: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    image_info = preprocessing_info or _inspect_image_payload(image_url)
    logger.info(
        "OCR request starting: model=%s mode=%s mime_type=%s size_bytes=%s width=%s height=%s detail=%s variant=%s notes=%s",
        model,
        request_mode,
        image_info["mime_type"] or "unknown",
        image_info["size_bytes"],
        image_info["width"],
        image_info["height"],
        image_info["detail"],
        image_info.get("selected_variant") or "original",
        len(image_info["preprocessing_notes"]),
    )
    payload = {
        "model": model,
        "input": [
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt},
                    {"type": "input_image", "image_url": image_info["image_url"], "detail": image_info["detail"]},
                ],
            }
        ],
        "text": _request_text_format(request_mode=request_mode),
    }
    request = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            response_payload = json.loads(response.read().decode("utf-8"))
        logger.info("OCR request completed: model=%s mode=%s parse_transport=success", model, request_mode)
    except urllib.error.HTTPError as error:
        logger.warning("OpenAI image analysis failed: status=%s model=%s mode=%s", error.code, model, request_mode)
        return None
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as error:
        logger.warning("OpenAI image analysis failed for model=%s mode=%s: %s", model, request_mode, error)
        return None

    raw_text = _response_output_text(response_payload).strip()
    logger.info(
        "OCR raw response received=%s model=%s mode=%s snippet=%s",
        bool(raw_text),
        model,
        request_mode,
        _safe_log_snippet(raw_text),
    )
    if not raw_text:
        logger.warning("OpenAI image analysis returned no output text for model=%s mode=%s", model, request_mode)
        return None

    parsed = _parse_model_payload(raw_text, model)
    if parsed is None:
        logger.warning("OpenAI image analysis returned no normalizable payload for model=%s mode=%s", model, request_mode)
        return None

    parsed["parser_version"] = IMAGE_ANALYSIS_PARSER_VERSION
    parsed["model"] = model
    return parsed


def _normalize_classifier_result(classifier_result: dict[str, Any] | None) -> dict[str, Any]:
    classifier = _dict(classifier_result)
    return {
        "document_type": _normalize_doc_type(classifier.get("document_type")),
        "template_name": _normalize_text(classifier.get("template_name")),
        "confidence": _normalize_float(classifier.get("confidence")),
        "has_values": _normalize_bool(classifier.get("has_values")),
        "blocked_by_hand": _normalize_bool(classifier.get("blocked_by_hand")),
        "quality_flags": _normalize_quality_flags(classifier.get("quality_flags")),
        "warnings": _normalize_flags(classifier.get("warnings")),
        "visible_text_hint": _normalize_text(classifier.get("visible_text_hint")),
    }


def _build_classifier_only_analysis(
    *,
    classifier: dict[str, Any],
    model: str,
    preprocessing_info: dict[str, Any],
) -> dict[str, Any]:
    doc_type = _normalize_doc_type(classifier.get("document_type"))
    has_values = _normalize_bool(classifier.get("has_values"))
    warnings = _normalize_flags(classifier.get("warnings"))
    if _normalize_bool(classifier.get("blocked_by_hand")):
        _append_warning(warnings, "blocked_by_hand")
    for flag in _normalize_quality_flags(classifier.get("quality_flags")):
        _append_warning(warnings, flag)

    visible_hint = _normalize_text(classifier.get("visible_text_hint"))
    raw_evidence = _empty_raw_evidence()
    if visible_hint:
        raw_evidence["visible_text"].append(visible_hint)
        raw_evidence["template_labels"].append(visible_hint)
    raw_evidence["quality_flags"] = _normalize_quality_flags(classifier.get("quality_flags"))

    if doc_type in {"blank_setup_sheet", "shock_setup_sheet"} and not has_values:
        status = OCR_STATUS_BLANK_TEMPLATE
        summary = "Blank setup template detected."
    elif doc_type == "low_quality_review_required":
        status = OCR_STATUS_LOW_QUALITY
        summary = "Low-quality image routed to manual review."
    elif has_values or visible_hint:
        status = OCR_STATUS_REVIEW_REQUIRED
        summary = "Classifier found reviewable OCR signal but extraction stayed incomplete."
    else:
        status = OCR_STATUS_REVIEW_REQUIRED
        summary = "Classifier routed the image for manual review."

    if status in OCR_REVIEWABLE_STATUSES:
        _append_warning(warnings, "Manual review required")

    return {
        "status": status,
        "document_type": doc_type or "unknown",
        "template_name": _normalize_text(classifier.get("template_name")),
        "confidence": _normalize_float(classifier.get("confidence")),
        "has_values": has_values,
        "summary": summary,
        "extracted_text": visible_hint,
        "raw_text": visible_hint,
        "quality_flags": _normalize_quality_flags(classifier.get("quality_flags")),
        "metadata": {
            "driver_text": "",
            "track_text": "",
            "session_text": "",
            "session_notes": "",
        },
        "raw_evidence": raw_evidence,
        "data_blocks": [],
        "unstructured_elements": [visible_hint] if visible_hint else [],
        "field_evidence": [],
        "setup": {},
        "warnings": warnings,
        "recommended_review_status": "PENDING",
        "parser_version": IMAGE_ANALYSIS_PARSER_VERSION,
        "model": model,
        "fallback_model_used": False,
        "message": _status_message_for_status(status),
        "classifier": classifier,
        "preprocessing": preprocessing_info,
    }


def _build_extraction_failed_analysis(
    *,
    message: str,
    preprocessing_info: dict[str, Any] | None = None,
    classifier: dict[str, Any] | None = None,
    model: str = "",
) -> dict[str, Any]:
    raw_evidence = _empty_raw_evidence()
    classifier_map = _dict(classifier)
    visible_hint = _normalize_text(classifier_map.get("visible_text_hint"))
    if visible_hint:
        raw_evidence["visible_text"].append(visible_hint)

    return {
        "status": OCR_STATUS_EXTRACTION_FAILED,
        "document_type": _normalize_doc_type(classifier_map.get("document_type")),
        "template_name": _normalize_text(classifier_map.get("template_name")),
        "confidence": 0.0,
        "has_values": False,
        "summary": message,
        "extracted_text": visible_hint,
        "raw_text": visible_hint,
        "quality_flags": _normalize_quality_flags(classifier_map.get("quality_flags")),
        "metadata": {
            "driver_text": "",
            "track_text": "",
            "session_text": "",
            "session_notes": "",
        },
        "raw_evidence": raw_evidence,
        "data_blocks": [],
        "unstructured_elements": [visible_hint] if visible_hint else [],
        "field_evidence": [],
        "setup": {},
        "warnings": ["Manual review required"],
        "recommended_review_status": "PENDING",
        "parser_version": IMAGE_ANALYSIS_PARSER_VERSION,
        "model": model,
        "fallback_model_used": False,
        "message": message,
        "classifier": classifier_map,
        "preprocessing": preprocessing_info or {},
    }


def _request_normalized_image_analysis(
    *,
    api_key: str,
    image_url: str,
    model: str,
    prompt: str,
    timeout_seconds: float,
    request_mode: str,
    preprocessing_info: dict[str, Any] | None = None,
    classifier_info: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    result = _request_image_analysis(
        api_key=api_key,
        image_url=image_url,
        model=model,
        prompt=prompt,
        timeout_seconds=timeout_seconds,
        request_mode=request_mode,
        preprocessing_info=preprocessing_info,
    )
    if result is None:
        return None

    if classifier_info:
        result["classifier"] = classifier_info
    if preprocessing_info:
        result["preprocessing"] = preprocessing_info

    normalized = normalize_image_analysis_result(result)
    if normalized is None:
        return None

    normalized["model"] = model
    return normalized


def analyze_submission_image(
    *,
    submission: Submission,
    event: Event,
    run_group: RunGroup,
    driver: Driver | None,
    vehicle: Vehicle | None,
) -> dict[str, Any] | None:
    settings = get_settings()
    ocr_config = get_ocr_config_status(settings)
    image_url = (submission.image_url or "").strip()
    preprocessing_info = _preprocess_image_payload(image_url) if image_url else {"valid": False, "error": "No image file received."}
    logger.info(
        "OCR analyze request received: file_received=%s mime_type=%s size_bytes=%s width=%s height=%s variant=%s primary_model=%s fallback_model=%s",
        bool(image_url),
        preprocessing_info.get("mime_type") or "unknown",
        preprocessing_info.get("size_bytes"),
        preprocessing_info.get("width"),
        preprocessing_info.get("height"),
        preprocessing_info.get("selected_variant") or "original",
        ocr_config["primary_model"],
        ocr_config["fallback_model"] or "none",
    )
    if ocr_config["missing_requirements"] or not image_url:
        logger.warning(
            "OCR analyze request skipped: missing_requirements=%s has_image=%s",
            ocr_config["missing_requirements"],
            bool(image_url),
        )
        return None

    if not preprocessing_info.get("valid"):
        logger.warning(
            "OCR preprocessing rejected image: error=%s mime_type=%s",
            preprocessing_info.get("error"),
            preprocessing_info.get("mime_type") or "unknown",
        )
        return normalize_image_analysis_result(
            _build_extraction_failed_analysis(
                message=preprocessing_info.get("error") or "Image could not be prepared for OCR.",
                preprocessing_info=preprocessing_info,
            )
        )

    api_key = settings.openai_api_key.strip()
    fallback_model = ocr_config["fallback_model"]
    primary_model = ocr_config["primary_model"]
    classifier_prompt = _build_classifier_prompt(
        event=event,
        run_group=run_group,
        driver=driver,
        vehicle=vehicle,
    )
    classifier_info = _normalize_classifier_result(
        _request_image_classifier(
            api_key=api_key,
            image_url=preprocessing_info["selected_image_url"],
            model=primary_model,
            prompt=classifier_prompt,
            timeout_seconds=settings.openai_request_timeout_seconds,
            preprocessing_info=preprocessing_info,
        )
    )
    if classifier_info["document_type"] == "unknown" and fallback_model:
        fallback_classifier = _request_image_classifier(
            api_key=api_key,
            image_url=preprocessing_info["selected_image_url"],
            model=fallback_model,
            prompt=classifier_prompt,
            timeout_seconds=settings.openai_request_timeout_seconds,
            preprocessing_info=preprocessing_info,
        )
        if fallback_classifier:
            classifier_info = _normalize_classifier_result(fallback_classifier)

    logger.info(
        "OCR classifier routing: doc_type=%s has_values=%s blocked_by_hand=%s quality_flags=%s",
        classifier_info["document_type"],
        classifier_info["has_values"],
        classifier_info["blocked_by_hand"],
        len(classifier_info["quality_flags"]),
    )

    if (
        classifier_info["document_type"] == "blank_setup_sheet"
        and not classifier_info["has_values"]
    ):
        return normalize_image_analysis_result(
            _build_classifier_only_analysis(
                classifier=classifier_info,
                model=primary_model,
                preprocessing_info=preprocessing_info,
            )
        )

    strict_prompt = _build_ocr_prompt(
        event=event,
        run_group=run_group,
        driver=driver,
        vehicle=vehicle,
        doc_type=classifier_info["document_type"] or "unknown",
        request_mode=OCR_REQUEST_MODE_STRICT,
    )
    relaxed_prompt = _build_ocr_prompt(
        event=event,
        run_group=run_group,
        driver=driver,
        vehicle=vehicle,
        doc_type=classifier_info["document_type"] or "unknown",
        request_mode=OCR_REQUEST_MODE_RELAXED,
    )

    normalized_primary = _request_normalized_image_analysis(
        api_key=api_key,
        image_url=preprocessing_info["selected_image_url"],
        model=primary_model,
        prompt=strict_prompt,
        timeout_seconds=settings.openai_request_timeout_seconds,
        request_mode=OCR_REQUEST_MODE_STRICT,
        preprocessing_info=preprocessing_info,
        classifier_info=classifier_info,
    )

    if normalized_primary is not None:
        logger.info(
            "OCR primary normalized: status=%s doc_type=%s confidence=%.2f field_count=%s review_flags=%s",
            normalized_primary["status"],
            normalized_primary["document_type"],
            normalized_primary["confidence"],
            normalized_primary.get("_field_count"),
            len(normalized_primary["warnings"]),
        )
        should_retry, retry_reason = _should_retry_with_fallback(normalized_primary, fallback_model)
        if should_retry and fallback_model:
            logger.warning(
                "Primary OCR result needs fallback retry: reason=%s fallback_model=%s",
                retry_reason,
                fallback_model,
            )
            normalized_fallback = _request_normalized_image_analysis(
                api_key=api_key,
                image_url=preprocessing_info["selected_image_url"],
                model=fallback_model,
                prompt=strict_prompt,
                timeout_seconds=settings.openai_request_timeout_seconds,
                request_mode=OCR_REQUEST_MODE_STRICT,
                preprocessing_info=preprocessing_info,
                classifier_info=classifier_info,
            )
            if normalized_fallback is not None:
                normalized_fallback["fallback_model_used"] = True
                normalized_fallback["model"] = fallback_model
                logger.info(
                    "OCR fallback normalized: status=%s doc_type=%s confidence=%.2f field_count=%s review_flags=%s",
                    normalized_fallback["status"],
                    normalized_fallback["document_type"],
                    normalized_fallback["confidence"],
                    normalized_fallback.get("_field_count"),
                    len(normalized_fallback["warnings"]),
                )
                return normalized_fallback
        return normalized_primary

    if fallback_model:
        logger.warning(
            "Primary OCR model failed or returned malformed output; retrying with fallback model=%s",
            fallback_model,
        )
        normalized_fallback = _request_normalized_image_analysis(
            api_key=api_key,
            image_url=preprocessing_info["selected_image_url"],
            model=fallback_model,
            prompt=strict_prompt,
            timeout_seconds=settings.openai_request_timeout_seconds,
            request_mode=OCR_REQUEST_MODE_STRICT,
            preprocessing_info=preprocessing_info,
            classifier_info=classifier_info,
        )
        if normalized_fallback is not None:
            normalized_fallback["fallback_model_used"] = True
            normalized_fallback["model"] = fallback_model
            logger.info(
                "OCR fallback normalized after primary transport failure: status=%s doc_type=%s confidence=%.2f field_count=%s review_flags=%s",
                normalized_fallback["status"],
                normalized_fallback["document_type"],
                normalized_fallback["confidence"],
                normalized_fallback.get("_field_count"),
                len(normalized_fallback["warnings"]),
            )
            return normalized_fallback

    logger.warning("Strict OCR passes yielded no safe normalized draft; starting relaxed salvage path")
    normalized_primary_salvage = _request_normalized_image_analysis(
        api_key=api_key,
        image_url=preprocessing_info["selected_image_url"],
        model=primary_model,
        prompt=relaxed_prompt,
        timeout_seconds=settings.openai_request_timeout_seconds,
        request_mode=OCR_REQUEST_MODE_RELAXED,
        preprocessing_info=preprocessing_info,
        classifier_info=classifier_info,
    )
    if normalized_primary_salvage is not None:
        logger.info(
            "OCR relaxed primary normalized: status=%s doc_type=%s confidence=%.2f field_count=%s review_flags=%s",
            normalized_primary_salvage["status"],
            normalized_primary_salvage["document_type"],
            normalized_primary_salvage["confidence"],
            normalized_primary_salvage.get("_field_count"),
            len(normalized_primary_salvage["warnings"]),
        )
        should_retry, retry_reason = _should_retry_with_fallback(normalized_primary_salvage, fallback_model)
        if should_retry and fallback_model:
            logger.warning(
                "Relaxed primary OCR result needs fallback retry: reason=%s fallback_model=%s",
                retry_reason,
                fallback_model,
            )
            normalized_fallback_salvage = _request_normalized_image_analysis(
                api_key=api_key,
                image_url=preprocessing_info["selected_image_url"],
                model=fallback_model,
                prompt=relaxed_prompt,
                timeout_seconds=settings.openai_request_timeout_seconds,
                request_mode=OCR_REQUEST_MODE_RELAXED,
                preprocessing_info=preprocessing_info,
                classifier_info=classifier_info,
            )
            if normalized_fallback_salvage is not None:
                normalized_fallback_salvage["fallback_model_used"] = True
                normalized_fallback_salvage["model"] = fallback_model
                logger.info(
                    "OCR relaxed fallback normalized: status=%s doc_type=%s confidence=%.2f field_count=%s review_flags=%s",
                    normalized_fallback_salvage["status"],
                    normalized_fallback_salvage["document_type"],
                    normalized_fallback_salvage["confidence"],
                    normalized_fallback_salvage.get("_field_count"),
                    len(normalized_fallback_salvage["warnings"]),
                )
                return normalized_fallback_salvage
        return normalized_primary_salvage

    if fallback_model:
        logger.warning(
            "Relaxed primary OCR salvage failed; retrying relaxed salvage with fallback model=%s",
            fallback_model,
        )
        normalized_fallback_salvage = _request_normalized_image_analysis(
            api_key=api_key,
            image_url=preprocessing_info["selected_image_url"],
            model=fallback_model,
            prompt=relaxed_prompt,
            timeout_seconds=settings.openai_request_timeout_seconds,
            request_mode=OCR_REQUEST_MODE_RELAXED,
            preprocessing_info=preprocessing_info,
            classifier_info=classifier_info,
        )
        if normalized_fallback_salvage is not None:
            normalized_fallback_salvage["fallback_model_used"] = True
            normalized_fallback_salvage["model"] = fallback_model
            logger.info(
                "OCR relaxed fallback normalized after primary salvage failure: status=%s doc_type=%s confidence=%.2f field_count=%s review_flags=%s",
                normalized_fallback_salvage["status"],
                normalized_fallback_salvage["document_type"],
                normalized_fallback_salvage["confidence"],
                normalized_fallback_salvage.get("_field_count"),
                len(normalized_fallback_salvage["warnings"]),
            )
            return normalized_fallback_salvage

    if classifier_info["document_type"] != "unknown" or classifier_info["has_values"] or classifier_info["visible_text_hint"]:
        logger.warning("OCR extraction failed, but classifier signal exists; returning classifier-only review draft")
        return normalize_image_analysis_result(
            _build_classifier_only_analysis(
                classifier=classifier_info,
                model=primary_model,
                preprocessing_info=preprocessing_info,
            )
        )

    logger.warning("OCR analyze request ended without any safe normalized draft")
    return normalize_image_analysis_result(
        _build_extraction_failed_analysis(
            message="OCR service failed. Please retry or enter manually.",
            preprocessing_info=preprocessing_info,
            classifier=classifier_info,
            model=primary_model,
        )
    )
