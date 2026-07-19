from __future__ import annotations

import re
from collections.abc import Iterable


def normalize_text(value: str | None) -> str:
    if value is None:
        return ""
    return " ".join(str(value).split()).strip()


def split_name(value: str | None) -> tuple[str, str]:
    normalized = normalize_text(value)
    if not normalized:
        return "", ""

    parts = normalized.split(" ", 1)
    if len(parts) == 1:
        return parts[0], parts[0]

    return parts[0], parts[1]


def normalize_aliases(value: Iterable[str] | str | None) -> list[str]:
    if value is None:
        return []

    if isinstance(value, str):
        items = value.split(",")
    elif isinstance(value, Iterable):
        items = list(value)
    else:
        return []

    aliases: list[str] = []
    seen: set[str] = set()

    for item in items:
        alias = normalize_text(str(item))
        if not alias:
            continue

        key = alias.lower()
        if key in seen:
            continue

        seen.add(key)
        aliases.append(alias)

    return aliases


def generate_driver_id(
    driver_name: str | None = None,
    *,
    first_name: str | None = None,
    last_name: str | None = None,
) -> str:
    source_parts = [driver_name, first_name, last_name]
    tokens: list[str] = []

    for part in source_parts:
        tokens.extend(re.findall(r"[A-Za-z0-9]+", normalize_text(part)))

    code = "".join(token[0] for token in tokens if token)
    return re.sub(r"[^A-Z0-9]", "", code.upper())[:32] or "DRV"


def generate_vehicle_id(
    driver_code: str | None,
    *,
    make: str | None = None,
    model: str | None = None,
    year: int | None = None,
) -> str:
    normalized_driver = re.sub(r"[^A-Za-z0-9]+", "", normalize_text(driver_code).upper()) or "VEH"
    model_tokens = re.findall(r"[A-Za-z0-9]+", normalize_text(model))
    make_tokens = re.findall(r"[A-Za-z0-9]+", normalize_text(make))
    vehicle_token = (model_tokens or make_tokens or ["VEH"])[0].upper()

    code = f"{normalized_driver}-{vehicle_token}"
    if year not in (None, ""):
        code = f"{code}-{year}"

    return code[:64]
