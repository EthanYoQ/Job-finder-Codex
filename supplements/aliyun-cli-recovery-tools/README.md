# dot 云端阿里云 CLI 恢复说明

这些文件只包含恢复步骤、公开下载地址、公开校验值和离线测试。它们不包含 AccessKey、env 文件、CLI 配置或 STS 身份回包。脚本不部署应用，也不执行服务器命令。

## 本次已验证状态

- 2026-10-08 UTC：官方 CLI 3.5.1 安装成功。
- 安装包大小和 SHA-256 与指定官方发布包一致。
- 私有 profile：`dot-web-deploy`；区域：`ap-northeast-2`。
- 官方 `STS GetCallerIdentity` 只读验证成功；只保留成功状态，不保存身份回包。
- 运行目录及子目录为 0700；配置为 0600；可执行文件为 0700。
- 本说明和脚本完成后，只做离线测试，不再次安装或认证。

## 固定执行位置

仅使用 dot 云端工作区 `/workspace/scratch/5e9614251709`。不要切到用户电脑，也不要擅自换执行环境。

- 工具说明目录：`/workspace/scratch/5e9614251709/aliyun-recovery-tools`
- 私有运行目录：`/workspace/scratch/5e9614251709/.aliyun-dot`
- CLI：`/workspace/scratch/5e9614251709/.aliyun-dot/bin/aliyun`
- 隔离 HOME：`/workspace/scratch/5e9614251709/.aliyun-dot/home`
- 私有配置：隔离 HOME 下的 `.aliyun/config.json`

同一已获授权的 dot 云环境重置后，工作区路径可能变化。路径变化本身不等于更换执行环境，无须仅因路径变化额外询问。先核实新路径确属相同的已授权 dot 云环境，且不存在符号链接或权限越界；再更新脚本和说明中的固定路径，并重新校验。脚本不会自动改用其他电脑或云环境。只有需要改变用户指定的执行环境、架构或任务范围时，才先说明原因、影响和替代方案并取得明确同意。重新配置长期 AK 仍须取得当次确认。

## 找回输入文件

通过已授权的 Google Drive 插件按文件 ID 找到用户的私有 `aliyun-korea.env`：`1zSeLhPuXgx60ZrdBYtsWkAmrjLFFWygr`。

由当前云端执行环境使用插件支持的下载方式暂存。不要把文件内容打印到聊天、日志或工具输出。文件应为当前用户所有的单链接普通文件，权限 0600。核对来源和字段后，才能把实际暂存路径交给脚本。

本次暂存位置为：
`/workspace/scratch/5e9614251709/attachments/6df57dfe-cbb9-40bc-bd1d-eac02063e1a1/aliyun-korea.env.bin`

文件必须恰好含有 `ALIYUN_ACCESS_KEY_ID`、`ALIYUN_ACCESS_KEY_SECRET` 和 `ALIYUN_DEFAULT_REGION`。脚本只按字面值解析，拒绝命令、变量替换、重复字段和额外字段。不要 `source` 这个文件，不要把密钥放进命令行参数。

## 确认边界与操作顺序

1. 可以自动定位这份已授权的文件、核实来源、私有暂存并准备恢复。默认 `prepare` 完全离线，只读，不安装 CLI，不写长期凭据，也不调用 STS。
2. 每次清理后重新写入或配置长期凭据，都必须先取得用户对本次动作的明确确认。确认应覆盖使用这份 AK 在 dot 云端恢复 CLI 私有配置；CLI 缺失时，也应覆盖从阿里云官方安装。过去的批准不能代替本次确认。
3. 取得确认后，才可运行 `restore`。`--approval-message-id` 只是记录当次确认的引用；随便填字符串、传参数或本说明都不产生授权。调用者负责核实真实、当前、范围匹配的批准。
4. `restore` 下载并核验官方包，安装 CLI，创建私有配置；它不调用 STS。已有配置时会停止，不覆盖、不备份、不增加 profile。不要为绕过此保护而自动删除配置。
5. 随后可用已授权的只读 `verify` 验证身份。它固定调用韩国区域的官方 HTTPS STS endpoint，只输出布尔成功。CLI 的标准输出和错误均留在内存中，不转发身份信息或请求 URL。
6. 任何阻断、访问拒绝、未知配置或超出已批准范围的变化都应停止并汇报。不要关闭证书检查，不要擅自改架构、范围或执行环境。

## 调用方法

从说明目录执行。若暂存路径改变，只传文件路径；不传密钥内容。

```sh
cd /workspace/scratch/5e9614251709/aliyun-recovery-tools
python3 aliyun_recovery.py prepare

# 仅在取得本次明确确认之后执行。将占位文字替换为真实确认消息 ID。
python3 aliyun_recovery.py restore --approval-message-id '<本次确认消息ID>'

# 只读官方身份验证。
python3 aliyun_recovery.py verify
```

新暂存路径可通过 `prepare` 或 `restore` 的 `--credential-file /绝对路径` 指定，但必须仍在批准的工作区内且不能是符号链接。

直接调用现有 CLI 时，设置上面的隔离 HOME，并明确加 `--profile dot-web-deploy`。保留运行环境原有的 HTTPS_PROXY 等受支持代理变量；清空代理变量曾导致直连网络失败。不要打印代理值，不要启用调试或 HTTP 请求日志。新的部署、资源变更或服务器操作需要各自的授权，不属于恢复工作。

## 官方来源与校验值

- [官方发布包](https://github.com/aliyun/aliyun-cli/releases/download/v3.5.1/aliyun-cli-linux-3.5.1-amd64.tgz)
- 文件大小：77419794 字节
- SHA-256：`3a9a45b9c7899228074135612d2b7ebbf32abb97826d825787cb454cd3011bdc`
- [官方 profile 字段定义](https://raw.githubusercontent.com/aliyun/aliyun-cli/v3.5.1/config/profile.go)
- [官方配置结构](https://raw.githubusercontent.com/aliyun/aliyun-cli/v3.5.1/config/configuration.go)
- [官方 GetCallerIdentity 文档](https://www.alibabacloud.com/help/en/ram/developer-reference/api-sts-2015-04-01-getcalleridentity)

脚本仅接受固定版本、固定大小及固定哈希。升级版本需要另行检查官方来源和校验值；不要自动改用 latest。

## 离线审查与源码备份

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest -v test_aliyun_recovery.py
```

测试只使用明确标记的合成字符串和 mock，不读取真实凭据，不下载、不安装、不调用 STS。

若后续获准备份源码，只按白名单纳入本目录的 `README.md`、`aliyun_recovery.py` 和 `test_aliyun_recovery.py`。当前交付没有执行源码提交、上传或备份。

禁止纳入 `.aliyun-dot/`、`attachments/`、任何 `*.env*`、CLI `config.json`、AccessKey、API 请求日志、完整 STS 回包或运行目录归档。不要递归打包整个工作区。公开安装包也不需要放入源码备份。
