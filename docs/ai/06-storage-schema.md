# 存储 Schema

## 主存储

THEIA 默认在 `%APPDATA%/THEIA` 保存持久状态；`THEIA_DATA_ROOT` 可以覆盖该路径。

```text
THEIA/
  data/
    manifest.json
    manifest.json.bak
    objects/
      state/
      academic/
      coursework/
      communication/
      catalog/
        school-schedule/
  buct-data.json          仅用于旧版迁移的快照
  buct-data.json.bak      仅用于旧版恢复的快照
  theia-feed.json         派生的兼容性导出
  auth-diagnostics.ndjson 仅包含安全诊断信息
  academic-calendar/
    manifest.json         官方资产及本地 PDF 分析
    assets/               当前校历 JPG 和两份来源 PDF
  session/                Electron 会话；绝不解析或导出
```

`data/manifest.json` 是真相来源指针。它使用 `theia-sharded-store/v1` Schema，包含修订号、时间戳和分片引用映射。

每个分片均不可变：

```json
{
  "schema": "theia-state-fragment/v1",
  "kind": "academic/grades",
  "digest": "value JSON 的 sha256",
  "writtenAt": "ISO 时间戳",
  "value": []
}
```

清单引用形如 `objects/academic/grades/<digest>.json` 的路径。未变化的数据复用既有对象，因此一次小型设置或邮件变更不会重写课程历史或全校课表。

## 分片映射

| 分片 | 对应的 `CampusState` 字段 |
| --- | --- |
| `state/meta` | 应用版本和时间戳 |
| `state/profile`、`state/settings`、`state/sync` | 不包含身份秘密的状态元数据 |
| `academic/*` | 学期、课程、课表、考试、成绩、已选课程和学业进度 |
| `coursework/*` | 作业和工作区 |
| `communication/*` | 通知和邮件元数据 |
| `catalog/index` | 除全校课表记录之外的全部 `dataCatalog` 内容 |
| `catalog/school-schedule/<term>` | 某学期完整缓存的全校课表 |

## 完整性与恢复

1. 新分片先写入临时文件，再以原子重命名完成替换。
2. 只有全部被引用的分片均已存在后，才写入新清单。
3. 替换清单前，旧清单会成为 `manifest.json.bak`。
4. 加载时，THEIA 校验每个分片的 Schema、种类和 SHA-256 摘要。
5. THEIA 以结构有效且最新的清单为基础，并可从另一份清单恢复损坏分片，而不丢弃其他较新的无关分片。
6. 如果任一必需分片在两份清单中均无效，加载立即停止并保持两份清单原样，绝不创建空存储。
7. 只有在分片存储尚不存在时，THEIA 才会一次性导入旧版 `buct-data.json` 或 `.bak` 并创建分片。

代码不得删除旧版快照。清理迁移数据必须先有用户可见且明确的备份策略。

## 版本化快照与数据域来源

进程内顾问使用 `CampusStore.snapshotWithRevision()` 读取数据。其 `state`、清单 `revision`、`committedAt` 和 `domainDigests` 均从同一个已提交视图克隆。不得先调用 `snapshot()`，再单独读取存储元数据来重建该元组。

`CampusState.sync.domains` 记录来源和数据域的出处。内容可用性、新鲜度、完整度和最近一次尝试状态是相互独立的维度，可以同时描述同一数据域。具体规则如下：

- `contentEmptyConfirmed` 描述当前保留内容：先前一次完整成功读取已证明该集合为空。
- `lastAttempt.emptyConfirmed` 只描述最近一次尝试。因此后续失败可以使 `contentEmptyConfirmed=true` 与 `lastAttempt.emptyConfirmed=false` 同时成立。
- 缺少旧版来源记录时，`freshness=unknown` 且 `completeness=unknown`；不得利用记录时间戳或全局 `updatedAt` 虚构来源水位时间。

聚合数据域由必需依赖推导：`academic <- terms,courses,selected-courses`、`coursework <- assignments,workspaces`、`local-data-catalog <- fitness,school-schedule,academic-calendar`。其完整度取必需依赖中的最弱值；`capturedAt` / `sourceSucceededAt` 水位取全部有效必需依赖中最早的时间。缺少任一必需水位时，不得乐观地生成聚合水位。

## 数据目录

`dataCatalog` 保存本地来源档案。每条记录都需要稳定标识、范围、采集时间、来源、解析器版本和刷新状态。不得在其中保存凭据、Cookie、令牌、原始页面或无限制的邮件正文。

全校课表记录有意按学期拆分。每学期完整缓存一次，筛选和排序必须使用本地记录。不得增加界面分页或缓存分页；选课页面应渲染该学期筛选后的全部记录。

`dataCatalog.academicCalendar` 镜像相邻 `academic-calendar/manifest.json` 中的资产元数据、OCR 校历和 `analysis`。分析只包含结构化事件、教学安排行、所选行证据以及该行实际使用的标记定义。PDF 二进制文件保留在 `academic-calendar/assets`；PDF 原始文本、凭据和浏览器会话数据绝不能进入目录或 Feed。

## Feed 与 API

`theia-feed.json` 从最新持久快照派生并原子替换。它可能较大，因为它是供离线读取器使用的兼容性导出。不得将其当作数据库使用，也不得手动编辑。

THEIA 运行时，应改用绑定在 `127.0.0.1` 的回环 API：

```text
GET /v1/data-manifest
GET /v1/feed
GET /v1/grades
GET /v1/academic-progress
GET /v1/school-schedule?termId=2025-3&keyword=MAT13904T
```

该 API 只读，必须仅绑定回环地址，并且不得泄露凭据或浏览器会话数据。
