from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

import requests
import yaml

ROOT = Path(__file__).resolve().parent
SPEC_PATH = ROOT / "cli-auth.yaml"


def nested(value: Any, path: str) -> Any:
    current = value
    for part in path.split("."):
        current = current[part]
    return current


def expand(value: Any, variables: dict[str, str]) -> Any:
    if isinstance(value, str):
        return value.format_map(variables)
    if isinstance(value, list):
        return [expand(item, variables) for item in value]
    if isinstance(value, dict):
        return {key: expand(item, variables) for key, item in value.items()}
    return value


def test_cli_auth_contract() -> None:
    contract = yaml.safe_load(SPEC_PATH.read_text(encoding="utf-8"))
    variables = {"run_id": uuid.uuid4().hex}
    clients: dict[str, requests.Session] = {"default": requests.Session()}

    try:
        for case in contract["cases"]:
            request = expand(case["request"], variables)
            client_name = request.get("client", "default")
            client = clients.setdefault(client_name, requests.Session())
            headers = dict(request.get("headers", {}))
            if request.get("cli_headers"):
                headers.update(contract["cli_headers"])
            if bearer_name := request.get("bearer"):
                headers["Authorization"] = f"Bearer {variables[bearer_name]}"

            response = client.request(
                request["method"],
                f"{contract['base_url']}{request['path']}",
                headers=headers,
                json=request.get("json"),
                timeout=10,
            )
            expected = case["expect"]
            assert response.status_code == expected["status"], (
                case["id"],
                response.status_code,
                response.text,
            )
            for header, value in expected.get("headers", {}).items():
                assert response.headers.get(header) == value, case["id"]
            body = response.json() if response.content else None
            for path, value in expected.get("json_paths", {}).items():
                assert nested(body, path) == value, case["id"]
            for name, path in case.get("save", {}).items():
                variables[name] = str(nested(body, path))
    finally:
        for client in clients.values():
            client.close()


def test_cli_auth_contract_has_no_persisted_client_metadata() -> None:
    text = SPEC_PATH.read_text(encoding="utf-8")
    assert "device_name" not in text
    assert "clientVersion:" not in text
    assert "clientOs:" not in text
    json.dumps(yaml.safe_load(text))
