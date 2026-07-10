# Snapshot artifact limits per upload session

Artifact validation limits are deployment configuration stored in PostgreSQL with product-defined seeded defaults. The API snapshots the active values into each upload session when it is created, and both the API and Worker enforce that snapshot; later configuration changes affect only new upload sessions. Reading live values during processing was rejected because one upload could otherwise be accepted under one policy and completed or rejected under another.
