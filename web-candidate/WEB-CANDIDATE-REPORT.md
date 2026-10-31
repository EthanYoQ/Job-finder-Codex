统一包增量复核：本轮修复管理员DB故障误报401及瞬时失败清除会话，保留草稿并支持只读刷新；真正401后允许重新登录。Merck三处配置由simplify_runner对齐。最新源码/产物哈希与定向验证见 `prepared/simple-review/manifest.json`；此前候选的独立构建manifest为历史参考。原手动抓取入队接口尚无新runner消费入口，不宣称手动抓取完整恢复。

# 本机持久快照网页候选

状态：`LOCAL_BUILD_AND_SYNTHETIC_VERIFIED_NOT_DEPLOYED`。候选首先在独立 `prepared/web-candidate` 构建，统一包增量修改位于 `prepared/simple-app/web-candidate`；构建工具位于 `tooling/web-build-native`。未改原恢复证据、原依赖或原 lock，本子任务未连接真实数据库、招聘来源或生产服务器。

## 已完成的查询与写入路径

公开查询只读 `JOBFINDER_PUBLIC_SNAPSHOT_FILE`。启动完整读入成功才监听；每次请求检查 dev/ino/size/mtimeMs/ctimeMs，只有变化才读取/解析/校验完整文件；损坏新文件保留上一份完整内存快照。没有后台 watcher、轮询、重试队列或数据库回退。

搜索、城市/类别/关键词/新增过滤、公司展开、官方详情链接和 coverage 复用原 `portablePublicationApi.ts`；真实发布资格、成员约束和导出投影保持原字节。`lastUpdatedAt` 不改成安装或访问时刻。

有 `DATABASE_URL` 时创建 lazy Prisma client，复用原反馈、推荐、管理员服务；不在启动时连接或等待 DB。未配置时明确 `503 WRITE_BACKEND_UNAVAILABLE`。数据库请求最多等待 8 秒，成功只返回原服务回执；超时/异常返回 `WRITE_RESULT_UNKNOWN` 与 `retryable:false`，不自动重放、不记录请求私有内容。HTTP 超时不等于 SQL 被取消或回滚，实际结果须查清。

前端现已识别未知结果，包括断网、损坏回执和 5xx：显示“提交结果尚未确认，可能已经保存。请勿重复提交；请先联系管理员核实。您填写的内容已保留。”保留当前输入，禁用当前提交按钮。反馈、公司推荐、隐私请求和管理员操作均接同一错误处理；正常验证拒绝与未配置写库有独立提示。不会将未知写入称为肯定未保存。

`/readyz` 只表示已载入公开快照，`writeBackendConfigured` 仅表示配置存在，不宣称数据库可用。

安装入口验证受信通道给出的 SHA256 和公开文件格式，再执行同目录临时文件→文件 fsync→rename→目录 fsync。格式拒绝私有字段。SHA256 不是发布授权，仍须先由原 reader 完成事务核验。rename 后目录同步失败明确报 `PUBLIC_SNAPSHOT_DURABILITY_UNCONFIRMED`，不误称旧文件仍在。

## 新前端构建身份

`dist` **已换成本机新构建**，不再是旧线上字节。`frontend-build-manifest.json` 记录所有源码输入、原 lock、Windows 原生工具完整性及 119 个产物的 SHA256。

- 输入树：`213be285d5312b14e929c6dc9e7a6db4ea7be4f4e284cf239d5c6ac5110f268b`
- dist 树：`9991351f3ab994c8d5a47073006d2ffc82c21e2cee361b8d9b8f9f0f2bf856bc`
- 产物：119 文件，5,722,488 字节。
- Vite 6.4.3、React 插件 4.7.0、Rollup 4.62.2，均为原 lock 版本。Vite 实际使用其嵌套 esbuild 0.25.12；根 esbuild 0.28.1 未替换或混用。

补齐的构建输入只有标准 `index.html`、最小 `vite.config.mjs` 和 `public/fonts`。HTML 来自主任务取得的当前页面，脚本入口改为现有 `src/main.tsx`。110 个字体复用已取得的公开字节，fonts.css 用既有 PostCSS 从当前部署 CSS 提取 110 个原 @font-face 规则。原源码 logo 图片与当前部署图片 SHA256 一致。

