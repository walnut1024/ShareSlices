from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


OPENAPI_PATH = Path(__file__).parents[1] / "openapi" / "openapi.yaml"
ARTIFACT_PATHS = {
    "/api/artifact-upload-policies/current",
    "/api/artifacts",
    "/api/artifacts/{artifactId}",
    "/api/artifacts/{artifactId}/versions",
    "/api/artifacts/{artifactId}/share-link",
    "/api/artifacts/{artifactId}/upload-sessions",
    "/api/upload-sessions/{uploadSessionId}:retry",
    "/api/versions/{versionId}/content/",
    "/api/versions/{versionId}/content/{assetPath}",
    "/api/versions/{versionId}/export",
    "/api/artifacts/{artifactId}/publications",
    "/api/artifacts/{artifactId}/publications/{publicationId}",
    "/a/{shareSlug}/",
    "/a/{shareSlug}/{assetPath}",
}
ARTIFACT_OPERATIONS = {
    ("get", "/api/artifact-upload-policies/current"),
    ("get", "/api/artifacts"),
    ("post", "/api/artifacts"),
    ("get", "/api/artifacts/{artifactId}"),
    ("get", "/api/artifacts/{artifactId}/versions"),
    ("patch", "/api/artifacts/{artifactId}"),
    ("patch", "/api/artifacts/{artifactId}/share-link"),
    ("delete", "/api/artifacts/{artifactId}"),
    ("post", "/api/artifacts/{artifactId}/upload-sessions"),
    ("post", "/api/upload-sessions/{uploadSessionId}:retry"),
    ("get", "/api/versions/{versionId}/content/"),
    ("get", "/api/versions/{versionId}/content/{assetPath}"),
    ("get", "/api/versions/{versionId}/export"),
    ("post", "/api/artifacts/{artifactId}/publications"),
    ("delete", "/api/artifacts/{artifactId}/publications/{publicationId}"),
    ("get", "/a/{shareSlug}/"),
    ("get", "/a/{shareSlug}/{assetPath}"),
}


def resolve_local_ref(document: dict[str, Any], reference: str) -> Any:
    assert reference.startswith("#/"), reference
    current: Any = document
    for part in reference[2:].split("/"):
        current = current[part.replace("~1", "/").replace("~0", "~")]
    return current


def walk(value: Any) -> list[str]:
    if isinstance(value, dict):
        references = [value["$ref"]] if "$ref" in value else []
        return references + [ref for child in value.values() for ref in walk(child)]
    if isinstance(value, list):
        return [ref for child in value for ref in walk(child)]
    return []


def test_openapi_artifact_contract_and_local_references() -> None:
    document = yaml.safe_load(OPENAPI_PATH.read_text(encoding="utf-8"))

    assert document["openapi"] == "3.1.0"
    assert document["info"]["version"] == "0.0.1"
    assert ARTIFACT_PATHS <= document["paths"].keys()
    assert ARTIFACT_OPERATIONS == {
        (method, path)
        for path in ARTIFACT_PATHS
        for method in document["paths"][path]
        if method != "parameters"
    }

    for reference in walk(document):
        resolve_local_ref(document, reference)

    no_store = document["components"]["headers"]["NoStore"]["schema"]
    assert no_store["enum"] == ["no-store"]

    schemas = document["components"]["schemas"]
    export_parameters = document["paths"]["/api/versions/{versionId}/export"]["get"]["parameters"]
    assert any(parameter.get("name") == "artifactId" and parameter.get("in") == "query" for parameter in export_parameters)
    create_upload = schemas["CreateArtifactRequest"]
    assert "entry" in create_upload["properties"]
    assert "entry" not in create_upload["required"]
    assert schemas["UploadPolicyResponse"]["example"]["policy"] == {
        "revision": "v0.0.1-default",
        "maxArchiveBytes": 52_428_800,
        "maxExpandedBytes": 209_715_200,
        "maxFileCount": 1_000,
        "maxFileBytes": 52_428_800,
        "enabledExtensions": [".html", ".css", ".js", ".png"],
    }
    assert schemas["ArtifactAcceptedResponse"]["example"]["uploadSessionId"]
    assert schemas["Artifact"]["example"]["id"] == "artifact-example"
    assert schemas["PublicationResponse"]["example"]["publication"]["versionId"] == "version-example"
    assert schemas["UpdateShareLinkRequest"]["required"] == ["expiresAt"]
    assert schemas["ShareLink"]["properties"]["state"]["enum"] == ["active", "expired", "retired"]
    update_share = document["paths"]["/api/artifacts/{artifactId}/share-link"]["patch"]
    assert set(update_share["responses"]) == {"200", "400", "401", "404", "500"}
    delete_artifact = document["paths"]["/api/artifacts/{artifactId}"]["delete"]
    assert set(delete_artifact["responses"]) == {"204", "401", "404", "409", "500"}
    assert "must not automatically retry" in delete_artifact["description"]
    assert delete_artifact["responses"]["204"]["headers"]["X-Request-Id"] == {
        "$ref": "#/components/headers/RequestId"
    }

    validation_details = schemas["ValidationDetails"]
    assert validation_details["additionalProperties"] is False
    assert set(validation_details["properties"]) == {
        "path",
        "paths",
        "candidates",
        "extension",
        "validationKind",
        "actualBytes",
        "limitBytes",
        "actualCount",
        "limitCount",
        "ignoredCount",
        "directory",
        "entryFile",
    }
    assert schemas["ValidationNotice"]["required"] == ["code", "message", "action", "details"]
    assert schemas["ValidationReport"]["required"] == ["primaryIssue", "issues", "warnings"]
    assert schemas["ValidationReport"]["properties"]["issues"]["maxItems"] == 20
    assert schemas["ValidationReport"]["properties"]["warnings"]["maxItems"] == 20
    exact_integer = schemas["ValidationDetails"]["properties"]["actualBytes"]["oneOf"]
    assert exact_integer[0]["maximum"] == 9_007_199_254_740_991
    assert exact_integer[1] == {"type": "string", "pattern": "^(0|[1-9][0-9]*)$"}

    artifact_validation_report = schemas["Artifact"]["properties"]["validationReport"]
    assert artifact_validation_report == {
        "oneOf": [
            {"$ref": "#/components/schemas/ValidationReport"},
            {"type": "null"},
        ]
    }

    error_properties = schemas["ErrorBody"]["properties"]
    assert error_properties["action"]["type"] == "string"
    assert error_properties["details"] == {"$ref": "#/components/schemas/ValidationDetails"}
    upload_too_large = document["components"]["responses"]["UploadTooLarge"]["content"]["application/json"][
        "examples"
    ]["tooLarge"]["value"]["error"]
    assert upload_too_large["code"] == "archive_too_large"
    assert upload_too_large["action"] == "Reduce the ZIP below the upload limit and try again."
    assert upload_too_large["details"] == {"limitBytes": 52_428_800}
    assert "actualBytes" not in upload_too_large["details"]
