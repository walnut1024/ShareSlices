#!/bin/sh

set -eu

REPOSITORY="walnut1024/ShareSlices"
VERSION=""
INSTALL_DIR="${SHARESLICES_INSTALL_DIR:-$HOME/.local/bin}"

usage() {
  cat <<'EOF'
Install the ShareSlices CLI from GitHub Releases.

Usage: install.sh [--version VERSION] [--install-dir DIRECTORY]

Options:
  --version VERSION          Install a specific CLI version, without the cli-v prefix.
  --install-dir DIRECTORY    Install directory (default: ~/.local/bin).
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version)
      VERSION="${2:?--version requires a value}"
      shift 2
      ;;
    --install-dir)
      INSTALL_DIR="${2:?--install-dir requires a value}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

case "$(uname -s)" in
  Darwin)
    case "$(uname -m)" in
      arm64) target="aarch64-apple-darwin" ;;
      x86_64) target="x86_64-apple-darwin" ;;
      *) printf 'Unsupported macOS architecture: %s\n' "$(uname -m)" >&2; exit 1 ;;
    esac
    ;;
  Linux)
    case "$(uname -m)" in
      x86_64) target="x86_64-unknown-linux-gnu" ;;
      *) printf 'Unsupported Linux architecture: %s\n' "$(uname -m)" >&2; exit 1 ;;
    esac
    ;;
  *)
    printf 'Unsupported operating system: %s\n' "$(uname -s)" >&2
    exit 1
    ;;
esac

for command in curl tar mktemp; do
  command -v "$command" >/dev/null 2>&1 || {
    printf 'Required command is unavailable: %s\n' "$command" >&2
    exit 1
  }
done

archive="shareslices-$target.tar.gz"
if [ -n "${SHARESLICES_RELEASE_BASE_URL:-}" ]; then
  release_base="$SHARESLICES_RELEASE_BASE_URL"
elif [ -n "$VERSION" ]; then
  release_base="https://github.com/$REPOSITORY/releases/download/cli-v$VERSION"
else
  release_base="https://github.com/$REPOSITORY/releases/latest/download"
fi

temporary_dir="$(mktemp -d)"
trap 'rm -rf "$temporary_dir"' EXIT HUP INT TERM

curl --fail --location --silent --show-error "$release_base/$archive" --output "$temporary_dir/$archive"
curl --fail --location --silent --show-error "$release_base/SHA256SUMS" --output "$temporary_dir/SHA256SUMS"

expected_checksum="$(awk -v archive="$archive" '$2 == archive { print $1 }' "$temporary_dir/SHA256SUMS")"
[ -n "$expected_checksum" ] || {
  printf 'No checksum was published for %s.\n' "$archive" >&2
  exit 1
}

if command -v sha256sum >/dev/null 2>&1; then
  actual_checksum="$(sha256sum "$temporary_dir/$archive" | awk '{ print $1 }')"
else
  actual_checksum="$(shasum -a 256 "$temporary_dir/$archive" | awk '{ print $1 }')"
fi

[ "$expected_checksum" = "$actual_checksum" ] || {
  printf 'Checksum verification failed for %s.\n' "$archive" >&2
  exit 1
}

tar -xzf "$temporary_dir/$archive" -C "$temporary_dir"
[ -f "$temporary_dir/shareslices" ] || {
  printf 'The archive did not contain the shareslices executable.\n' >&2
  exit 1
}

mkdir -p "$INSTALL_DIR"
install -m 755 "$temporary_dir/shareslices" "$INSTALL_DIR/shareslices"

printf 'Installed shareslices to %s\n' "$INSTALL_DIR/shareslices"
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) printf 'Add %s to PATH, then open a new terminal.\n' "$INSTALL_DIR" ;;
esac
