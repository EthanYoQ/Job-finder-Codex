# Combine same-stage backup command pairs

Parent external1624 7e4569f9a711d866a10a040fdb407599b5a61f12; native112 unchanged. One runtime file: evidence-backup-functions.js. Combine mkdir with packaging and download with restore verification using the existing shell's &&. No new wrapper, dependency, entry/session/poll change or collection.

Each successful source backup now needs2 command/exec tool round trips instead of4. Both pairs already ran sequentially in the same PACKAGE or READBACK stage, with no intermediate consumers. mkdir/download emit no successful stdout, so JSON.parse still consumes only the original pack/verify JSON. Download's Python with closes the output before verify starts. && prevents the next command on any preceding failure.

The strongest reason to keep separate commands is distinct progress/error ownership; neither pair has such a boundary. Actual UPLOAD_STARTED/UPLOADED durable markers, upload/fetch tools, stage attribution, PENDING failure handling, no automatic retry, and downloaded hash/member-count verification remain in their original order. No claim that upload/network speed improved is made.

Focused local verification used existing real Novartis evidence and exact relay IDs. Actual Python packaging/download-through-local-file/restore ran for both versions; all20 archive members are byte-identical. Successful command calls were4 versus2. Injected package failures remained PACKAGE/PENDING with zero uploads; download failures remained READBACK/PENDING with no success receipt. Connector tools were local mocks, so no actual Drive upload, HTTP request, acquisition, publication or DB write occurred. Syntax and whitespace checks pass.

Back up only after/evidence-backup-functions.js at module root plus this README and verification-summary.json. Do not include local real tar fixtures. Original loop owner must apply only after backup/readback and an idle window. Current active file remains unchanged. This change is independent of ongoing producer-session recovery work.
