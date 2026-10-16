# 完整49迁移及真实发布夹具输入准备

状态：仅准备离线输入。原数据库环境的正式升级重试再次在bwrap启动阶段失败。未启动PG、未执行迁移、未创建GitHub workflow、未切换环境。新环境申请仍待用户批准。

## 已落地

1. migrations49/保存全部49个迁移原字节，manifest哈希为91ac87fa179ae06c7441141601fd106c5cb636ab739351d5722bed5de151dc3a。
2. canonical-migration50.sql保存正式第50迁移原字节；retirement.production-reference.sql保存当前完整正式退休事务作对照。
3. before-cohort.synthetic.sql提供19个历史待移除公司和41个合成占位公司的种子。原60→41迁移原样执行，不能跳过。after-cohort.synthetic.sql只移除41个明确命名的占位公司，之后由真实发布夹具种入对应公司和来源；不是生产清理脚本。
4. READ_FULL49_CATALOG.sql和verify_catalog.py检查原生pgcrypto、49项账本、关键函数定义、延迟触发器及基线约束。只读匹配不是迁移执行证明，更不是并发通过。
5. reference-source/复制了现有真实发布compiler和其测试夹具入口，并保存来源与哈希。

没有把49条账本INSERT当成49迁移已经执行。也没有把旧缩减schema升级为“完整schema”。

## 原生完整重放的必要顺序

该顺序是待授权执行方案，不是当前执行结果。

- 使用独立、空白、可丢弃的原生PG17测试数据库。每个案例自己的数据库；不连接生产。
- 按INPUT_MANIFEST.prior49顺序执行每个迁移原字节。任何失败停止、保留证据；不跳过、不中途删触发器、不自动重试。
- 在20260927120000_p0_launch_cohort_41_companies之前执行专用合成公司种子，之后执行占位清理。
- CREATE EXTENSION pgcrypto及ALTER EXTENSION SET SCHEMA必须真实执行。现有WASM helper的digest替身禁止用于这条原生验收路线。
- 保留每个迁移的实际事务边界。有的文件自带BEGIN/COMMIT，早期文件包含ALTER TYPE ADD VALUE；不能把全部文件塞入一个外层事务。不能简单套一层BEGIN就声称DDL与补写账本原子。
- 每个文件实际返回成功并提交后才记录该项测试账本。保存命令、原始返回、文件哈希及提交后查询。此账本说明“原生测试runner执行”，不能写“Prisma migration engine已执行”。若执行或记账任一结果未知，停在UNKNOWN并只读核对。
- 最后使用完整字段的_prisma_migrations测试账本（包括id/checksum/finished_at/migration_name/logs/rolled_back_at/started_at/applied_steps_count），供原退休事务运行。现有PGlite helper仅5列的账本不能直接沿用。
- 运行只读catalog检查。其结果是FULL49_CATALOG_MATCH_ONLY；仍不能当作并发或真实发布通过。

## 真实publisher夹具的移植入口

入口：reference-source/tests/db/incrementalCloudPublication.test.ts。

该测试使用真实runSourceCrawl → archiveSourceEvidence → issueSourceQualityAdmission → compileDbStartedCloudSourcePublication链，仅将公开HTTP内容换成合成数据。fixture()生成pending批次、证据归档、attemptTracker和进程内admission对象，delta()调用真实发布compiler。

需要移植的是该fixture生成逻辑和真实compiler，不是把现成SQL中的guard删掉。原测试默认PGlite、使用测试build identity及WASM crypto adapter，不能直接声称原生双会话验收。

未来runner最少应做：
1. 将原测试的createIncrementalPglite换成已经授权的原生PG17适配器；DB端不允许mock。原生schema必须来自本包49份原字节及真实pgcrypto。
2. 使用合成HTTP但保留真实fetch追踪、archive复验和admission签发路径。fixture必须在有效期内现生成；旧归档或JSON不能赋予新的进程内对象资格。
3. 在同一已重放数据库中用compileCloudPilotPublicationContextSql取得当前context。不能给compiler塞模型自制PASS或旧上下文。
4. 以真实compiler生成SQL，保留完整SQL、期望commit、holderId、expiresAt及生成输入摘要。在规定有效期内使用一次。prepareDbStartedCloudPublicationReplay可做完整重编译字节核对，但不能绕过源码要求的活对象。
5. 为退休测试使用固定v75候选ID/version/commit及当前夹具相符的19字段身份。由canonical render-schema50-retirement.py从该完整字段元组生成退休SQL。renderer参考副本的相对目录布局不能直接执行，需使用原source package位置或明确移植其依赖；不能把生产19字段硬塞到不匹配的合成publisher。
6. 为“旧包退休后到达”保留退休前生成的完整包；不允许退休后重新编译成另一候选包来替代。正式publisher可能先被schema/candidate guard拒绝，这只能证明该完整包被挡住；要额外证明新触发器自身拒绝，需要已审阅的历史原子发布路径，不可删guard来伪装历史代码。
7. 将生成的真实完整发布包放入双会话屏障测试；接受真实pg_blocking_pids边、不同backend/txid、DB时间区间以及独立提交后读回。客户端并发、WASM或缩减schema结果均不计。

