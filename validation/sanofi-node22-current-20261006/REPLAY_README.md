# Sanofi Node22 离线重放源码包

本包是单源 reader 比较与已选择合成回归的源码闭包。它不是部署包、完整原 Git、注册 runtime 或全站 CI 输入。没有真实数据库快照、真实岗位投影、运行报告、认证信息、审批文本或运行控制载荷。

## 固定源码

- a775：冻结网页 a775d114668c466562660105ee52dc2306b6fdeb 的安全源码视图
- main：b60390477578be18d0f4319eb2a3db888c4fcb17 的安全源码视图
- fallback：a38cbeb014d6ce3d7648218d8d4a96264ae42bf8 的安全源码视图

每版比较的入口为 src/db/portablePublicSnapshotRepository.ts、src/crawler/sourcePlan.ts、src/data/companyRegistry.ts。READER_CLOSURE_MANIFEST.json 列出每版208个静态依赖文件，包含 type-only imports 和字面量动态 import。所有模块按原字节保存。main/fallback另含原服务端测试、其 helpers 和明确标记为合成的 sanofi-publisher-contract.json。

静态闭包里有抓取、archive、build-identity等函数定义，因为现有模块有传递导入。这些代码不是运行控制载荷。本包不包含其激活文件、nonce、凭据、host配置、DB或浏览器配置，也不调用这些工作流。动态文件读取点已经列在闭包清单：实际比较不进入这些抓取/运行身份路径；选择的 Sanofi 测试仅读取已包含的合成 publisher contract。

## 重放前置条件

RUNTIME_REQUIREMENTS.json 固定版本、官方来源、SHA256和缺失依赖。本源码包未含 Node 二进制、node_modules、native Prisma engines 或生成的 Prisma Client。

1. 在独立目录展开源码包，保留 a775/main/fallback 相对布局。准备 logs、tmp、task-home 三个目录，不使用生产凭据或 DATABASE_URL
2. 恢复官方 Node v22.19.0 Linux x64 到 runtime/node-v22.19.0-linux-x64，核归档及二进制hash；不修改系统默认Node
3. 三个角色分别按原 package-lock.json 恢复依赖。锁文件完全相同，可使用独立复制；禁止指向生产/原producer依赖目录写cache
4. 恢复官方锁定 Prisma schema/query engines，再由各角色原 prisma/schema.prisma 生成真实 Client 6.19.3。明确指定 PRISMA_SCHEMA_ENGINE_BINARY 和 PRISMA_QUERY_ENGINE_LIBRARY 的本地路径，CHECKPOINT_DISABLE=1、PRISMA_GENERATE_SKIP_AUTOINSTALL=1，不连数据库
5. prepare-prisma-engines.py 是固定官方来源/hash校验的原准备代码，含网络下载，必须由执行owner在适当授权下单独决定是否使用；比较脚本本身没有下载动作。generate-prisma-client.py/probe-prisma-client.py 原来只处理 main/fallback。a775使用相同命令生成，或在验证 package-lock/schema 同字节后独立复制真实生成的 .prisma/client；不能使用虚构 Prisma mock
6. 精确原命令为 Node22执行 node_modules/prisma/build/index.js generate --schema prisma/schema.prisma --no-hints。所需环境变量仅为上述本地engine路径、隔离HOME/TMPDIR及no-network守卫；不提供DB凭据

## 当前真实快照比较

本包不含真实数据。私有回归证据包中保留完整的 SANOFI_CURRENT_READONLY_EXPORT_20261006T1553Z.json，所需SHA256已固定在 adapter；它是2026-10-06的新当前单源快照，不是缺失历史fixture。只把该文件材料化到独立重放根目录，不提交GitHub或Drive。

执行 run-current-sanofi-comparison.py 会用同一只读JSON分别调用三份原 reader。它只运行离线比较，不执行导出SQL。compare-current-sanofi.mts：

- 保留所有导出的单源 SCHEDULED 历史，准确执行原 findMany 的 where/select/orderBy
- 用真实生成 Client DMMF 把 PostgreSQL enum标签按原schema转换成 Prisma enum名；未知标签失败，不猜分类
- 用同一捕获时间恢复UTC Date，不修改原JSON，不注入收据或绕过artifact绑定
- 不传cache，不提供$queryRawUnsafe，避免全站版本指纹
- 要求真正PUBLISHING/88个唯一岗位；三方HOLD/空集不能通过

原包装脚本会生成 PRIVATE_COMPARISON、logs等私有输出。它们受 .gitignore 拦截，但提交仍必须只用owner审核的source-plan白名单，不能依赖.gitignore作为隐私边界。

## 合成回归范围

run-server-verification.py 使用原 sanofi-reader.vitest.config.ts 和真实 Prisma Client，仅执行：

- main：portableSnapshotReader、portableSnapshotRefresh、portableSnapshotResponseBarrier、portableSnapshotNonblocking、portableSnapshotTiming
- main Sanofi：只选 verifies the independent publisher packet / rechecks changed external artifact commitments
- fallback：前述前三个通用测试；Sanofi只选 rechecks persisted metadata changes
- 两版 domain：只选 rechecks unchanged certificates when persisted Sanofi artifact

原测试文件中的历史用例仍引用 tests/fixtures/sanofi-historical-public-context.json；该原件仍缺失并明确排除，绝不把新当前快照改名替代。必须保留上述过滤条件。不要运行未限定的npm test并将缺原件的失败解释为新的业务回归。

本包未提供完整UI/build源码资产、全部迁移或部署资格材料。旧Node22前端与build结果在私有证据包中保留；仅凭本闭包不能重跑全站前端build、完整CI或启动生产服务。

## 只读SQL

SANOFI_CURRENT_READONLY_EXPORT_DESIGN.sql 只作为审核过的单源查询设计源码冻结。源码包不自动执行它。任何未来查询仍由唯一owner决定；它不能用来扩大来源范围、重建原历史fixture或绕过5秒/行数/输出预算。

## r2 工具验收补强

本次只改离线重放工具，三份 reader、compare-current-sanofi.mts、原schema及固定checksum配置均保持原字节。

- prepare-prisma-engines.py 同时核远程sidecar和实际压缩/解压字节是否匹配 RUNTIME_REQUIREMENTS.json 中已有固定SHA及大小；两份引擎全部通过前不安装任一二进制
- run-current-sanofi-comparison.py 将本次各child输出放入新建的 logs/current-sanofi-* 目录，不读取上次残留projection。它自动比较三份完整投影对象、88个唯一岗位ID与原输入集合、所有岗位字段，以及原收据/岗位时间，不能只相信child报告的hash
- 全部Python runner保存每一步完整日志与逐步结果；非零、超时或启动错误均导致自身最终非零。既有结果文件先复制到本次run目录的previous-*，历史私有projection不覆盖
- 成功标志为 CURRENT_SANOFI_AUTOMATED_ACCEPTANCE.json 的 PASS 加runner进程退出0；不能仅检查三个child各自退出0

只测试工具的合成回归命令为：PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tool-tests -p 'test_replay_tools.py' -v。测试只在临时目录注入合成child/engine数据，不执行Node、应用测试、网络或DB。
