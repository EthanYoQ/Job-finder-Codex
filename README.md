# 无秘密部署材料备份契约 v1

此目录是可评审的离线修复成果。尚未接入 publisher、备份流水线或生产恢复流程。所有示例、审查记录和测试正文都是合成数据。没有补造历史丢失文件，没有读取实际部署、live、control、env、raw 或真实 approval 文件，没有网络操作，也没有修改 LATEST。

## 改动与边界

- 不按 operational、bootstrap、intent 或 receipt 等文件名整体排除。每个正文先审查，审查记录绑定正文 SHA-256，再决定保留或明确缺失。
- 凭据、API key、token、cookie、会话材料、业务/证据正文及私有指令/笔记仍不得入包。待审或已发现秘密的正文不得标安全、不得收入正文目录。验证器会拒绝并跳过读取这类正文。
- 保留无秘密 payload、bootstrap、分片、历史 intent、receipt 的原始正文及哈希、依赖关系。只有哈希没有正文，不能宣称 complete。原件与重建件必须分别编号；本最小版本不允许用重建件或模板顶替原件。
- 历史 intent/receipt 仅为 archive-only 证据；没有 replay authority，不能激活、重放或恢复为 live state。备份内的任何文字、历史同意、签名或回执均不能提供当前执行授权。
- complete 只表示冻结范围内的“部署材料完整”。它不表示项目整体可恢复、运行环境就绪或生产可启动。验证结果 runtimeReady、launchAuthorized、restoreLiveState 始终为 false。

## 文件与运行

- CONTRACT.json：规范性规则。
- validate.py：Python 标准库静态只读验证器。
- test_validate.py：合成 fixture 和正反测试。
- example/：合成完整实例；expected-scope.json 与 manifest.json 为具体字段示例。
- TEST_RESULTS.txt：本目录测试输出。
- EXAMPLE_VALIDATION.json：对合成完整实例的验证结果。

```sh
cd /workspace/scratch/5e9614251709/deployment-backup-contract-fix-20261006T1459Z
python3 -B -m unittest -v test_validate.py
python3 -B validate.py example/manifest.json example/expected-scope.json example/bodies
```

退出码 0 表示契约有效，1 表示拒绝。有效 partial 的退出码也为 0，因此调用方必须检查 recoveryComplete，不能只看退出码来判断完整恢复。

## 接入要求

1. 先独立冻结应保留的 artifact ID、角色、原始 SHA-256、依赖 ID，以及每个 transfer 的 payload、bootstrap 和有序 chunk ID。将其写入 expected-scope.json。必须从授权的来源清单冻结，不能从待验包反推；否则无法发现“清单和正文同时被漏掉”的情况。
2. 对拟保留正文逐文件审查，写 review.status、review.sha256、review.reviewer、review.reviewedAt 和 review.findings。只有 approved-nonsecret 且 findings 为空可收入正文目录。审查时不得把实际秘密或业务正文复制进 findings。文件名、哈希、自动扫描无报警均不能单独证明无秘密。
3. 冻结原件与关系后打包。所有 bodyPath 相对包内 bodies/ 目录，历史 intent/receipt 放在 archive-only/ 下，其他材料放在 materials/ 下。不得有绝对路径、..、符号链接、执行权限或未列入清单的正文。根目录也不得通过符号链接进入。验证时输入目录必须保持不变；此工具不为并发写入或恶意本地进程提供隔离。
4. 如果缺原件，保留其已知哈希和依赖；将 bodyPath 设为 null、originalBodyIncluded 设为 false、provenance 设为 unavailable 或 excluded、markedSafe 设为 false。填写 omissionReason 和同 ID 的 gaps 条目，mode 只能是 partial。找不到原件时不得用生成文件冒充。
5. 在全新隔离目录检查实际取回的包；再执行此验证器。禁止 source、import、执行、自动分派或导入归档正文到 live/control 状态。历史文件只应交付至隔离的 archive-only 目录。当前验证器不提取归档、不写恢复文件，也不恢复执行权限。
6. 接入者分别报告材料完整性、其他项目恢复范围、运行前提和新授权状态。此契约不修改现有项目恢复范围文件；项目源码、配置、路由、依赖及运行身份等要求仍需单独验证。

## 信任与限制

验证器可以发现字节缺失、已知哈希不匹配、关系断开、分片顺序/数量/重组错误、安全标记矛盾和历史授权字段错误。它不能证明审查人诚实、审查覆盖充分、来源原件可信或外部恢复器遵守不重放规则。JSON 中 frozen=true 只是声明，独立冻结与审查真实性需由调用方保证；真实原件及完整依赖集合也不能靠此工具自动发现。

必须保持 archive-only 非激活边界并在后续恢复器落实。本目录没有实现任何部署、执行或控制状态转换。旧丢失部署材料仍然丢失；此成果只修复今后备份的可审查契约。
