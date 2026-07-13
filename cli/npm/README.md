# ShareSlices CLI npm package

This package installs the same versioned native binary published in the ShareSlices GitHub Release. It does not bundle a Node.js implementation of the CLI.

```bash
npm install -g @shareslices/cli
```

The install lifecycle downloads the binary matching the npm package version and current supported platform, then verifies it against the Release `SHA256SUMS` file.
