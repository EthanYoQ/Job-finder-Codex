# 最小无人值守链路候选

未部署，未配置密钥，未安装或启用timer。以下原生systemd/官方CLI接线尚未实测，不能称为迁移完成。

`run-slot.sh`在新机用flock串行启动`run-round.ts`；原36源runner仍使用数据库lease和每来源00:01/12:01北京时间时段排重。原reader以一致性事务读取公开投影，保存内容哈希命名的不可变快照，最后原子替换latest收据。部分来源失败仍可更新其余已发布岗位；lastUpdatedAt来自原reader。

阿里云`refresh.ts`使用官方CLI唤醒自动休眠机器、启动后台任务、等待、pull文件，再调用网页原子安装入口。响应丢失先读持久收据；不重放旧SQL/PUBLISH。没有当前时段确认收据就保留原网页快照。文件传输使用pull，避开exec stdout的1MiB上限。systemd在00:01/12:01北京时间触发，失败每10分钟重试，1小时最多3次；新机flock和DB lease避免并发，来源排重跳过已成功抓取。没有新增队列、Redis或框架。

用户最新要求：连续稳定3个完整北京时间自然日后降为每天00:01。`frequency.mjs`与refresh的持久记录已接入这一判断：必须有两时段的36源真实定时采集、原子入库、搜索/coverage网页回读，以及真实失败恢复验收；手工运行、合成测试和未结束的自然日不计。跨重试合并当时段真正成功抓取的来源，不能用SKIPPED冒充抓取。3天达标后保存dailySince，中午timer只做本机跳过判断，不唤醒或抓取。目前0个已验证自然日；此逻辑仅合成测试通过，未投入真实计时。

部署前仍需：

- 真实恢复数据库和历史未决状态，建立新`instabox-`候选记录；`runtime.env`仅含真实JOBFINDER_CANDIDATE_ID等运行配置，禁止伪造迁移历史。原机`postgres.env`通过Node env-file载入密码，bridge地址在新机读取，不发布PG端口。
- 将runner-candidate、web-candidate、pipeline及同版本node_modules置于同一app目录；runner/web各用相对node_modules链接指向根依赖。入口使用恢复包的bin/node，避免阿里云系统Node20.20.2；仍须实测该Linux二进制版本、glibc兼容与运行，不能仅凭包已存在启用。
- 确认阿里云长期保存/使用InstaBox key的私有位置及服务用户。refresh.env需要INSTABOX_API_KEY、JOBFINDER_PUBLIC_SNAPSHOT_FILE、JOBFINDER_VERIFY_BASE_URL（待验新网页地址）；可选INSTABOX_CLI、JOBFINDER_SCHEDULE_STATE_FILE。本任务尚未向阿里云传此key。
- 实际失败恢复验收通过后才产生JOBFINDER_RECOVERY_EVIDENCE指向的私有JSON：kind=live、verifiedAt及checks中的wake/interruptedCommit/failedSourceKeepsLastGood/failedInstallKeepsLastGood/webRestart均为真实测试结果。当前没有生成这个文件。定时来源还须在真实systemd上验证INVOCATION_ID和timer LastTriggerUSec；不能手填伪造timer运行记录。
- 现有管理员/反馈写入通过可选DATABASE_URL接线；新PG未开放公网，跨机私有连接及休眠时写请求唤醒仍未配置。公开快照路径不依赖此连接。
- 新机真实检查Docker bridge Prisma连接、Linux fsync、源抓取、原子入库和reader；阿里云验证网页安装、重启、暂停/唤醒与timer实际触发。当前新机代码部署确认仍待回复。

本机验证00:01/12:01时段边界与新协议中断恢复的合成行为。恢复不触碰旧candidate/host/manual未知提交；真实PG并发与整轮Linux运行待测。

依据：官方[CLI](https://instabox.sh/docs/cli)、[命令/文件](https://instabox.sh/docs/api/commands)、[休眠与最大运行时长](https://instabox.sh/docs/idle-suspend)。免费机固定30分钟空闲暂停、单次8小时、达到上限后5–20分钟冷却；这里不更改这些设置。
