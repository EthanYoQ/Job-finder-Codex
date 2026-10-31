# 私有写后台

网页进程可选择本地 `DATABASE_URL` 或 `JOBFINDER_REMOTE_WRITE_MACHINE`，不能同时配置。两者都未配置时保留明确的 `503 WRITE_BACKEND_UNAVAILABLE`。公开 GET 始终读取本机持久快照；反馈、公司推荐（含反馈接口中的隐私请求）和 `/admin/api/` 通过私有后台执行原 `handlePublicApi` / `handleAdminApi`，不公开 PostgreSQL 端口，不另建数据库或队列。

阿里云网页服务配置：

```ini
JOBFINDER_PUBLIC_SNAPSHOT_FILE=/var/lib/job-finder/public.json
JOBFINDER_REMOTE_WRITE_MACHINE=m_agqzacofwxyhtea4rr7b6tvbba
INSTABOX_CLI=/usr/local/bin/instabox
# INSTABOX_API_KEY 由已授权的私有 EnvironmentFile 注入；不要写进本文件或命令参数。
```

快照和 CLI 路径应按实际部署位置填写。网页服务用户必须可执行官方 CLI；API key 只通过进程环境提供，缺少 key 时写请求返回未发出的 503，不调用 CLI、不回退读取 CLI 登录配置，公开快照仍可提供查询。保持现有 HOST/PORT、可信反向代理 IP 和快照权限配置。上游反向代理的读超时至少 90 秒；不要给 POST 配置自动重试。浏览器公开 GET 不等待新机启动。

新机需要这些固定已部署路径：

- `/data/job-finder/app/bin/node`
- `/data/job-finder/app/node_modules/tsx/dist/loader.mjs` 及现有 Prisma 依赖/引擎
- `/data/job-finder/app/web-candidate/src/server/private-write-main.ts` 和同包源码
- `/data/job-finder/postgres.env`：现有 `POSTGRES_PASSWORD`，仅授权服务账户可读
- 本机 Docker 容器 `jobfinder-postgres`：database/user 均为 `jobfinder`，bridge IPv4 可从本机 `docker inspect` 得到；执行账户有 Docker 权限，不映射 PG 公网端口

每个请求先 `wake --json`，仅当 `state=running` 且 `runtime.ready=true` 时才发出一次固定 Node 命令。并发请求只共享正在进行的 wake promise；各自 stdin 和响应独立。唤醒最长 45 秒。CLI exec 的服务端时限为 20 秒、本地等待为 25 秒；私有进程的 Docker 查询最长 5 秒、原业务处理最长 8 秒，总准备、处理和可选手动启动上限 17 秒。没有后台重发或写队列。

唤醒失败或仍处于人工暂停状态：`503 WRITE_BACKEND_UNAVAILABLE`、`retryable:true`，本请求尚未发出，原前端保留输入并允许用户稍后提交。发出 exec 后超时、断线、损坏/截断响应：`504 WRITE_RESULT_UNKNOWN`、`retryable:false`；业务内部异常同样沿用未知结果。超时不证明 SQL 回滚，禁止自动重复提交，须通过业务记录核实。

请求正文、管理员凭据和令牌仅走 stdin，不进入 argv。请求封装最大 512 KiB，低于官方 CLI 的 1 MiB stdin 临时上传阈值。CLI 命令历史保存 stdout，因此每个请求生成独立 AES-256-GCM 密钥，仅随 stdin 传入；stdout 只有认证加密响应，网页进程捕获并解密。私有入口不打印业务、Prisma 或错误详情；本地命令错误也不打印 stdout/stderr。不要给 CLI 增加 `--stream`、后台任务、输入/输出日志或 shell tracing。

Aliyun 长驻进程在转发公共 POST 前继续执行原同意检查和原每 IP/路径限流；私有短进程再次执行原输入和权限校验。管理员会话和实际业务写入由原数据库服务处理，授权失败仍是真实 401。原管理员手动抓取接口成功返回 202/QUEUED 后，仅为该新回执 ID 调用 `sudo -n systemctl start --no-block jobfinder-manual@ID.service`（2 秒时限）。ID 限定字母、数字、下划线和连字符。`START_REQUESTED` 仅表示 systemd 接受启动请求；`NOT_STARTED` 表示明确失败；客户端超时返回 `START_UNCONFIRMED`。三者均保留已入队回执，不重复创建请求。前端显示回执，并通过原 `/admin/api/manual-crawls` 只读查询状态；后续 dashboard 读取失败不抹去已知入队结果。手动抓取只做预览、不发布到公开网页。

新机安装 `pipeline/jobfinder-manual@.service` 后需要 `systemctl daemon-reload`，无需启用任意实例。模板和只消费新请求的实现由 runner 交付，`Restart=no`；保留原数据库状态和共享 lease。既有 user 的 sudo 权限须由部署方实测，不修改 sudoers 或增加权限。若模板未安装或无权限，记录仍留在原队列，页面明确显示启动未确认；每轮采集释放lease后会检查登记后的新QUEUED：先查同ID unit状态、再查数据库，仅确认未启动时请求启动；状态不明时不重发，不重放RUNNING或历史请求。

本机证据：`prepared/simple-review/remote-write.test.mjs` / `remote-write.tap`（5 项合成测试通过），`remote-typecheck.json`（零类型诊断）。覆盖未唤醒不发送、人工暂停不发送、发送后不重放、加密回执、原登录/反馈处理、公开查询与唤醒隔离、长驻限流和实际 stdin 子进程。新增 `manual-launch.test.mjs` / `manual-launch.tap` 3 项通过（固定 unit、失败保留回执及原隐私请求），`manual-launch-browser.json` 验证新 dist 的实际回环交互，`remote-frontend-build.log` 记录重建。以上为合成验证记录；随后本机通过现有授权 CLI 对已部署新机完成真实错误会话401加密回执测试。尚未向阿里云配置持续key，也未执行真实反馈或管理员写入。


