# Job Finder → InstaBox + PostgreSQL：最小迁移准备

状态：**离线候选，未部署、未接库、未采集、未迁数。** 阿里云网站及现有 HOLD 不变。现有采集和监控保持暂停。

## 可行路线

```text
外部 dot 定时唤醒
  → InstaBox：现有 36 源采集，按源串行执行一次
  → 本机 PostgreSQL：原事务、锁、岗位、观察记录
  → 原 reader 生成公开 JSON 快照
  → 阿里云保存完整快照；现有网页只读快照
```

不增加 Redis、队列服务、连接代理、第二套调度器或新 UI。PostgreSQL 与采集程序同机，数据库端口仅本机可用。阿里云不能实时依赖会休眠的 InstaBox 数据库。

### 已有环境信息

父任务实测：Debian 13 x86_64；Node 22.23.3、Python 3.13.5、Chromium 154、Docker 29.8.2；4 vCPU / 8 GB；`/data` 持久盘 20 GB、约 16 GB 可用。Docker daemon/Compose 是否可实际启动尚未验证。不要把客户端版本当成 daemon 可用证明。

Free InstaBox 空闲约 30 分钟会暂停，单次运行最长 8 小时，之后有 5–20 分钟冷却。箱内 cron、systemd timer、`while` 或容器 restart 都不能唤醒已暂停的箱子。

原 wrapper 每源上限 30 分钟，36 源串行最坏为 18 小时。因此不能承诺一次唤醒完成全轮。新入口应在剩余时间不足一个源的原上限时停止启动新源，保留原逐源结果，下次依真实观察去重继续；不能为了赶 8 小时强行取消可能已提交的源。

现行 `run-original-functions.js` 采用北京时间 **08:00 / 20:00** 的 12 小时窗口，并按数据库真实成功观察去重。不能误用旧 `p0-portable-scheduler.ts` 的 00:01 / 12:01。外部唤醒要能在睡眠及冷却之后恢复，并重新读取真实状态。暂停/掉线时，已派发但未确认的写入仍是 UNKNOWN，不自动重试。

现阶段没有创建或启用定时任务。外部无人值守唤醒能力未通过实际跨休眠测试，不能声称无人值守已完成。

## 本包只做三件事

1. `compose.yaml`：从既有 `web-ready/ops/docker-compose.yml` 取 PostgreSQL 16 单服务。保留原镜像及健康检查，数据写入 `/data/jobfinder/postgres`，端口仅绑定 `127.0.0.1`。不带旧 bootstrap、scheduler、web 或 monitor。
2. `postgres-executor.mjs`：供新采集入口使用的内部 `pg.Client` 执行函数。一次发送原 SQL，不拆分事务，不改 SQL，不重试。连接失败返回 NOT_DISPATCHED；提交后错误保留 UNKNOWN。不加载凭据、不连接现有库、没有 SQL 网络接口。它**尚未接入现有 relay**，也不伪造 Supabase 工具响应。
3. `public-snapshot-file.mjs`：保存/读取原 reader 的 `portable-public-snapshot-v1` 公开投影。原子换文件，保留原 `generatedAt`，不把旧快照标为当前验证。它是网站只读快照的落盘组件，**不是已改好的网页或完整网站镜像**。

没有新增依赖。现有应用已锁定 `pg` 8.16.3。脚本只使用 Node 内建测试；不会启动服务。

执行模块的 `SUCCEEDED` 只表示驱动收到结果；业务成功仍须原 producer 的 `COMMITTED_EXACT` 回读和终态，不能用驱动结果替代。

```sh
./connector-host-runtime/node --test job-finder-instabox-migration-20261031/migration.test.mjs
```

## 必须迁移的差异

| 对象 | 已观察事实 | 最小处理 |
|---|---|---|
| 数据库 | 旧 relay 调用固定 Supabase connector；另一个旧 pg adapter 也锁定 Supabase host/project | 新目标仅用开源 PostgreSQL。新入口使用直接 pg 连接，原 producer 与 SQL 事务继续复用；不改旧入口去回放请求 |
| 初始化 | 原 Compose bootstrap 只接受既有 36 条迁移历史，文档禁止在空库重放历史迁移 | 后续从获准的现有数据库逻辑备份恢复应用 schema、数据和历史。先检查 provider 扩展/角色依赖；不能直接跑 raw Prisma、伪造迁移行或删历史 |
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
/data/jobfinder/postgres/   PostgreSQL 数据
/data/jobfinder/runtime/    获准的新入口与现有采集代码
/data/jobfinder/state/      原运行状态、HOLD、证据和未知结果
/data/jobfinder/snapshots/  完整公开快照
/data/jobfinder/backups/    PostgreSQL 逻辑备份
```

目录只在方案中列出，本任务未在 InstaBox 建目录或改变权限。旧请求存档与新运行队列保持分开。单块 `/data` 持久盘不是异地备份；继续复用已有获准备份目的地，不另建存储系统。

## 切换前只验真实风险

1. 确认 Docker daemon/Compose 可用；确认 PostgreSQL 重启后仍读到 `/data` 数据。不用生产数据做初测。
2. 用临时测试库验证原只读多语句与发布事务、两连接争锁、断连后 UNKNOWN 回读。当前内建测试使用假 Client，未证明 PostgreSQL 并发语义。
3. 单独获准导出/恢复后，验证数据库迁移历史和应用关系；保留 HOLD/UNKNOWN。新建库不能自动继承旧库中“无活动写者”的判断。
4. 在新目标、新候选和新批次上，验证原源采集 → 原事务提交 → 精确数据库回读 → 公开快照。受 HOLD 的源仍跳过。
5. 测试 InstaBox 真正暂停后由外部 dot 唤醒，再验证当前窗口去重、不可重放 UNKNOWN、完整快照仍可读。至少观察真实定时窗口，不用手工启动冒充定时验收。
6. 只有上述验证及用户正式切换批准后，才改阿里云读快照路径并恢复获准调度。失败保留旧完整快照，不清空岗位。

## 尚待逐动作确认

- 新库管理员/采集/只读角色、密码提供方式及本机访问配置。
- 生产数据库导出和迁移内容；目标数据库恢复。
- 必要的服务器权限/防火墙/密钥变更。
- 新 runtime 候选注册与受限单源实际运行。
- 阿里云网站改动、快照传输权限、正式切换及恢复调度。

普通官方软件安装已获按需授权，但本包未安装软件。若 Docker daemon 不可用，不自行改成别的架构；先报告原因和替代方式。

## 技术依据

- [node-postgres Client](https://node-postgres.com/apis/client)：复用现有驱动，不建立额外代理。
- [PostgreSQL 16 Simple Query 协议](https://www.postgresql.org/docs/16/protocol-flow.html)：原多语句 SQL 按一条请求发送，不能拆开原事务边界。
- [Docker Compose services](https://docs.docker.com/reference/compose-file/services/)：持久 bind mount、loopback port 与 restart 的实际范围。
- 本地 `web-ready/docs/deployment-bootstrap.md`、`docs/portable-crawl-lease.md`，当前 `original-relay-automation-20261017T0609Z/run-original-functions.js`。

未做：生产连接、官方采集、凭据配置、旧请求恢复、迁数、网页修改、定时启用。主要未验证风险：跨休眠唤醒、实际数据库/浏览器兼容、全链路接入及容量。这个准备包不是迁移完成报告。
