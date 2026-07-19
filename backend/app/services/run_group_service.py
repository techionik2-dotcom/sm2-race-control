from app.core.enums import RunGroupCode


def normalize_run_group(raw_text: str) -> RunGroupCode | None:
    upper = raw_text.upper()

    if "RED" in upper:
        return RunGroupCode.RED
    if "BLUE" in upper:
        return RunGroupCode.BLUE
    if "YELLOW" in upper:
        return RunGroupCode.YELLOW
    if "GREEN" in upper:
        return RunGroupCode.GREEN

    return None
