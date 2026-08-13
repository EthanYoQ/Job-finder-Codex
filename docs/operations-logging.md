# Bounded production logs

Every long-running database, application, proxy, crawler, backup, restore-verifier, and monitoring container uses Docker's `local` log driver with 10 MiB files and five retained rotations. This creates an approximate 50 MiB upper bound per service, excluding Docker's small metadata overhead, and remains effective across container restarts.

The five-file rotation count is the retention policy; elapsed retention time depends on log volume. Operators should use `docker compose logs --since` for incident inspection and must not disable or override the Compose logging contract on the production server.
