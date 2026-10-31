# Job Finder → InstaBox + PostgreSQL：最小迁移准备

状态：**本包为离线候选，未部署、未接库、未采集、未迁数。** 父任务已另行启动新机 PostgreSQL；这不是本包验证结果。阿里云网站及现有 HOLD 不变，现有采集和监控保持暂停。

## 可行路线

```text
外部 dot 定时唤醒
  → InstaBox：现有 36 源采集，按源串行执行一次
  → 本机 PostgreSQL：原事务、锁、岗位、观察记录
  → 原 reader 生成公开 JSON 快照
  → 阿里云保存完整快照；现有网页只读快照
```

不增加 Redis、队列服务、连接代理、第二套调度器或新 UI。PostgreSQL 与采集程序同机，不发布数据库 host 端口。阿里云不能实时依赖会休眠的 InstaBox 数据库。

### 已有环境信息

父任务实测：Debian 13 x86_64；Node 22.23.3、Python 3.13.5、Chromium 154、Docker 29.8.2；4 vCPU / 8 GB；`/data` 持久盘 20 GB、约 16 GB 可用。父任务已启动空 PostgreSQL 16 容器 `jobfinder-postgres`，数据库/用户均为 `jobfinder`；数据位于 `/data/job-finder/postgres`，未发布 host 端口。随后只读确认源库是 PostgreSQL **17.6**、约 315 MB，因此迁移目标改为 **17**；新模板使用官方 `postgres:17-bookworm`，实际重建由父任务另行执行。**不能把 16 的物理数据目录直接挂给 17 启动**。本包未验证实际 bridge 连通性、认证及非 root UID。

官方 InstaBox `POST /v1/machines/{id}/exec` 已由父任务实测。由 dot 在外部定时调用；API key 不进入本包、源码或日志。当前没有启用新定时任务。

Free InstaBox 空闲约 30 分钟会暂停，单次运行最长 8 小时，之后有 5–20 分钟冷却。箱内 cron、systemd timer、`while` 或容器 restart 都不能唤醒已暂停的箱子。

原 wrapper 每源上限 30 分钟，36 源串行最坏为 18 小时。因此不能承诺一次唤醒完成全轮。新入口要求外部提供真实平台会话截止 `JOBFINDER_SESSION_DEADLINE`（UTC），不使用进程开始时间或 Linux uptime 冒充剩余会话。剩余不足 50 分钟（原 30 分钟源上限加退出余量）时停止启动新源，保留原逐源结果，下次依真实观察去重继续；不能为了赶 8 小时强行取消可能已提交的源。

现行 `run-original-functions.js` 采用北京时间 **08:00 / 20:00** 的 12 小时窗口，并按数据库真实成功观察去重。不能误用旧 `p0-portable-scheduler.ts` 的 00:01 / 12:01。外部唤醒要能在睡眠及冷却之后恢复，并重新读取真实状态。暂停/掉线时，已派发但未确认的写入仍是 UNKNOWN，不自动重试。

现阶段没有创建或启用定时任务。外部无人值守唤醒能力未通过实际跨休眠测试，不能声称无人值守已完成。

## 已接入的最小部件

