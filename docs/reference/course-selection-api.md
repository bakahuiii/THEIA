# THEIA 抢课系统 · 接口文档

> 基于对 BUCT 正方教务系统（zzxkyzb 自主选课模块）的逆向分析 + 实机验证。
> 所有接口均需携带已认证的浏览器 `JSESSIONID` cookie。
> 验证时间：2026-08-27，BUCT jwglxt 2026-2027 第一学期。

---

## 目录

1. [选课流程总览](#1-选课流程总览)
2. [接口清单](#2-接口清单)
3. [参数详解](#3-参数详解)
4. [提交 payload 详解](#4-提交-payload-详解)
5. [关键参数来源](#5-关键参数来源)
6. [常见错误码](#6-常见错误码)

---

## 1. 选课流程总览

```
选课首页（zzxkyzb_cxZzxkYzbIndex）
  │
  ├─ 解析 tab → 获取批次参数（xkkz_id, xkkz_xh, njdm_id, zyh_id 等）
  │
  ├─ display 页（zzxkyzb_cxZzxkYzbDisplay）
  │    获取上下文参数（rwlx, rlzlkz, xkly, bklx_id 等）
  │
  ├─ 目录搜索（zzxkyzb_cxZzxkYzbPartDisplay）
  │    搜索课程，获取 kch_id, jxb_id, jxbzls
  │
  ├─ 教学班接口（zzxkyzbjk_cxJxbWithKchZzxkYzb）
  │    获取 do_jxb_id（选课操作 token）
  │
  └─ 提交选课（zzxkyzbjk_xkBcZyZzxkYzb） ← 含 jk 的端点
       提交选课请求
```

---

## 2. 接口清单

### 2.1 选课首页

获取选课批次信息、当前学生上下文。

```
GET /jwglxt/xsxk/zzxkyzb_cxZzxkYzbIndex.html?gnmkdm=N253512&layout=default
```

**返回**：HTML 页面，需解析以下内容：

| 解析方式 | 示例 | 说明 |
|---|---|---|
| `<input>` 的 value | `xkxnm=2026` | 当前学年 |
| `<input>` 的 value | `xkxqm=3` | 当前学期（3=第一学期, 12=第二学期, 16=第三学期） |
| `<input>` 的 value | `iskxk=1` | 是否允许选课（1=是） |
| `<input>` 的 value | `njdm_id=2024` | 当前学生年级 ID |
| `<input>` 的 value | `zyh_id=0202` | 当前学生专业 ID |
| `<input>` 的 value | `firstXkkzId=58E4DEB...` | 默认选课批次控制 ID（主修课） |
| `<input>` 的 value | `firstXkkzXh=76f0e39a...` | ⭐ 默认选课批次 hash（**每次会话不同，必须实时解析**） |
| `<a onclick="queryCourse(...)">` | `'01','58E4DEB...','2024','0202','76f0e39a...'` | ⭐ 选课批次 tab，各批次的 xkkz_id, njdm, zyh, **xkkz_xh** |

**选课批次 tab 解析**：

```html
<a onclick="queryCourse(this, '01', '58E4DEB1905BDD2FE063B89AC379E922', '2024', '0202', '76f0e39a90ccd241ba55...')">
```
参数顺序（第 6 个参数是 xkkz_xh，最容易被忽略但**必须携带**）：

| 参数位置 | 含义 | 取值示例 |
|---|---|---|
| 1（kklxdm） | 课程类别代码 | `01`=主修, `06`=体育, `10`=素质教育, `11`=网络课程 |
| 2（xkkz_id） | 选课批次控制 ID | `58E4DEB1905BDD2FE063B89AC379E922` |
| 3（njdm_id） | 年级 ID | `2024` |
| 4（zyh_id） | 专业 ID | `0202` |
| 5（xkkz_xh） | ⭐ 选课批次 hash（动态） | `76f0e39a90ccd241ba55...` |

> ⭐ `xkkz_xh` 每次打开选课首页都会变化，是**会话级动态 token**。必须从当前页面实时解析，不能硬编码或缓存。如果漏传此参数，目录搜索返回 0 条。

---

### 2.2 Display 页

获取当前批次的选课上下文参数。

```
POST /jwglxt/xsxk/zzxkyzb_cxZzxkYzbDisplay.html?gnmkdm=N253512
Content-Type: application/x-www-form-urlencoded
```

**请求参数**：

| 参数 | 必填 | 说明 | 来源 |
|---|---|---|---|
| `xkkz_id` | ✅ | 选课批次控制 ID | 从首页 tab 解析 |
| `kklxdm` | ✅ | 课程类别代码 | 同上 |
| `xkkz_xh` | ✅ | ⭐ 选课批次 hash（动态） | 从首页 tab 解析 |
| `xszxzt` | 否 | 修读状态 | `1`（默认） |
| `kspage` | 否 | 起始行 | `0` |
| `jspage` | 否 | 结束行 | `0` |

**返回**：HTML 页面，包含 `<input>` 字段，需解析：

| 字段 | 说明 | 主修课示例 | 网课示例 |
|---|---|---|---|
| `rwlx` | 任务类型 | `1` | `2` |
| `rlzlkz` | 容量限制控制 | `1` | `1` |
| `xkly` | 选课来源 | `1` | `0` |
| `bklx_id` | 补考类型 | `0` | `0` |
| `xklc` | 选课轮次 | 可能为空 | 可能为空 |
| `xkxnm` | 学年 | `2026` | `2026` |
| `xkxqm` | 学期 | `3` | `3` |
| `jcxx_id` | 课程信息 ID | 可能为空 | 可能为空 |

> ⭐ `rwlx` 在不同批次下不同：主修为 `1`，网课为 `2`。提交时必须使用当前批次的值。

---

### 2.3 目录搜索

搜索当前批次内的可选课程。

```
POST /jwglxt/xsxk/zzxkyzb_cxZzxkYzbPartDisplay.html?gnmkdm=N253512
Content-Type: application/x-www-form-urlencoded
```

**请求参数**（共约 30+ 个字段，来自 display 上下文 + 首页上下文）：

| 参数 | 必填 | 说明 | 典型值 |
|---|---|---|---|
| `filter_list[0]` | 否 | 课程代码/名称搜索（精确搜索时传） | `PSE30200T` |
| `filterKey` | 否 | 搜索模式 | `all`（配合 filter_list 使用） |
| `xkkz_id` | ✅ | 选课批次控制 ID | 从 tab 解析 |
| `kklxdm` | ✅ | 课程类别代码 | `01` |
| `xkkz_xh` | ✅ | ⭐ 选课批次 hash（动态） | 从 tab 解析 |
| `rwlx` | ✅ | 任务类型 | 从 display 取 |
| `njdm_id` | ✅ | 年级 ID | 从首页/display 取 |
| `zyh_id` | ✅ | 专业 ID | 从首页/display 取 |
| `xkxnm` | ✅ | 学年 | 从首页/display 取 |
| `xkxqm` | ✅ | 学期 | 从首页/display 取 |
| `kspage` | ✅ | 起始行号（1-based） | `1` |
| `jspage` | ✅ | 结束行号 | `10` 或 `100` |
| `xqh_id` | ✅ | 校区 ID | 从首页取 |
| `jg_id` | ✅ | 学院 ID | 从首页取 |
| `zyfx_id` | 否 | 专业方向 | 从首页取 |
| `bh_id` | 否 | 班级 ID | 从首页取 |
| `xbm` | 否 | 性别 | 从首页取 |
| `xslbdm` | 否 | 学生类别代码 | 从首页取 |
| `mzm` | 否 | 民族 | 从首页取 |
| `xz` | 否 | 学制 | 从首页取 |
| `ccdm` | 否 | 层次代码 | 从首页取 |
| `xsbj` | 否 | 学生标记 | 从首页取 |
| `bklx_id` | 否 | 补考类型 | 从 display 取 |
| `njdm_id_1` | 否 | 年级 ID（备用） | 同 njdm_id |
| `zyh_id_1` | 否 | 专业 ID（备用） | 同 zyh_id |

**返回**：JSON

```json
{
  "flag": "1",
  "tmpList": [
    {
      "kch_id": "PSE30200T",           // 课程内部 ID（提交用）
      "kch": "PSE30200T",              // 课程代码（教学班搜索用）
      "kcmc": "科技写作与报告",         // 课程名称
      "jxb_id": "54F6517FA03300DDE...", // 教学班 ID（不是提交用，只是显示）
      "jxbmc": "科技写作与报告-0002",    // 教学班名称
      "jxbzls": "1",                    // 教学班组成标志（1=无实验班，>1=有实验班）
      "jxbxf": "2.0",                   // 学分
      "kclxmc": "理论课",               // 课程类型
      "rwzxs": "33",                    // 可选人数
      "yxzrs": "47",                    // 已选人数
      "jsxx": "2022500008/张秀玲/副教授", // 教师（格式：工号/姓名/职称）
      "jxdd": "一教B-506",              // 上课地点
      "sksj": "星期一第6-8节{1-9周}",    // 上课时间
      "cxbj": "0",                      // 重修标记
      "fxbj": "0",                      // 辅修标记
      "xxkbj": "0",                     // 选课标记
      "kzmc": "公选课课程组,网络课程",    // 课程组名称（网课有）
      "year": "2026",                   // 学年
      "xf": "2.0"                       // 学分（与 jxbxf 可能不同）
    }
  ],
  "totalCount": 0,                      // 总记录数（可能为空）
  "totalResult": 0,                     // 总结果数（可能为空）
  "sfxsjc": "0"                         // 是否显示时间
}
```

**分页说明**：`kspage` 和 `jspage` 是 1-based 行号，不是页号。例如 `kspage=1, jspage=100` 表示第 1-100 行。

---

### 2.4 教学班接口

获取学期的具体教学班信息，特别是 **`do_jxb_id`**（选课提交操作 token）。

```
POST /jwglxt/xsxk/zzxkyzbjk_cxJxbWithKchZzxkYzb.html?gnmkdm=N253512
Content-Type: application/x-www-form-urlencoded
```

**请求参数**（与目录搜索类似，比目录搜索多几个字段）：

| 参数 | 必填 | 说明 | 典型值 |
|---|---|---|---|
| `filter_list[0]` | ✅ | ⭐ 课程代码 | ⭐ **主修课 = 用 `kch` 或 `kch_id` 均可；网课 = 必须用 `kch`（课程代码）** |
| `kch_id` | ✅ | 课程内部 ID | 从目录搜索结果取 |
| `xkkz_id` | ✅ | 选课批次控制 ID | 从 tab 解析 |
| `kklxdm` | ✅ | 课程类别代码 | `01` |
| `xkkz_xh` | ✅ | 选课批次 hash（动态） | 从 tab 解析 |
| `rwlx` | ✅ | 任务类型 | 从 display 取 |
| `njdm_id` | ✅ | 年级 ID | 从首页取 |
| `zyh_id` | ✅ | 专业 ID | 从首页取 |
| `xkxnm` | ✅ | 学年 | 从首页取 |
| `xkxqm` | ✅ | 学期 | 从首页取 |
| `xkxskcgskg` | 否 | 选课时间/课程时间冲突检查 | 从 display 取 |
| ... | 否 | 其余字段同目录搜索 | 同目录搜索 |

**返回**：JSON 数组

```json
[
  {
    "do_jxb_id": "686a8851a8138572109fe60200786fea97b17d45a3fd1df6e4f911e508a6d6524509a8b9057a8c71c643e0d72f4aee9799546db96e48b60b48ac1ece2c07c3f40097365784af118934925ac713292f2c6de3fc9e1cdad3d15267d28681ea2c4b631b4541f07165acf59169396e523b7bb3ee8835b058a23c89b416565e0e7b8d",
    // ↑ ⭐ 选课提交操作 token，必须用这个值作为 jxb_ids 提交，不能用 jxb_id

    "jxb_id": "54E3268AB8C2C5D0E063B99AC379B9D8",
    "jxbmc": "氢能机遇与挑战（全英文）-0001",
    "jsxx": "2022500008/张秀玲/副教授",
    "jxdd": "一教A-308<br/>一教A-308",
    "sksj": "星期一第10-12节{11-18周}<br/>星期二第10-12节{11-13周}",
    "jxbxf": "1.5",
    "jxbrl": "67",                    // 容量
    "yxzrs": "31",                    // 已选人数
    "rwzxs": "12",                    // 可选人数
    "bxbj": "0",                      // 补选标记
    "fxbj": "0",                      // 辅修标记
    "cxbj": "0",                      // 重修标记
    "kclbmc": "专业",                  // 课程类别名称
    "kcxzmc": "专业选修",              // 课程性质名称
    "kkxymc": "材料科学与工程学院",     // 开课学院
    "xf": "2.0",                      // 学分
    "xqh_id": "2",                    // 校区
    "xqumc": "北区",                  // 校区名称
    "year": "2026"                    // 学年
  }
]
```

> ⭐ `do_jxb_id` 与 `jxb_id` 不同。`jxb_id` 是教学班显示 ID，**不能用于提交**（提交会返回"未知异常"）。必须使用 `do_jxb_id` 作为提交的 `jxb_ids` 参数。

---

### 2.5 实验班接口（当 jxbzls > 1 时）

当课程的 `jxbzls > 1`（有实验班/理论+实验分开）时，需要合并理论班和实验班的 `do_jxb_id`。

```
POST /jwglxt/xsxk/zzxkyzb_xkZyZzxkYzbZjxb.html?gnmkdm=N253512
Content-Type: application/x-www-form-urlencoded
```

**请求参数**：`jxb_id`, `do_jxb_id`, `jxbzls`, `rwlx`, `rlzlkz`, `xkxnm`, `xkxqm`, `xkly`, `kklxdm`, `njdm_id`, `zyh_id`, `xh_id` 等。

**返回**：JSON 数组或 HTML，包含 `do_jxb_id` 或 `select_do_jxb` 字段。
合并方式：`合并后的 jxb_ids = do_jxb_id1 + ',' + do_jxb_id2`。

---

### 2.6 提交选课（核心）

```
POST /jwglxt/xsxk/zzxkyzbjk_xkBcZyZzxkYzb.html?gnmkdm=N253512
Content-Type: application/x-www-form-urlencoded
```

**注意**：端点路径含 `jk`（`zzxkyzbjk_` 而非 `zzxkyzb_`）。`jk` 表示"教学班"（jk = 教学），是不带 `jk` 的端点的选课提交版本。

**请求参数**（共 20 个字段，构成完整的 "saveCourse()" payload）：

| 参数 | 必填 | 类型 | 说明 | 来源 |
|---|---|---|---|---|
| `jxb_ids` | ✅ | string | ⭐ `do_jxb_id`（教学班操作 token），非 `jxb_id` | 教学班接口返回 |
| `kch_id` | ✅ | string | 课程内部 ID | 目录搜索结果 |
| `kcmc` | ✅ | string | 课程名称（用于显示，非必须但建议传） | 目录搜索结果 |
| `rwlx` | ✅ | string | 任务类型（主修=1，网课=2） | display 上下文 |
| `rlkz` | 否 | string | 容量控制 | display 上下文或 selectionContext |
| `cdrlkz` | 否 | string | 场地容量控制 | display 上下文或 selectionContext |
| `rlzlkz` | 否 | string | 容量限制控制 | display 上下文或 selectionContext |
| `sxbj` | ✅ | string | 双学位标记（`0` 或 `1`，如果 rlkz/cdrlkz/rlzlkz 任一为 `1` 则 `1`） | 计算值 |
| `xxkbj` | 否 | string | 选课标记 | display 上下文或 selectionContext |
| `qz` | 否 | string | 权重（默认 `0`） | 固定 |
| `cxbj` | 否 | string | 重修标记（默认 `0`） | catalog/class 返回或 context |
| `xkkz_id` | ✅ | string | 选课批次控制 ID | 从 tab 解析 |
| `xkkz_xh` | ✅ | string | ⭐ 选课批次 hash（动态） | 从 tab 解析 |
| `njdm_id` | ✅ | string | 年级 ID | 当前学生年级，从首页取 |
| `zyh_id` | ✅ | string | 专业 ID | 当前学生专业，从首页取 |
| `kklxdm` | ✅ | string | 课程类别代码 | 从 tab 解析 |
| `xklc` | 否 | string | 选课轮次 | display 上下文 |
| `xkxnm` | ✅ | string | 学年（如 `2026`） | 首页/display 上下文 |
| `xkxqm` | ✅ | string | 学期（`3`/`12`/`16`） | 首页/display 上下文 |
| `jcxx_id` | 否 | string | 课程信息 ID（可能为空） | display 上下文或 selectionContext |

**提交示例**：

```http
POST /jwglxt/xsxk/zzxkyzbjk_xkBcZyZzxkYzb.html?gnmkdm=N253512
Content-Type: application/x-www-form-urlencoded

jxb_ids=686a8851a8138572109fe60200786fea97b17d45a3fd1df6e4f911e508a6d6524509a8b9057a8c71c643e0d72f4aee9799546db96e48b60b48ac1ece2c07c3f40097365784af118934925ac713292f2c6de3fc9e1cdad3d15267d28681ea2c4b631b4541f07165acf59169396e523b7bb3ee8835b058a23c89b416565e0e7b8d
&kch_id=PSE30200T
&kcmc=科技写作与报告
&rwlx=1
&rlkz=
&cdrlkz=
&rlzlkz=1
&sxbj=1
&xxkbj=0
&qz=0
&cxbj=0
&xkkz_id=58E4DEB1905BDD2FE063B89AC379E922
&xkkz_xh=76f0e39a90ccd241ba55012e0d5cc0a06be63e01071716a0a944dbc02d92852316732bb4dec2c56bcf6dcd779ec00c79872ab90e9d362260ead151e58d2c4c52255f43ad9253efdae2d3b8283242b68375f2e5c5ab68eed3e7f4735087264f164b5ed0fd35b06f0f510ff9d8cc8e908258efc9e6fa8d29aca50588c5860e9d57
&njdm_id=2024
&zyh_id=0202
&kklxdm=01
&xklc=
&xkxnm=2026
&xkxqm=3
&jcxx_id=
```

**返回**：JSON

```json
// 成功示例
{"msg":"选课成功！","flag":"1"}

// 已选（幂等）
{"msg":"已选！","flag":"6"}

// 学分上限（但已选上）
{"msg":"超过学分限制！","flag":"3"}

// 失败示例
{"msg":"不可跨专业选课！","flag":"0"}
{"msg":"不可跨年级选课！","flag":"0"}
{"msg":"超过网络课程本学期本专业最高选课门次限制，不可选！","flag":"0"}
{"msg":"出现未知异常，请与管理员联系！","flag":"0"}
```

**`flag` 码含义**：

| flag | 含义 | 是否成功 |
|---|---|---|
| `1` | 选课成功 | ✅ 成功 |
| `3` | 超过学分限制（但已选上） | ✅ 成功（幂等） |
| `6` | 已经选过这门课 | ✅ 成功（幂等） |
| `0` | 失败（具体原因在 `msg` 中） | ❌ |
| 其他 | 失败 | ❌ |

---

## 3. 参数详解

### 3.1 课程类别代码（`kklxdm`）

| 代码 | 名称 | 说明 |
|---|---|---|
| `01` | 主修课程 | 专业必修/选修、公共基础必修等 |
| `06` | 体育课 | 体育课程 |
| `10` | 素质教育课 | 通识教育、素质教育课程 |
| `11` | 网络课程 | 在线开放课程（MOOC 等） |

每个 `kklxdm` 有独立的 `xkkz_id` 和 `xkkz_xh`，在选课首页的 tab 中给出。

### 3.2 学年学期（`xkxnm` / `xkxqm`）

| 字段 | 含义 | 示例 |
|---|---|---|
| `xkxnm` | 入学学年（选课学年） | `2026` |
| `xkxqm` | 学期代码 | `3`=第一学期, `12`=第二学期, `16`=第三学期 |

### 3.3 任务类型（`rwlx`）

| 值 | 含义 | 使用场景 |
|---|---|---|
| `1` | 正常选课 | 主修、素质、体育等 |
| `2` | 网课/重修 | 网络课程 |

### 3.4 选课控制参数

| 参数 | 含义 | 说明 |
|---|---|---|
| `xkkz_id` | 选课批次控制 ID | 每学期/每批次不同，对应一个选课窗口 |
| `xkkz_xh` | 选课批次 hash（动态） | ⭐ **每次会话不同，必须实时从首页解析。** 漏传则目录搜索返回 0 条 |
| `rlkz` | 人数容量控制 | 从 display 页或 selectionContext 取 |
| `cdrlkz` | 场地容量控制 | 同上 |
| `rlzlkz` | 容量限制控制 | 同上 |
| `sxbj` | 双学位/辅修标记 | `0`=否, `1`=是。如果 `rlkz/cdrlkz/rlzlkz` 任一为 `1` 则 `1` |
| `jcxx_id` | 课程信息 ID | 部分选课需要，从 display 页或 selectionContext 取 |

---

## 4. 提交 payload 详解

### 4.1 参数来源优先级

```
candidate.selectionContext（目录/教学班返回行中的字段）
  → display 上下文（从 display 页解析的 input 值）
  → 首页上下文（从首页解析的 input 值）
  → 固定默认值
```

### 4.2 关键参数间的关系

```
sxbj = (rlkz === '1' || cdrlkz === '1' || rlzlkz === '1') ? '1' : '0'
```

### 4.3 实验班时的 jxb_ids

当 `jxbzls > 1`（课程含实验班）时，需要：
1. 先调教学班接口（`zzxkyzbjk_cxJxbWithKchZzxkYzb`）获取理论班和实验班的 `do_jxb_id`
2. 再调实验班接口（`zzxkyzb_xkZyZzxkYzbZjxb`）确认合并
3. `jxb_ids = 理论班do_jxb_id + ',' + 实验班do_jxb_id`

---

## 5. 关键参数来源

| 参数 | 来源 | 获取方式 |
|---|---|---|
| `xkkz_id` | 选课首页 tab `onclick` 第 3 参，或 `firstXkkzId` input | ⭐ 实时解析 |
| `xkkz_xh` | 选课首页 tab `onclick` 第 6 参，或 `firstXkkzXh` input | ⭐ 实时解析，**每次会话不同** |
| `kklxdm` | 选课首页 tab `onclick` 第 1 参 | 实时解析 |
| `njdm_id` | 选课首页 `njdm_id` input | 实时解析 |
| `zyh_id` | 选课首页 `zyh_id` input | 实时解析 |
| `rwlx` / `rlzlkz` 等 | display 页的 input 值 | POST 到 display 接口后解析 |
| `kch_id` / `kcmc` | 目录搜索结果 | POST 到 catalog 接口 |
| `do_jxb_id` | 教学班接口返回 | ⭐ 必须用 `kch`（课程代码）作为 `filter_list[0]`，**网课不能用 `kch_id`** |
| `jxb_ids`（提交用） | 就是 `do_jxb_id`（合并实验班后可能有多个逗号分隔） | 与 `jxb_id` 不同，不能用 `jxb_id` 提交 |

---

## 6. 常见错误码

| `flag` | `msg` | 原因 | 处理 |
|---|---|---|---|
| `0` | 不可跨专业选课！ | 课程不属于当前学生专业 | 该课程对当前学生不可选 |
| `0` | 不可跨年级选课！ | 课程不属于当前学生年级 | 该课程对当前学生不可选 |
| `0` | 超过网络课程本学期本专业最高选课门次限制，不可选！ | 网课门数已达上限 | 退课后再选，或下学期选 |
| `0` | 出现未知异常，请与管理员联系！ | 提交参数错误（如 `jxb_ids` 不是有效的 `do_jxb_id`） | 检查参数，特别是 `jxb_ids` 是否来自教学班接口的 `do_jxb_id` |
| `0` | 超过学分限制！ | 已选学分达到上限（但 flag=3 时是成功） | 检查 `flag` 值，`3` 算成功 |
| `1` | 选课成功！ | 选课成功 | ✅ 成功 |
| `3` | 超过学分限制！ | 学分超限但已选上 | ✅ 成功（幂等） |
| `6` | 已选！ | 已经选过这门课 | ✅ 成功（幂等） |

---

## 附录：THEIA 代码中的对应实现

Codex 已在 `core/course-selection.mjs` 中实现上述所有接口。关键代码位置：

| 功能 | 方法 | 行号 |
|---|---|---|
| 首页解析（tab/xkkz_xh） | `discover()` / `parseBlocks()` | 686-724, 312-332 |
| display 上下文 | `candidates()` 中调 `DISPLAY_URL` | 743-751 |
| 目录搜索（含 xkkz_xh） | `candidates()` 中调 `COURSE_URL` | 766-774 |
| 教学班接口（do_jxb_id） | `candidates()` 中调 `CLASS_URL` | 870 |
| 实验班合并 | `resolveSubmitOperationIds()` 调 `CLASS_COMPONENT_URL` | 1030-1086 |
| 提交选课 | `attempt()` 调 `SELECT_URL` | 1088-1173 |
| 全校课表 fallback | `findCandidate()` → `trySchoolScheduleFallback()` | 1303-1339 |
| 跨批次搜索 | `findCandidate()` 遍历 `portal.blocks` | 1348-1390 |