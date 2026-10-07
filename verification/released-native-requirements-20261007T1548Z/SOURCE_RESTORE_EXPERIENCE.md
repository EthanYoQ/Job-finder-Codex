# Pfizer 精确源恢复说明与经验

## 恢复合同

本配方将经固定SHA审核的最终未绑定实现直接作为包内源码种子；它不重放历史Servier到Pfizer的源码转换。恢复仅复制源码、模板、纯静态配置、测试源码及静态文档，不执行host、owner、supervision、采集、数据库、登记、激活、发布或上传。

原runtime、supervision与owner实现保留既有bytes。R2上下文信封实现也作为原bytes源文件保留，不再需要旧R2 manifest、current36路线清单或其它历史报告。baseline中的五个实现pin必须与包内原bytes一致。

## 精确白名单

static-inputs只包含schemaVersion、producerCommit、sourceId、route、sourceConfigSha256、sourceConfig、完整currentSourcePlan及implementationSha256。sourceConfig与currentSourcePlan的嵌套键均显式验证。缺字段或额外元数据是错误，不允许通过只拣选现有字段的宽松投影掩盖缺失。配置status属于固定producer的静态配置，不代表实际运行或发布状态。

在导入producer的纯静态计划函数前，route校验器先验证固定commit及实现SHA，随后重算完整plan、TRUE_B与配置hash。网络必须由offline.cjs禁用。该验证不消费实际运行上下文。

## 共同源码树

源读取范围仅限hosts/pfizer、owner-adaptations/pfizer-b-20261007T1548Z、verification/released-native-requirements-20261007T1548Z三个命名空间。其它来源可以共用仓库根，恢复器不枚举、读取或复制其它namespace。Pfizer namespace内任何额外文件、缺文件、字节差异、重复path或symlink均拒绝。

输出必须为显式指定的全新绝对目录，不能位于生产host、owner、producer、runtime或源包目录内。源检查全部通过后才创建输出。输出验证覆盖整个新目录，要求与本包清单逐字节相等。

## 可重复使用的经验

- 使用最终已审源码恢复，避免让历史中间转换重新引入包外依赖
- 配置按白名单保留完整必要字段，并与producer完整plan核对；不用测试结果报告替代源码合同
- 源侧按拥有的命名空间严格校验，输出侧按整个新目录严格校验，使多源共根与拒绝额外文件同时成立
- 冻结前验证正例与拒绝反例：缺配置、额外元数据、篡改、symlink、既有输出、无关namespace与本源额外文件
- 保留源码内固定部署路径；源恢复不等于环境重绑定，禁止为通过恢复检查改写运行源码

可信restore-manifest SHA必须从外层冻结source-plan取得。该哈希是恢复的显式前置条件，不能从待验输入自行推导后当作可信依据。
