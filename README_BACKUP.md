# 五个 TRUE_A host 的源码备份

本备份保存 cr、csl、daiichi、lilly、sph 五个 host 的冻结准备源码。归档标识为 `due-a46-safe-source-20261006T0113Z.tar.gz`，其 SHA256 为 `49d43b6726b0ac0088c57303821ac32bcb649a4fa3d52243cefc67388f8538a5`。`20261006T0113Z` 是归档名称中的时间标识；本备份不把它当作数据库观测时间。

状态界限是该归档的 prepared 冻结范围。本备份没有加入冻结之后的 SPH 运行结果，也不据此推断其他 source 是否运行。源码存在、准备完成和公开验收是不同状态；此备份不证明生产运行成功或公众验收完成。

## 文件范围

原归档中经过逐文件选择的 215 个安全成员保持原字节和相对布局，统一放在 `backup/due-a46-source-20261006T0113Z/` 下：

- 130 个 host 源码文件，包含当前源码与 `originals/`
- 65 个原始与当前源码之间的 `diffs/` 文件
- 8 个恢复、准备、检查、合成测试与冻结工具源码
- 12 个原始源文件列表和 SHA256 清单

这 215 个源文件共 863,496 字节。仓库根目录额外包含本说明、`SOURCE_BACKUP.json` 和 `SHA256SUMS`，所以本次完整文件树有 218 个文件。所有 Git 文件模式都是 `100644`。

五个 `hosts46/{cr,csl,daiichi,lilly,sph}/RUNBOOK.md` 未纳入，因为它们包含实际离线验证和归档烟测结果。原包内的 `SOURCE_BACKUP_FILELIST.txt`、`SOURCE_BACKUP_SHA256SUMS`、`DUE_A46_SOURCE_FILELIST.txt` 和 `DUE_A46_SOURCE_SHA256SUMS` 保留原字节，因此仍引用这五个排除文件。它们仅记录原包来源，不能当作本次上传全集。本次选择以根目录 `SOURCE_BACKUP.json` 为准；根目录 `SHA256SUMS` 校验全部源文件及两个根目录说明文件，其自身不在其校验范围内。

## 恢复范围与限制

这是源码备份，不是完整主机、工作区、数据库或运行状态快照。包内没有 producer42 源码和依赖，也没有实际 host-config/control/source-plan/context SQL、候选与活动状态读回、SPEC/PREPARED/FROZEN/IDENTITY/GUARD 结果文件、bootstrap、run、raw、捕获结果或凭据。

恢复和冻结生成器只保留源码。它们在运行时仍需要包外的真实配置、身份输入、producer 及 code80/code84 来源材料；本包不能独立重建完整运行环境。源码中必要的非秘密 source ID、source-config hash、project、candidate、commit、路径与 namespace 约束保持原字节，不能把这些常量当作当前执行授权。原始文件和当前文件中的固定工作区路径也没有自动改写。

`preflight-launch.mjs` 的入口只接受 `check`。保留的历史 256 MiB launch 分支不可作为 TRUE_A 启动依据；真正的 TRUE_A starter 使用 384 MiB，仍需新鲜 candidate、锁和唯一成功 CrawlObservation 检查。`PUBLISH` 停在 `AWAITING_PARENT_REVIEW`。

历史 `ARCHIVE_STORE` 路径依赖未包含的 `audit-novo-public-archive.mjs` 和外部 Library helper。本备份保留这些源码，不代表该路径已可运行。合成测试代码不等于真实采集证据；恢复后仍需按授权范围重新核验。

本次备份准备只检查归档结构、文件选择、字节与哈希，没有执行包内代码或测试，没有启动 host，也没有调用网络或数据库。
