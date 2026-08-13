# Single-server TLS handoff

The production Compose stack publishes only nginx on host ports 80 and 443. PostgreSQL and the application stay on the internal Compose network.

1. Obtain a certificate outside this repository. Place `fullchain.pem` and `privkey.pem` in a root-owned directory on the server. Grant the container's fixed UID 101 read/traverse access through a narrowly scoped group or ACL; never make the private key world-readable and never commit either file.
2. Download both `deployment-image-receipt.json` and `deployment-image.env` from the successful Production image workflow, keep the receipt unchanged, and merge the env entry into `.env`. Set `PUBLIC_HOSTNAME` to the exact public DNS name and `TLS_DIRECTORY` to the certificate directory's absolute host path. The GHCR repository is private, so authenticate once with a minimal GitHub token that has only `read:packages` for this package, preferably through the server's Docker credential helper: `printf '%s' "$GHCR_READ_TOKEN" | docker login ghcr.io --username "$GHCR_USER" --password-stdin`, then unset both variables. Never put the token in `.env`. Set `HTTP_PORT` or `HTTPS_PORT` only if the host uses non-default ports. Requests with any other Host are rejected rather than redirected; rotate the read token independently of the image digest.
3. Start only the internal database, bootstrap, and application services, then validate nginx before starting public traffic:

   ```sh
   DEPLOYMENT_IMAGE_RECEIPT_PATH=deployment-image-receipt.json JOB_FINDER_IMAGE_DIGEST="$(sed -n 's/^JOB_FINDER_IMAGE_DIGEST=//p' .env)" npm run image:deployment-contract-check
   npm run ops:deploy-qualified -- deployment-image-receipt.json .env postgres bootstrap web
   docker compose --env-file .env -f ops/docker-compose.yml run --rm --no-deps --add-host web:127.0.0.1 \
     --entrypoint /bin/sh nginx -c "sh /usr/local/bin/render-jobfinder-nginx-config && nginx -c /etc/nginx/nginx.conf -t"
   ```

4. Start all remaining roles with `npm run ops:deploy-qualified -- deployment-image-receipt.json .env`. This command validates the receipt and its self-hash, requires the env digest to match its immutable manifest, pulls that exact image, validates Compose, and only then starts services. Confirm every HTTP path redirects to the configured HTTPS hostname, HTTPS `/livez` remains available for process diagnosis, and `/readyz` returns 200 only after migration and administrator bootstrap complete. Ordinary HTTPS routes are refused whenever `/readyz` is not successful.
5. Renew certificates through the chosen issuer by atomically replacing both files inside the mounted `TLS_DIRECTORY`, then run `docker compose --env-file .env -f ops/docker-compose.yml exec nginx nginx -t` followed by `docker compose --env-file .env -f ops/docker-compose.yml exec nginx nginx -s reload`. Mounting the directory, rather than individual files, ensures atomic issuer renames are visible inside the container.

If TLS files are absent, invalid, or unreadable, nginx fails closed and does not accept public traffic.
