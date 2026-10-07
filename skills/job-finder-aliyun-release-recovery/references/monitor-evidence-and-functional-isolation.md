# 原执行监控、预算与功能隔离

适用于既有协议内的运行证据恢复与监控判断，不授予采集、发布、重投、取消或修改生产权限。此处“新 batch”与“重投原外部调用”不同；涉及 root 远程命令或部署的 UNKNOWN 继续遵守[命令证据与恢复契约](command-evidence-and-recovery.md#固定提交与-unknown)，不能套用应用层隔离结论。

## 将四种结论分开

- 应用层能否继续发起 HTTP/PUBLISH：由精确绑定的实际源码、运行树、原异常位置及全部可达分支判断
- OS/原 exec 是否终止：由对应原执行的可靠平台终态或真实退出证据判断。赋值 exitCode、日志停更、Unknown process id、采样过期均不是退出证明
- 当前数据库是否有相关工作：精确候选、批次、holder、事务与锁的当前只读快照。它不证明未来无写入，也不证明进程退出
- 取消是否成功：写入取消文件只证明请求已发出；没有匹配确认或退出证据时保留未确认，不能写“已取消”

“最近收到日志”是时效信息，不是存活或完成证明。wrapper、supervisor、sampler 与平台 exec 的结论分别报告；某一层缺失或冲突时明确保留缺口。采集失败即使监督证据全部闭合，仍不是来源成功或发布成功。

## 何时可以保持 OS UNKNOWN，按原协议进入新批

仅针对已审阅的特定应用路径，先同时建立以下事实：

1. 真实启动命令、代码/运行树摘要和原异常身份一致；正常失败返回、错误处理再次抛错、finally 等全部已审分支都不能再到达新的应用层 HTTP、PUBLISH 或再次读取共享发布控制的路径
2. 原 dispatch owner 已结束，结束前无在途 SQL；原 relay 只有已响应请求且不会再生成可发布请求。停止 owner 本身不会撤销已提交 SQL，因此“无在途”必须独立核实
3. 新批使用独立 run/batch、控制请求和新证据；现行 starter 检查新目录/输出为空，monitor 只处理当前精确 relay，不扫描历史 sibling run。新的执行者仍为唯一 publisher
4. 当前正式身份、holder、相关锁/事务、调度间隔和新鲜度符合原协议；新采集、质量、归档、发布期限与事务内协调门继续在真实执行时核对

这些证据可支持“该旧失败流程不会形成第二个应用层采集/发布执行者”。在已有授权覆盖的新批范围内，不应因单独缺平台退出记录自创永久额外门槛；仍保留原 OS UNKNOWN，不把它改成已退出或取消成功。原 starter 是否放行是当前协议的结果，不由文档代替。

控制流结论以原进程继续执行这份已审代码为条件。磁盘摘要、启动命令与日志绑定不构成独立的进程内存证明；绑定可信度不足时保留这一缺口。

此判断不证明旧 socket/执行器已回收，不排除任意外部进程行为，也不能仅凭空锁、超时、经过一段时间或新目录就作出。源码无法精确绑定、存在可达重试/发布路径、旧 owner 在途、作用域混用或新批复用旧证据时，先处理具体冲突。绝不能据此盲重投原 PUBLISH、原 exec 或未决 root 命令。

## 监控必须在原执行期间取证

曾出现仅在 CHILD_EXIT 后才 poll 原 exec 的监控设计：若 CHILD_EXIT 永远没落盘，平台原执行响应就一直未收集。修复为同一个串行 loop 既服务当前 relay，又按既定有界节奏轮询原 session，而不是再开竞争的终态 loop。

原实现的轮询间隔为约二十秒；这只是当次合同，不是任何任务的通用频率。不能为了追求固定频率忽略 handler 耗时、剩余原预算或平台限制。

每次 poll 遵循：

1. 核对当前 run/session，poll 原 session；不启动替代 exec、不用新调用探测旧调用
2. 先把工具返回的完整对象或错误对象按捕获的原 run/session 写入独立证据文件并回读核对。即使 poll 等待中作用域已变化，也先保留这份原始回包；保存后重核当前作用域，才能分类、发 running/terminal 通知或进行下一次 poll
3. 工具返回已截断的 stdout 仍是“工具返回对象完整”，不是“原进程 stdout 全量”。不要丢掉截断标记或宣称完整日志恢复
4. 保存失败、回读不符、拒绝/取消/unknown、异常形状均保留 UNKNOWN 和具体原因，不自动重投。原回包还未持久化时，不先凭内存状态宣布成功
5. 收到平台 terminal 后，先保存，再回读 wrapper 终态并比对退出码；继续分别核对 supervisor、sampler。证据保存/回读、wrapper 状态读取和 owner 证据回读都有 await；在这些等待之后、写入 accepted-terminal 状态之前重新核对完整原身份。作用域变化时保留原回包与 UNKNOWN，不把旧 session 的终态记入新执行的接受状态。身份与终态闭合的非零退出才是确认失败，不是成功

持久原回包可能含敏感输出，只存已经批准的私有证据位置。通用 skill、文档和 GitHub 只收安全代码、合成测试与去标识结论，不收真实回包、nonce、实际路径或运行身份。

## 原预算不会因恢复而重启

原预算锚点是持久 WRAPPER_START 的 outerDeadline（epoch 毫秒）和 timeoutMs；起点为 outerDeadline − timeoutMs。recordedAt 可能因写标记/fsync 而较晚，不能用它重新加 timeout，也不能在内存 store 丢失后用 now + 新时长续期。

- 核对原 schema、唯一开始标记、日期/整数、run/session 绑定、原时长上限及历史已验预算一致性。缺失、重复、非法或变化时阻断新 PUBLISH，并保留预算不可用结论
- budget preflight 与实际 monitor 使用同一持久预算。PUBLISH 前先核对未耗尽；预检与 helper 内部任何 await 都可能跨过原截止点或改变身份。全部准备等待结束后，在真实 SQL 工具调用前同步重核原绝对截止点、原请求期限和完整作用域；检查与调用之间不能再有 await
- 捕获原截止点，恢复只消耗剩余预算。等待 relay、读状态、poll 和收取响应都计入，不因一次请求成功或新 token/reset store 重新开始
- 原预算耗尽只结束这一轮观察，不将旧 UNKNOWN 改成失败终态；另一个新批有自己的正常合同，不能拿它给旧批续时

## 异步作用域和半成品 lease

r3 曾针对两类已知缺陷做反例和窄修。以下保留当时的修复范围，不表示完整调用链已经闭合：

- await budget preflight 前的 scope 检查不足以约束返回后的 helper 调用。r3 在该 await 之后重核 run、batch、session，覆盖这三个已知反例；后续复核证明 helper 内部仍有未覆盖的等待，不能把这一层的拒绝推广到真实 SQL 工具边界
- 为防同 store 重入而写的临时 lease 还没有已验证 loopStarted/stopAt。预算读取失败后，不能把这个半成品保存成可恢复 lease；没有旧已验 lease 时只释放本次占位，有旧已验 lease 时恢复原截止点并标读取失败。不能抹去旧预算再给新三十分钟

这种内存/store lease 只防该 store 内重入，不是跨进程/跨 isolate 的原子锁，也不发放 publisher 权限。不要把该修复扩成跨进程锁方案。

## 后续纠正：最终门必须位于真实副作用边界

后续独立 VM（隔离的 JavaScript 执行上下文）反例发现 r3 仍有三类缺口：helper 在 owner 检查之后还等待 envelope 和 dispatch marker；候选、build、来源等身份只在入口检查；terminal poll 返回时可能已经切换到另一个 run/session。原有测试与两项静态审查没有覆盖这些路径，不能据此声称最终 guard 已完整修复。

限定 r4 修复采用以下合同：

1. 沿实际调用链找到各受管路径的真实 SQL 工具调用。helper 完成 envelope、请求读取和 marker 的全部等待后，调用必需的同步 guard，并要求它明确返回 true；异步回调、缺失回调或非 true 结果不能放行 PUBLISH。guard 与真实调用之间不再等待
2. 在入口固定完整、独立的原始身份快照，包括 source/project/config/root、完整 build/candidate、review、request/hash/SQL，以及 run/batch/session/relay 目录。最终 guard 比较当前值与原快照，既拒绝对象替换，也拒绝对象原地修改；不能只保留可变对象引用或只比较 run/session
3. 最终 guard 同时核对原 WRAPPER_START 的绝对 stopAt、原请求 expiresAt 与 dispatchBefore。沿用现有期限语义，不因新的 marker、store、恢复动作或成功预检延长原预算
4. owner 管辖的非 PUBLISH SQL 路径也传递该最终 guard。已审路径包括 lease 获取/续期/释放、结果与上下文读取、创建 pending；不能只保护 PUBLISH，让其他实际 SQL 调用绕过身份与期限门
5. poll 返回后先按原身份保存完整 raw，不能因作用域已经变化丢弃证据。证据保存与回读序列完成后，以及后续 wrapper 状态读取的 await 返回后，重核作用域；owner 完成自己的证据回读后、写入接受终态和成功候选状态前再核对。保持精确 JSON 或一个末尾换行的原回读合同，不靠任意 trim 消除差异

最终 guard 可能在 dispatch marker 已写入后拒绝。保留已有 marker 和原请求；此处 NOT_INVOKED 只描述这一次 helper 没有调用 SQL，不能推成数据库回滚、全局零写入或允许重投。继续保留 noWriteEstablished=false、retryAuthorized=false 和未决结果的原对账要求。

回归应使用实际 helper/owner/monitor 代码，以受控 await 注入身份替换、原地修改、原预算/请求期限到期和终态 scope 漂移。核对实际 SQL stub 是否被调用、原 raw 是否全量保存及 accepted 状态是否缺席，不能只测试简化 owner stub 或检查函数名/文本。无需另造与真实合同重复的通用“可重试”模型。

## 已验证范围

一次新运行保全了十五个原 exec poll 回包；原 exec、wrapper、supervisor 与 sampler 的退出证据一致，确认非零退出。采集因单 URL 的原四十五秒限制失败，未到来源/外层期限，没有 PUBLISH，也没有新成功观测；未定位延迟来自官方上游还是平台代理。该结果验证监督取证恢复，不能称来源已成功。

后续 r3 的 scope 三项及 lease 两项反例在修前全部失败，修后相关套件共 129 项通过。当时独立静态审查只闭合这两项已报告问题，随后在无 active owner/monitor 时安装。再后的八项独立 VM 反例证实上述最终边界与身份缺口；此前“审查闭合”不能解释为 r3 全链安全或可继续启动。受影响的旧安装仍需单独修复与验收。

限定到两个已审来源的 r4 离线包通过独立 683 项检查，原八项反例全部闭合：六项拒绝实际 SQL，另两项保留完整 raw 且不写接受终态。这不覆盖其他来源、候选或旧安装。未绑定源码安装、PREPARED 生成、activation 安装与真实运行成功须逐层另验，离线 PASS 不自动放行。

历史安全源码备份见[监控 r3 快照](https://github.com/EthanYoQ/Job-finder-Codex/tree/948bc84ffbc2f994230d55ac111212a834d2964c)。它保留当时字节，不证明已包含后续 r4 修复。当前项目适用对象与备份索引见[项目问题记录](../../../docs/job-finder/source-evidence-repair-notes.md#3-novo原执行监控与功能隔离)。旧运行 OS UNKNOWN 与取消未确认保持原结论。源码备份、离线测试、安装、激活与真实采集/发布验证不互相替代。
