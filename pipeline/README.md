# 无人值守链路

代码已部署到新机 `/data/job-finder/app` 和阿里云 `/opt/jobfinder-new/app`。33/36源真实采集、入库及候选网页回读已通过。经用户明确授权，阿里云持续凭据、网页服务和refresh timer已启用；2026-10-31 12:22 UTC手工触发服务完成真实刷新，尚无实际定时完成记录。生产尚未切换。当前进度以项目根目录 `CURRENT-RESULT.md` 为准。

`run-slot.sh` 用 flock 启动 `run-round.ts`。36 源串行抓取，由数据库 lease 防止并发。每个来源按北京时间 00:01 起算的 24 小时窗口排重。原 reader 事务读取公开投影，生成不可变内容哈希快照，再原子替换 latest 收据。失败来源保留最近有效发布，更新时间沿用原数据。

阿里云 `refresh.ts` 使用官方 CLI wake、exec后台任务、pull快照和原子安装，然后实际回读搜索及coverage。响应丢失先读持久回执；没有当前slot回执则保留原网页。systemd每10分钟重试失败，取消会使自动重试停止的每小时启动次数上限。flock和数据库lease避免并发；没有队列、Redis或新框架。

生产定时为每天北京时间 00:01。原自动重试在同一日批次内补采，跨重试的成功来源直接查持久数据库。变更前的午间回执保留原批次 ID。评估自然运行与恢复时，仍使用真实定时、数据库提交、快照和正式网页回读。

部署接线：

- 新机已有 `runtime.env` 中的真实候选身份和 `postgres.env` 中的数据库凭据；用env-file载入，Docker bridge连接PG，不映射公网端口。旧candidate和未决记录不重放。
- 两机均使用交付包 `bin/node`、根目录node_modules及runner/web相对链接。
- 阿里云已使用 `/opt/jobfinder-new/private/refresh.env`，root0600，配置现有key、官方CLI、快照路径及候选回读URL。文件不进入仓库或日志。service显式User=root以获得CLI需要的HOME；原运行身份未改变。
- 反馈/管理员写入使用 [私有后台](../web-candidate/REMOTE-WRITE-README.md)，公开GET只读本机快照。一次真实无个人信息反馈返回201，按ID核对后精确清理，零残留；管理员成功登录尚未验收。
- 恢复证据应覆盖实际暂停唤醒、中断恢复、失败来源保旧、安装失败保旧及网页重启。timer 来源由实际 INVOCATION_ID 和 LastTriggerUSec 确认。

生产切换还需要剩余来源修复、私有写通道验收和源库最终同步。当前已验证的是候选链路，不代表无人值守迁移完成。
