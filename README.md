# Bounded, read-only Job Finder schedule audit

This source bundle contains the exact second-round server probe and local submission controller, plus synthetic local tests. It does not contain live server responses, PM2 data, credentials, invocation receipts, or the actual submission intent.

## Files

- audit.py: fixed 15 timer queries, direct triggered service queries, template definitions, and live identity projection for eight specified old PM2 entries
- read-schedules.sh: the exact frozen Python 3.6 compatible server probe, using isolated mode and no bytecode writes
- rpc-readonly.js: extracted JavaScript embedded in the probe; connects only to an existing, verified PM2 socket using getMonitorData
- control.py: local official Aliyun CLI submission/query controller; never replay an existing intent or unknown submission
- test_redaction.py: synthetic local regressions for nonzero output retention and secret/URL projection

## Dependencies and boundaries

Local controller: Python 3 standard library, official Aliyun CLI 3.5.1, and an already configured profile outside this bundle. The profile directory is referenced but its contents are never included.

Server probe: Python 3.6+, systemctl, readable procfs and exact known configuration files. PM2 inspection additionally requires an already running daemon, existing /root/.pm2/rpc.sock, Node at /opt/node22/bin/node, and installed pm2-axon / pm2-axon-rpc transport modules. No installation occurs.

The probe never imports PM2 Client or CLI, starts a daemon, changes services, or makes database/business-network requests. RPC responses are filtered on the server before output. Full commands and arguments remain server-side; only hashes, known identity matches and allowed status fields are returned. A stopped historical HTTP server entry is not proof that every possible collector is disabled.

Each operational invocation requires a separately authorized, newly reviewed local intent with a unique command name and the exact script SHA256. The controller writes an exclusive submit-attempt record before submitting once, disables CLI retries, saves the InvokeId immediately, and queries only that ID. Never retry an unknown submission.

## Local validation only

Run test_redaction.py with Python 3, syntax-check read-schedules.sh with bash -n, and syntax-check rpc-readonly.js with node --check. These checks do not contact the server. Server probe syntax is also validated using Python's 3.6 grammar.

The actual outputs and the two-round comparison are stored under a separate private evidence manifest and are excluded from the source backup plan.

## Upstream reference

PM2 direct RPC transport and read method: https://raw.githubusercontent.com/Unitech/pm2/master/lib/Client.js
The probe uses the existing installation's transport modules; it does not download or execute this web reference.