## 已实现的原生执行代码（尚未运行）

overlay/tests/helpers/ 下新增：
- nativeFull49Db.ts：仅连接原授权Unix socket和全新空测试数据库；49份迁移全部预先校验后逐项执行；记录原始SQL、返回和提交后账本读取；真实pgcrypto及全catalog校验；错误后对象禁止继续执行，不重试。
- nativeFull49PublisherFixture.ts：通过合成HTTP运行真实抓取、归档、admission活对象签发；读取同一原生DB的当前context；真实compiler整包重编译字节比较；保留19字段v75合成身份、source ID、holderId、SQL哈希及期限。没有dispatch生成的发布包。
- nativeFull49Prepare.cli.ts：显式入口串联重放和现场夹具，再调用哈希核对后的原canonical renderer；输出SQL及证据，不执行退休或发布。

固定compiler中的projectId只是该compiler的元数据常量；实际连接目的地严格固定为本地Unix socket。不能将其误认为连接生产项目。合成build哈希明确标记syntheticBuildIdentity，不宣称是已部署构建。

canonical renderer原输出保留不变。另产一份native-synthetic退休SQL，只把第50条账本logs中的appliedBy改成native-full49-test-runner并加synthetic标记；逐字逆变换必须还原canonical输出。触发器、锁、检查、DDL、checksum及提交语义均不改变，避免假称官方connector已执行测试。

需在未来获批的独立source副本中按原目录把overlay放到vendor/c60-source/tests/helpers；依赖同一controller的src、ops、connector-gate及现有pg/tsx依赖。当前仅在独立typecheck-layout中链接原源文件进行严格类型检查，未编辑原source。

原Unix socket能力尚未恢复，当前不能运行以下入口。该CLI尚不允许GitHub或其他新环境路径；用户批准后还需独立审阅明确的目标配置修改，不得自行放宽。

    node --import tsx tests/helpers/nativeFull49Prepare.cli.ts --run-authorized-local-synthetic-preparation SOCKET EXISTING_EMPTY_DB INPUT_ROOT NEW_OUTPUT_DIR

## 最少剩余缺项

- 用户批准的原生PG17多连接执行环境。GitHub自动测试方案尚未批准，本包没有创建workflow。
- 原生重放runner已实现，仍缺实际逐项提交证据。
- 原生DB适配器及真实现场fixture生成代码已实现，仍需在获批环境执行并解决实际运行问题。活admission/context尚未生成，publisherFixtureReady仍为false。
- 与合成publisher身份严格绑定的退休SQL、真实旧原子包覆盖和双会话全链路结果。

## 离线验证

    python test_offline.py
    python -m py_compile prepare.py prepare_catalog_check.py verify_catalog.py test_offline.py

8项离线测试通过，只说明输入校验和分类器分支，不说明数据库通过。

新增11项原生runner/现场fixture离线结构检查通过；3个新TS模块与实际源码依赖严格类型检查通过。原8项输入检查也通过。以上均不执行数据库。

## 2026-10-16 完整双会话入口补充

用户已明确批准现有 GitHub 临时数据库测试。此前“等待批准”的叙述是准备阶段历史状态。当前实现仍未获得数据库执行结果；不能据离线检查报告并发通过。

- nativeFull49Acceptance.cli.ts：单一入口真正调用49重放、真实baseline publisher、第二轮活admission/context/compiler、canonical退休renderer、A/B两个独立连接与第三观察连接。
- 7案例：发布提交、发布回滚、退休提交、退休回滚、真实延迟约束在COMMIT失败、真实锁超时、退休后迟到原子包触发器拒绝。
- 接受证据必须有不同backend PID/txid、pg_blocking_pids实际B→A阻塞边、数据库clock_timestamp区间、确切COMMIT命令回执、独立提交后完整账本/历史证据/Job及新包残留对账。客户端请求重叠不能满足判断。
- 完整发布回滚后没有遗留PENDING，因此退休成功是该case的正确结果。退休先提交后，真实schema49包首先失败于PILOT_MIGRATION_HISTORY；另一个明确标记的原子触发器case证明V75_FENCE_CANDIDATE_RETIRED及Job回滚，不能把后者冒充真实compiler首次拒绝点。
- nativeFull49Summarize.cli.ts只读汇总7份完整证据和每库49份实际迁移提交后回执；输出PASS_FULL49_NATIVE_MATRIX，仍productionQualified=false。reduced包保持独立，不能满足此汇总。
- github-integration/full49-native.yml是授权后拟提交的工作流；review-only-ci/保留先前草案。工作流只在临时源码副本装配4份已审schema50候选源码；生产路径不变。原49迁移从base源码逐字校验复制，不能以新账本伪造重放。
- PG官方17镜像拉取后先解析、记录RepoDigest，再按该不可变digest启动；无TCP监听/外部网络。依赖安装阶段使用现有锁文件。运行数据为synthetic，抓取HTTP由进程内合成响应接管。

离线当前通过8项输入检查、11项runner结构检查、7项双会话结构检查、21项分类器单元检查；6个TS模块严格类型检查通过。不存在原生数据库PASS结果。
