# Privacy

`dsh-bid-health-check` is a local-only checker.

- It reads the document content passed to its tools; it does not upload it.
- It makes no network requests and ships no telemetry, analytics, or background reporting.
- It writes no data outside the tool result and the DSH host's own session/log storage. The host controls that storage and its retention; this package does not add a second copy.
- Removing the package removes its code; it does not delete host session logs or documents you already created.

This statement covers the npm package, not the DSH host or any other plugin in the profile.
