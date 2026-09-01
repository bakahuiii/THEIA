# 开发文档

这里放面向维护者的当前实现说明。它们描述源码、测试和发布流程，不是用户操作手册。

## 阅读顺序

| 目的 | 文档 |
| --- | --- |
| 先理解进程、权限和数据流 | [系统架构](architecture.md) |
| 修改代码或增加功能 | [开发者指南](developer-guide.md) |
| 理解数据采集、存储和恢复 | [数据生命周期](data-lifecycle.md) 与 [抓取--存储手册](data-capture-storage-handbook.md) |
| 核对集合所有权和暴露边界 | [数据所有权矩阵](data-ownership-matrix.md) |
| 本地运行、测试、打包和发布 | [运行、测试与发布](operations-and-testing.md) |
| 排查启动问题 | [启动排障](troubleshooting.md) |
| 推进 Android 手机版增量对齐 | [手机版增量技术交接](mobile-increment-v0.7.0.md) |

## 维护原则

- 源码和测试是事实来源；文档不能把规划、猜测或历史实测当成当前行为。
- `docs/ai/` 只保留当前仍有维护价值的工程专题，阶段性报告统一放在 [归档](../archive/README.md)。
- 修改 IPC、数据模型、来源、权限或导出时，同步更新对应参考文档和回归测试。
- 不在文档、夹具或诊断示例中写入真实账号、Cookie、令牌、邮件正文或个人快照。
