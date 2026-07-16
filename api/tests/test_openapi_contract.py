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
    ("delete", "/api/artifacts/{artifactId}"),
    ("post", "/api/artifacts/{artifactId}/upload-sessions"),
    ("post", "/api/upload-sessions/{uploadSessionId}:retry"),
    ("get", "/api/versions/{versionId}/content/"),
    ("get", "/api/versions/{versionId}/content/{assetPath}"),
    ("get", "/api/versions/{versionId}/export"),
    ("post", "/api/artifacts/{artifactId}/publications"),
    ("patch", "/api/artifacts/{artifactId}/publications/{publicationId}"),
    ("delete", "/api/artifacts/{artifactId}/publications/{publicationId}"),
    ("get", "/a/{shareSlug}/"),
    ("get", "/a/{shareSlug}/{assetPath}"),
}

GALLERY_OPERATIONS = {
    ("get", "/api/gallery/permission-grant"),
    ("get", "/api/gallery/profile"),
    ("patch", "/api/gallery/profile"),
    ("post", "/api/gallery/profile/avatar-uploads"),
    ("get", "/gallery-media/avatar/{creatorSlug}"),
    ("get", "/api/artifacts/{artifactId}/gallery-listing"),
    ("post", "/api/artifacts/{artifactId}/gallery-listing"),
    ("patch", "/api/gallery-listings/{listingId}"),
    ("delete", "/api/gallery-listings/{listingId}"),
    ("post", "/api/gallery-decisions/{decisionId}/appeals"),
    ("get", "/gallery"),
    ("get", "/gallery/newest"),
    ("get", "/gallery/featured"),
    ("get", "/gallery/search"),
    ("get", "/gallery/tags/{tag}"),
    ("get", "/gallery/creators/{creatorSlug}"),
    ("get", "/gallery/{gallerySlug}"),
    ("post", "/gallery/{gallerySlug}/player-authorizations"),
    ("get", "/gallery/{gallerySlug}/download"),
    ("post", "/gallery/{gallerySlug}/reports"),
    ("post", "/api/gallery/{gallerySlug}/copy-operations"),
    ("get", "/api/gallery-copy-operations/{operationId}"),
    ("get", "/api/gallery/notifications"),
    ("get", "/gallery-content/public/{playerAuthorization}/"),
    ("get", "/gallery-content/public/{playerAuthorization}/{assetPath}"),
    ("get", "/gallery-content/review/{reviewAuthorization}/"),
    ("get", "/gallery-content/review/{reviewAuthorization}/{assetPath}"),
    ("get", "/api/admin/gallery/cases"),
    ("get", "/api/admin/gallery/cases/{caseId}"),
    ("post", "/api/admin/gallery/cases/{caseId}/review-authorizations"),
    ("post", "/api/admin/gallery/cases/{caseId}/decisions"),
    ("put", "/api/admin/gallery/featured-positions/{position}"),
    ("delete", "/api/admin/gallery/featured-positions/{position}"),
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


def response_schemas(document: dict[str, Any]) -> list[dict[str, Any]]:
    schemas: list[dict[str, Any]] = []
    for path_item in document["paths"].values():
        for method, operation in path_item.items():
            if method == "parameters":
                continue
            for response in operation["responses"].values():
                if "$ref" in response:
                    response = resolve_local_ref(document, response["$ref"])
                for media_type in response.get("content", {}).values():
                    if schema := media_type.get("schema"):
                        schemas.append(schema)
    return schemas


def schema_property_names(
    document: dict[str, Any],
    schema: Any,
    visited_references: set[str] | None = None,
) -> set[str]:
    if not isinstance(schema, dict):
        return set()
    visited_references = visited_references or set()
    if reference := schema.get("$ref"):
        if reference in visited_references:
            return set()
        return schema_property_names(
            document,
            resolve_local_ref(document, reference),
            visited_references | {reference},
        )

    names = set(schema.get("properties", {}))
    for child in schema.get("properties", {}).values():
        names.update(schema_property_names(document, child, visited_references))
    names.update(schema_property_names(document, schema.get("items"), visited_references))
    for keyword in ("allOf", "anyOf", "oneOf"):
        for child in schema.get(keyword, []):
            names.update(schema_property_names(document, child, visited_references))
    return names


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
    viewer_entry_parameters = document["paths"]["/a/{shareSlug}/"]["get"]["parameters"]
    assert any(
        parameter.get("name") == "contentMode"
        and parameter.get("in") == "query"
        and parameter.get("schema") == {"type": "boolean", "default": False}
        for parameter in viewer_entry_parameters
    )
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
    assert "shareLink" not in schemas["ArtifactAcceptedResponse"]["properties"]
    assert "shareLink" not in schemas["ArtifactAcceptedResponse"]["required"]
    assert schemas["Artifact"]["example"]["id"] == "artifact-example"
    assert schemas["Artifact"]["properties"]["publicationStatus"]["enum"] == [
        "not_published",
        "published",
        "expired",
        "unpublished",
    ]
    assert schemas["Artifact"]["properties"]["shareLink"] == {
        "oneOf": [
            {"$ref": "#/components/schemas/ShareLink"},
            {"type": "null"},
        ]
    }
    assert schemas["PublicationResponse"]["example"]["publication"]["versionId"] == "version-example"
    assert schemas["PublicationResponse"]["required"] == ["publication", "shareLink"]
    assert schemas["CreatePublicationRequest"]["required"] == ["versionId", "expiration", "link"]
    expiration_variants = schemas["PublicationExpirationPolicy"]["oneOf"]
    assert [variant["properties"]["kind"]["const"] for variant in expiration_variants] == [
        "permanent",
        "duration",
        "exact",
    ]
    link_variants = schemas["PublicationLinkChoice"]["oneOf"]
    assert [variant["properties"]["mode"]["const"] for variant in link_variants] == ["reuse", "replace"]
    assert link_variants[1]["properties"]["confirmRetire"]["const"] is True
    assert schemas["UpdatePublicationRequest"]["required"] == ["expiration"]
    assert schemas["ShareLink"]["properties"]["state"]["enum"] == ["active", "retired"]
    manage_publication = document["paths"]["/api/artifacts/{artifactId}/publications/{publicationId}"]
    assert set(manage_publication) - {"parameters"} == {"patch", "delete"}
    assert set(manage_publication["patch"]["responses"]) == {
        "200", "400", "401", "404", "409", "426", "500"
    }
    delete_artifact = document["paths"]["/api/artifacts/{artifactId}"]["delete"]
    assert set(delete_artifact["responses"]) == {"204", "401", "404", "409", "426", "500"}
    assert "must not automatically retry" in delete_artifact["description"]
    assert delete_artifact["responses"]["204"]["headers"]["X-Request-Id"] == {
        "$ref": "#/components/headers/RequestId"
    }
    bearer_operations = [
        operation
        for path_item in document["paths"].values()
        for method, operation in path_item.items()
        if method != "parameters"
        and any("sessionBearer" in security for security in operation.get("security", []))
    ]
    assert bearer_operations
    assert all(operation["responses"]["426"] == {
        "$ref": "#/components/responses/CliUpgradeRequired"
    } for operation in bearer_operations)

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
    assert error_properties["details"] == {
        "oneOf": [
            {"$ref": "#/components/schemas/ValidationDetails"},
            {"$ref": "#/components/schemas/CliCompatibilityDetails"},
            {"$ref": "#/components/schemas/RequestFieldDetails"},
            {"$ref": "#/components/schemas/SizeLimitDetails"},
            {"$ref": "#/components/schemas/ConflictDetails"},
        ]
    }
    assert error_properties["fields"]["maxItems"] == 20
    assert schemas["CliCompatibilityDetails"]["required"] == [
        "currentVersion",
        "minimumVersion",
        "operatingSystem",
        "supportedOperatingSystems",
    ]
    assert schemas["SizeLimitDetails"]["required"] == ["limitBytes"]
    upload_too_large = document["components"]["responses"]["UploadTooLarge"]["content"]["application/json"][
        "examples"
    ]["tooLarge"]["value"]["error"]
    assert upload_too_large["code"] == "archive_too_large"
    assert upload_too_large["action"] == "Reduce the ZIP below the upload limit and try again."
    assert upload_too_large["details"] == {"limitBytes": 52_428_800}
    assert "actualBytes" not in upload_too_large["details"]


def test_gallery_wire_contract_is_complete_and_fail_closed() -> None:
    document = yaml.safe_load(OPENAPI_PATH.read_text(encoding="utf-8"))
    actual_operations = {
        (method, path)
        for path, path_item in document["paths"].items()
        for method in path_item
        if method != "parameters" and (method, path) in GALLERY_OPERATIONS
    }
    assert actual_operations == GALLERY_OPERATIONS

    schemas = document["components"]["schemas"]
    assert schemas["GalleryListingLifecycle"]["enum"] == [
        "pending", "listed", "withdrawn", "removed"
    ]
    assert schemas["GalleryReviewState"]["enum"] == ["clear", "reviewing", "restricted"]
    assert schemas["GalleryClosureReason"]["oneOf"][0]["enum"] == [
        "creator_withdrawal",
        "artifact_deleted",
        "account_deleted",
        "initial_policy_rejection",
        "initial_governance_block",
        "administrator_removal",
    ]
    assert schemas["GalleryCopyState"]["enum"] == [
        "accepted", "processing", "ready", "failed", "cancelled", "indeterminate"
    ]
    assert schemas["GalleryPermissionGrant"]["properties"]["permissions"]["prefixItems"] == [
        {"const": "view"},
        {"const": "gallery_download"},
        {"const": "save_a_copy"},
    ]
    assert schemas["GalleryPermissionGrantResponse"]["properties"]["grant"]["oneOf"][1] == {
        "type": "null"
    }
    owner_listing_properties = schemas["OwnerGalleryListing"]["properties"]
    assert {"currentGrantEvidence", "historicalGrantEvidence", "effectiveAccess"} <= set(
        owner_listing_properties
    )
    assert schemas["GalleryListingOperationResponse"]["required"] == [
        "historicalOutcome", "current"
    ]
    assert schemas["GalleryAppealPolicyEvidence"]["required"] == [
        "policyVersion", "decisionAt", "deadlineAt"
    ]

    listing_read = document["paths"]["/gallery/{gallerySlug}"]["get"]
    assert set(listing_read["responses"]) == {"200", "404", "410", "503"}
    assert "checked before slug lookup" in listing_read["description"]
    creator_read = document["paths"]["/gallery/creators/{creatorSlug}"]["get"]
    assert set(creator_read["responses"]) == {"200", "400", "404", "503"}
    assert "410" not in creator_read["responses"]

    mutation_paths = {
        ("post", "/api/artifacts/{artifactId}/gallery-listing"),
        ("patch", "/api/gallery-listings/{listingId}"),
        ("delete", "/api/gallery-listings/{listingId}"),
        ("post", "/api/gallery-decisions/{decisionId}/appeals"),
        ("post", "/api/gallery/{gallerySlug}/copy-operations"),
        ("post", "/api/admin/gallery/cases/{caseId}/decisions"),
    }
    for method, path in mutation_paths:
        parameters = document["paths"][path][method].get("parameters", [])
        assert {"$ref": "#/components/parameters/IdempotencyKey"} in parameters

    for method, path in {
        ("patch", "/api/gallery/profile"),
        ("patch", "/api/gallery-listings/{listingId}"),
        ("delete", "/api/gallery-listings/{listingId}"),
    }:
        parameters = document["paths"][path][method]["parameters"]
        assert any(parameter["$ref"].endswith(("ExpectedProfileRevision", "ExpectedListingRevision"))
                   for parameter in parameters)

    anonymous_prefixes = ("/gallery", "/gallery-content")
    for method, path in GALLERY_OPERATIONS:
        operation = document["paths"][path][method]
        if path.startswith(anonymous_prefixes) and not path.startswith("/api/"):
            assert "security" not in operation
        elif path.startswith("/api/"):
            assert operation["security"] == [{"sessionCookie": []}, {"sessionBearer": []}]

    for response_name in (
        "PublicGalleryListingRead",
        "GalleryListingPageRead",
        "PublicCreatorProfileRead",
        "GalleryPlayerAuthorizationRead",
        "GalleryDownloadRead",
        "GalleryContentRead",
        "PublicGalleryNotFound",
        "PublicGalleryGone",
        "PublicGalleryUnavailable",
    ):
        headers = document["components"]["responses"][response_name]["headers"]
        assert headers["Cache-Control"] == {"$ref": "#/components/headers/NoStore"}
        assert headers["Referrer-Policy"] == {"$ref": "#/components/headers/NoReferrer"}


def test_public_responses_do_not_expose_content_reuse_internals() -> None:
    document = yaml.safe_load(OPENAPI_PATH.read_text(encoding="utf-8"))
    property_names = {
        "".join(character for character in name.lower() if character.isalnum())
        for schema in response_schemas(document)
        for name in schema_property_names(document, schema)
    }

    assert property_names.isdisjoint(
        {
            "contentbundle",
            "contentbundleid",
            "contentdigest",
            "contentsha256",
            "dedupoutcome",
            "fingerprint",
            "fingerprintkeyrevision",
            "fingerprints",
            "objectkey",
            "objectkeys",
            "rawfingerprint",
            "rawsha256",
            "reusefingerprint",
            "reuseoutcome",
            "reusehit",
            "deduphit",
            "deduplicationhit",
            "sha256",
        }
    )