本机只额外安装官方 Windows 原生包到新 tooling 目录，npm `--ignore-scripts`，版本与 integrity 对照原 lock；Vite 嵌套 Windows esbuild 用本地 alias 单独放置，未修改恢复的 node_modules。`node_modules` 是本机指向恢复依赖的 junction，**交付/打包时排除它及 tooling，不跟随链接复制依赖**。目标依赖使用已有独立运行包。

当前新 CSS、logo 与原线上产物保持相同哈希；新 JS 承载未知写结果处理和“已保存公开快照”标记。原线上参考仍在 `prepared/web-assets` 及 `deployed-reference-*`，不是新构建成功的冒名证据。原根构建配置未找回；此最小标准配置是新候选输入，已真实构建通过。

Windows 重建命令（在本目录运行，env 只作用于该 shell）：

```powershell
$env:NODE_PATH=(Resolve-Path '../../tooling/web-build-native/node_modules').Path
$env:ESBUILD_BINARY_PATH=(Resolve-Path '../../tooling/web-build-native/node_modules/esbuild-vite-windows/esbuild.exe').Path
node ./node_modules/vite/bin/vite.js build --configLoader native
```

## 实测证据

- `frontend-build.log`：Vite 实际构建 1609 模块成功；不是仅编译语法或复制旧 dist。
- `snapshot-test-result.tap`：5 项集成测试通过。包含独立新 Node 进程重读、损坏/结构/私有字段/hash 拒绝、磁盘原文件保留、过滤/详情/原时间、无 DB 配置 HTTP 启动；未变文件连续请求不重读，坏文件只解析一次。
- 同一套测试以内存 DB 替身实际调用原服务，验证反馈/推荐 201、错密码 401、正确管理员登录 200 和会话 hash；延迟提交 504 结果未知、不重放，库异常不泄露私有内容，公开查询仍 200；客户端正确区分未知、验证拒绝、不可用和成功回执。
- `typecheck-evidence.json`：前端 main 与变更服务入口依赖闭包按原 tsconfig 检查，TypeScript 5.9.3，0 诊断。
- `browser-synthetic-result.json`：系统 Chrome 156.0.8078.74，独立 context、`chromiumSandbox:true`；只允许本地服务确切 127.0.0.1 origin，阻止 service worker 和 WebSocket。新构建完成同意、合成职位展开、官方链接、原时间、新快照标记和坏文件后刷新。四种表单的合成 504 均显示未知结果、保留输入、禁用提交，没有重复请求；管理员页面也真实加载了新 chunk。无意外 HTTP 失败、页面异常或外网尝试。
- 截图：`browser-synthetic.png`、`browser-unknown-feedback.png`、`browser-unknown-admin.png`。全部内容为合成数据。
- `static-asset-closure.json`：新产物静态引用闭包没有缺失文件。

Windows rename 成功但目录 fsync 返回 EPERM；测试明确保留此“持久性未确认”结果。没有执行 Linux Node/esbuild/Prisma 引擎；本轮实际使用经过完整性核对的 Windows 构建工具。

## 剩余真实环境工作

授权私有数据库连接、Linux Prisma 引擎和真实写入、休眠唤醒、目标盘 fsync/实际重启及生产切换仍未验收。前端未知结果处理已完成，不再是待修复 UI 缺口。保留输入指当前页面/表单，不新增持久客户端写队列；未知结果必须核实后再决定重新提交。

流水线直接调用原 `readPortablePublicSnapshot`，保留其事务与真实发布资格核验，再将完整文件和 hash 经受信通道送到目标临时路径，调用安装入口并 HTTP 读回原 search/coverage。无需旧逐源 EXPECTED_TARGET_API 外部文件仪式。查询固定非秘密同意 header 为 `x-job-search-consent: accepted`。不要以文件安装成功替代网页读回成功。

```sh
./node_modules/.bin/tsx install-snapshot.ts INCOMING_FILE PUBLIC_FILE TRUSTED_SHA256
# DATABASE_URL 从授权服务配置注入，不放命令行或日志。
JOBFINDER_PUBLIC_SNAPSHOT_FILE=PUBLIC_FILE HOST=127.0.0.1 PORT=3000 npm start
```

`web-candidate.patch` 提供文本源码差异；110 个二进制字体和完整 dist 随候选目录交付，不塞进文本 patch。清单记录 before/after 及二进制哈希。未 commit、未加入原 prepared/app 身份、未部署或启用调度。