1. `compose.yaml`：复用既有 Compose 的单服务布局和健康检查，按源库版本改为官方 PostgreSQL 17 镜像；持久路径 `/data/job-finder/postgres` 不发布 host 端口。不带旧 bootstrap、scheduler、web 或 monitor。仅为获准重建后的目标模板，不直接启动第二个数据库，也不直接挂载旧 16 数据目录。
2. `postgres-executor.mjs` + `instabox-postgres.mjs`：通过固定容器的当前 bridge IP 连接 `jobfinder`。每次重新查地址，不写死 IP，不接受旧 Supabase DSN。原 SQL 一次发送；失败返回原 relay 所需的 `status/code/outcome`，不返回含凭据的错误文本。密码提供函数由机器端另行配置，本包不解析或读取真实 `postgres.env`。
3. `postgres-stage.mjs`：接到原 36 源 serial 的 host-stage 接口，保留原 packet review、mark、单次派发、响应和 READ_OUTCOME。数据库工厂的安装根决定 relay/producer 路径，候选必须使用新的 `instabox-` 名称，并匹配原 host binding 的 candidate/build。**实际新安装、新 binding 和新库尚未装配验证。**
4. `public-snapshot-file.mjs` + `verified-snapshot.mjs`：原 reader 读取新库后，复用原搜索/覆盖投影，对照原 `EXPECTED_TARGET_API.json` 的全部目标字段，再原子保存完整公开快照。保留原验证时间；返回 `SNAPSHOT_VERIFIED`，不冒充阿里云 `WEB_VERIFIED`。这不是已改好的网页。

5. `native-round.mjs`：替换 Functions I/O，使用原 serial、真实 ChildProcess 终态、原 host CLI/reviewer/reader。`--check` 只读枚举当前 36 源及缺失依赖；`--run` 固定新安装根，要求新 candidate/binding、导入 HOLD/UNKNOWN、机器端密码及真实平台会话截止。原 18 条固定 HOLD 不变；浏览器依赖源尚未移植，显式停止而非伪造采集。
6. `reviewer-paths.patch`：9 个原 reviewer 文件的静态相对路径补丁，逻辑不变。仅在**获准的新安装副本根目录**用 `git apply`；不能对旧生产树应用。本地测试先复制这些文件到临时根，再应用补丁，实际导入 5 个原 gate 并验证新根下 wrapper deadline；没有运行旧请求。

7. `chromium-dom.mjs` + `browser-evidence.mjs`：离线浏览器候选，复用已安装 Playwright 的 tab/locator 和原 CSPC/JNJ DOM 遍历，移植 BI 存档逻辑；不另造浏览器服务。快照标为本地 Chromium ARIA，而非 CUA 或 HTTP 证据。JNJ 保持原严格记录格式，传输标记只放实际快照和 manifest。**尚未接入 `native-round`，浏览器源仍被阻断，全部 HOLD 不变。**

没有新增依赖。现有应用已锁定 `pg` 8.16.3 和 `playwright-core` 1.61.1。脚本使用 Node 内建测试；浏览器集成测试仅建立 127.0.0.1 合成页面，不访问真实来源。

执行模块的 `SUCCEEDED` 只表示驱动收到结果；业务成功仍须原 producer 的 `COMMITTED_EXACT` 回读和终态，不能用驱动结果替代。

```sh
TSX_DISABLE_CACHE=1 ./connector-host-runtime/node \
  --import ./five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/vendor/c60-source/node_modules/tsx/dist/loader.mjs \
  --test job-finder-instabox-migration-20261031/{migration,native-round,relay-integration,reviewer-paths,snapshot-integration}.test.mjs
```

### 新入口命令（尚未在新机执行）

`--check` 仅列缺失安装/新 binding，不建立目录、不调用 Docker/数据库。获准实装后：

```sh
APP=/data/job-finder/app
"$APP/connector-host-runtime/node" \
  "$APP/job-finder-instabox-migration-20261031/native-round.mjs" --check

# 机器端另行注入已获准的密码和真实平台会话截止；不把秘密写进命令或日志。
"$APP/connector-host-runtime/node" \
  --import "$APP/five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/vendor/c60-source/node_modules/tsx/dist/loader.mjs" \
  "$APP/job-finder-instabox-migration-20261031/native-round.mjs" --run
```

运行仍需真实的新候选注册、host binding、HOLD/UNKNOWN导入及浏览器适配。原 host launcher 验证固定 Node 二进制及非 root owner/目录；系统 Node 版本号相同不能替代这些既有资格。补丁只迁移 reviewer 路径，没有关闭这些约束。

### 当前浏览器验证结果

