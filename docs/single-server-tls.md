# Single-server TLS handoff

The production Compose stack publishes only nginx on host ports 80 and 443. PostgreSQL and the application stay on the internal Compose network.

1. Obtain a certificate outside this repository. Place `fullchain.pem` and `privkey.pem` in a root-owned directory on the server. Grant the container's fixed UID 101 read/traverse access through a narrowly scoped group or ACL; never make the private key world-readable and never commit either file.
2. Set `PUBLIC_HOSTNAME` to the exact public DNS name and `TLS_DIRECTORY` to that directory's absolute host path. Set `HTTP_PORT` or `HTTPS_PORT` only if the host uses non-default ports. Requests with any other Host are rejected rather than redirected.
3. Start only the internal database, bootstrap, and application services, then validate nginx before starting public traffic:

   ```sh
   docker compose --env-file .env -f ops/docker-compose.yml config --quiet
   docker compose --env-file .env -f ops/docker-compose.yml up -d postgres bootstrap web
   docker compose --env-file .env -f ops/docker-compose.yml run --rm --no-deps --add-host web:127.0.0.1 \
     --entrypoint /bin/sh nginx -c "envsubst '\$PUBLIC_HOSTNAME' < /etc/nginx/templates/default.conf.template > /tmp/jobfinder-ingress.conf && nginx -c /etc/nginx/nginx.conf -t"
   ```

4. Start the stack with `docker compose --env-file .env -f ops/docker-compose.yml up -d`. Confirm every HTTP path redirects to the configured HTTPS hostname, HTTPS `/livez` remains available for process diagnosis, and `/readyz` returns 200 only after migration and administrator bootstrap complete. Ordinary HTTPS routes are refused whenever `/readyz` is not successful.
5. Renew certificates through the chosen issuer by atomically replacing both files inside the mounted `TLS_DIRECTORY`, then run `docker compose --env-file .env -f ops/docker-compose.yml exec nginx nginx -t` followed by `docker compose --env-file .env -f ops/docker-compose.yml exec nginx nginx -s reload`. Mounting the directory, rather than individual files, ensures atomic issuer renames are visible inside the container.

If TLS files are absent, invalid, or unreadable, nginx fails closed and does not accept public traffic.
