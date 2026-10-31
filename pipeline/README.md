# 无人值守链路

代码已部署到新机 `/data/job-finder/app` 和阿里云 `/opt/jobfinder-new/app`。新库恢复、真实部分来源采集、快照安装及候选网页回读已通过。生产尚未切换，阿里云持续凭据配置仍按父任务要求暂停，refresh timer 尚未安装/启用。当前进度以项目根目录 `CURRENT-RESULT.md` 为准。

`run-slot.sh` 用 flock 启动 `run-round.ts`，原36源串行抓取并使用数据库 lease、每来源北京时间00:01/12:01时段排重。原reader事务读取公开投影，生成不可变内容哈希快照，再原子替换latest收据。失败来源保留最近有效发布；更新时间沿用原数据，不把快照生成时间当抓取时间。

阿里云 `refresh.ts` 使用官方 CLI wake、exec后台任务、pull快照和原子安装，然后实际回读搜索及coverage。响应丢失先读持久回执；没有当前slot回执则保留原网页。systemd每10分钟重试失败，1小时最多3次。flock和数据库lease避免并发；没有队列、Redis或新框架。

排程为北京时间00:01和12:01。连续3个完整自然日的两时段36源真实抓取、入库、网页回读及实际失败恢复通过后，保存dailySince，中午不再唤醒。手工运行和合成验证不计，目前稳定日0。跨重试的成功来源直接查持久数据库，不依赖上次进程能否写出收据。

部署接线：

- 新机已有 `runtime.env` 中的真实候选身份和 `postgres.env` 中的数据库凭据；用env-file载入，Docker bridge连接PG，不映射公网端口。旧candidate和未决记录不重放。
- 两机均使用交付包 `bin/node`、根目录node_modules及runner/web相对链接。
- 阿里云拟使用 `/opt/jobfinder-new/private/refresh.env`：INSTABOX_API_KEY、INSTABOX_CLI=/opt/jobfinder-new/bin/instabox、JOBFINDER_PUBLIC_SNAPSHOT_FILE=/opt/jobfinder-new/snapshots/public.json、JOBFINDER_VERIFY_BASE_URL。持续凭据配置尚未执行；文件不得进入仓库或日志。
- 反馈/管理员写入使用 [私有后台](../web-candidate/REMOTE-WRITE-README.md)，公开GET只读本机快照。新机手动预览模板已安装但未启动请求。
- 实际暂停唤醒、中断恢复、失败来源保旧、安装失败保旧、网页重启全部验证后，才生成JOBFINDER_RECOVERY_EVIDENCE记录。timer来源由实际INVOCATION_ID和LastTriggerUSec确认，不能手填运行记录。

生产切换还需要剩余来源修复、私有写通道验收和源库最终同步。当前已验证的是候选链路，不代表无人值守迁移完成。