核心离线测试 **16/16 通过**；另一个纯合成 Playwright 接口映射测试通过。真实浏览器 fixture **未通过**：本工作区 Chromium 启动因 `socket() failed: Operation not permitted` / SIGABRT 失败，尚未打开页面；权限复核启动也被执行环境内部只读文件系统阻断。没有关闭 Chromium sandbox，没有访问真实来源。

待在获准的运行环境执行下列**仅回环页面**测试；通过后仍需原审核链验证受准单源，不能解除既有 HOLD：

```sh
./connector-host-runtime/node --test job-finder-instabox-migration-20261031/chromium-dom.test.mjs
```

## 必须迁移的差异

| 对象 | 已观察事实 | 最小处理 |
|---|---|---|
| 数据库 | 旧 relay 调用固定 Supabase connector；另一个旧 pg adapter 也锁定 Supabase host/project | 新目标仅用开源 PostgreSQL。新入口使用直接 pg 连接，原 producer 与 SQL 事务继续复用；不改旧入口去回放请求 |
| 初始化 | 原 Compose bootstrap 只接受旧恢复树的 36 条迁移历史；当前 native compiler 还要求后来的 delta/fence/Novo schema profile | 后续从获准的当前数据库逻辑备份恢复完整应用 schema、数据和历史，包括 `extensions.digest` 及触发器。不能把旧 36 条当成当前全库，不能重放 raw Prisma、伪造迁移行或删历史 |
| 源范围 | 当前原始 relay 枚举 36 源，包含 PORTABLE / TRUE_A / TRUE_B。旧 portable scheduler 枚举历史 41 源 | 保留原 36 源路由与公司范围；不启动旧全量 scheduler |
| 浏览器 | 部分源依赖 Functions 内 cloud-CDP 流程 | 在新入口中复用原浏览器采集逻辑，连接 InstaBox Chromium；仍需按真实源验证，安装 Chromium 不等于流程已移植 |
| 发布判断 | 原始事务使用 DB 上下文、候选身份、锁和精确结果检查 | 保留判断与锁。原 project/host/build 绑定不能直接搬给新库；需要新目标配置及新 runtime 资格 |
| HOLD | 现行入口含 18 条固定 HOLD，另有动态 HOLD、PRE_CAPTURE 隔离记录和未知请求 | 原样保留源 ID、原因、原请求记录及结果；已拒绝和 UNKNOWN 均不得通过新 transport 重放 |
| 网站 | 现有 reader 的公开快照缓存只在内存；阿里云仍为网页主机 | 获准后给原 reader 接入本地文件读取，并显示快照时间/非实时状态。传输成功后才替换阿里云完整快照 |

### 数据从哪里来

- **岗位和状态**：未来经单独授权导出的现有应用数据库。网页 API 不是全库备份，历史抓取 JSON 也不能代替当前数据库状态。
- **schema 和迁移历史**：同一获准逻辑备份，加当前源代码。旧恢复树已明确不支持直接空库初始化。
- **采集逻辑**：`original-relay-automation-20261017T0609Z/`、原 producer/reader 源树以及当前真实 runtime 版本。旧 README、候选目录名、历史注册身份均不是新目标资格。
- **HOLD/UNKNOWN 与证据**：现有源级 HOLD、`rounds/`、原 run 与 relay 记录。迁移到持久审计目录；不作为新入口的待执行队列。
- **公开快照**：新库中真实提交结果经原 reader 得出的公开投影。不能从原始证据直接渲染岗位或绕过发布判断。

### 持久目录

```text
/data/job-finder/postgres/  PostgreSQL 数据
/data/job-finder/app/       获准的新入口、采集代码、新 binding/round
/data/job-finder/history/   旧请求只读审计，不作为可执行 relay
/data/job-finder/app/snapshots/ 完整公开快照
/data/job-finder/backups/   PostgreSQL 逻辑备份
```

