# Single-server TLS handoff

The production Compose stack publishes only nginx on host ports 80 and 443. PostgreSQL and the application stay on the internal Compose network.

1. Obtain a certificate outside this repository. Place the full certificate chain and private key in a root-owned directory on the server. The key should be readable only by root; never commit either file.
2. Set `TLS_CERTIFICATE_FILE` and `TLS_PRIVATE_KEY_FILE` in the deployment environment to their absolute host paths. Set `HTTP_PORT` or `HTTPS_PORT` only if the host uses non-default ports.
3. Validate before starting traffic:

   ```sh
   docker compose --env-file .env -f ops/docker-compose.yml config --quiet
   docker compose --env-file .env -f ops/docker-compose.yml run --rm --no-deps nginx nginx -t
   ```

4. Start the stack with `docker compose --env-file .env -f ops/docker-compose.yml up -d`. Confirm HTTP redirects to HTTPS, `/livez` remains available for process diagnosis, and `/readyz` returns 200 only after migration and administrator bootstrap complete.
5. Renew certificates through the chosen issuer, replace both files atomically, then run `docker compose --env-file .env -f ops/docker-compose.yml exec nginx nginx -s reload`. Re-run `nginx -t` before every reload.

If TLS files are absent, invalid, or unreadable, nginx fails closed and does not accept public traffic.