目录只在方案中列出，本任务未在 InstaBox 建目录或改变权限。旧请求存档与新运行队列保持分开。单块 `/data` 持久盘不是异地备份；继续复用已有获准备份目的地，不另建存储系统。

## 切换前只验真实风险

1. 验证机器上的 Node 能连到固定容器的 bridge IP；验证实际认证、非 root UID 与持久数据重启。不用生产数据做初测，不开放公网。
2. 用临时测试库验证原只读多语句与发布事务、两连接争锁、断连后 UNKNOWN 回读。当前内建测试使用假 Client，未证明 PostgreSQL 并发语义。
3. 单独获准导出/恢复后，验证数据库迁移历史和应用关系；保留 HOLD/UNKNOWN。新建库不能自动继承旧库中“无活动写者”的判断。
4. 在新目标、新候选和新批次上，验证原源采集 → 原事务提交 → 精确数据库回读 → 公开快照。受 HOLD 的源仍跳过。
5. 测试 InstaBox 真正暂停后由外部 dot 唤醒，再验证当前窗口去重、不可重放 UNKNOWN、完整快照仍可读。至少观察真实定时窗口，不用手工启动冒充定时验收。
6. 只有上述验证及用户正式切换批准后，才改阿里云读快照路径并恢复获准调度。失败保留旧完整快照，不清空岗位。

## 尚待逐动作确认

- 用户已确认生成并在机器保存数据库密码。本包尚未使用该密码；额外角色、权限或访问配置变更仍逐动作确认。
- 数据库导出/恢复由父任务按获准范围另行执行，本包不调用它们。
- 必要的服务器权限/防火墙/密钥变更。
- 新 runtime 候选注册与受限单源实际运行。
- 阿里云网站改动、快照传输权限、正式切换及恢复调度。

普通官方软件安装已获按需授权，但本包未安装软件。如果既有 bridge 通道不可用，不自行开放端口或换数据库架构；先报告原因和替代方式。

## 技术依据

- [node-postgres Client](https://node-postgres.com/apis/client)：复用现有驱动，不建立额外代理。
- [PostgreSQL 17 Simple Query 协议](https://www.postgresql.org/docs/17/protocol-flow.html)：原多语句 SQL 按一条请求发送，不能拆开原事务边界。
- [PostgreSQL 官方镜像](https://hub.docker.com/_/postgres)：目标采用 17-bookworm；物理数据目录不能跨主版本直接复用。
- [Docker Compose services](https://docs.docker.com/reference/compose-file/services/)：持久 bind mount、未发布端口与 restart 的实际范围。
- 本地 `web-ready/docs/deployment-bootstrap.md`、`docs/portable-crawl-lease.md`，当前 `original-relay-automation-20261017T0609Z/run-original-functions.js`。

离线验证：实际 `FilePilotRelay` 的临时请求文件与原 serial 已贯通；固定/动态/隔离 HOLD、单次派发及 UNKNOWN 停止规则通过。host、pg、producer/reviewer 回调仍为合成实现；公开 API 投影使用原模块，输入为合成快照。**这些不是实际 PostgreSQL、真实采集或端到端无人值守验证。**

未做：生产连接、官方采集、真实凭据配置、旧请求恢复、迁数、网页修改、定时启用。主要未验证风险：新单轮入口在箱内实装执行、跨休眠唤醒、真实 PostgreSQL 17 的事务/锁与浏览器兼容、新旧目标完整装配及容量。代码入口存在不等于已运行全链路。

## 无秘密代码备份

目标为原私有 `EthanYoQ/Job-finder-Codex` 分支 `backup/instabox-migration-20261031`，目录 `migration/instabox-20261031/`。仅备份本包无秘密脚本、补丁、测试和说明，不包含凭据或职位原始数据。初版 5 文件的已验证提交为 `0568de8c668d7297c6fdf4fed2b07b8e1789f4b4`；本版新增入口及浏览器适配，以后续提交和逐文件读回结果为准。
