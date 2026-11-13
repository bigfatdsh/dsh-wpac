# dsh-wpac

WPAC 是一个 DSH **agent 预设**（不是独立 app）：选中它之后，每条消息都会先被拆成
W / P / A / C 四要素，缺什么就带选项追问，补齐后把委托重写成一份可复用的提示词，
再执行、自检、交付。

**作者：姜涛**

## 四要素

| 要素 | 含义 | 一句话判据 |
| --- | --- | --- |
| W（我是） | 做这件事的人是什么身份 | 换成另一个人，写出来的东西会不一样吗 |
| P（要什么） | 交付什么、达成什么、怎样算成 | 说不说得出一句"做成了就是……" |
| A（给谁） | 谁读、谁用、谁验收、什么场景 | 知不知道对方凭什么点头 |
| C（约束） | 情景 / 表达 / 产出 | 哪些是硬约束，哪些只是偏好 |

文字类任务默认 C：去 AI 腔（句长错落、虚词自然、具体细节、个人判断），
不用"首先/其次/总之"模板，不写"作为 AI"。

## 结构

```
dsh-wpac/
├── package.json           # bundle 声明：dsh.bundle.patch → cordis.patch.yml
├── cordis.patch.yml       # 一条 insert：preset-wpac（工具面 + wpac-persona 子插件）
├── lib/index.js           # 空宿主半边：profile Loader 的 `dsh-wpac` 锚点行，只为让客户端半边被扫到
├── lib/inject6.js         # 预设内入口（文件名义契约）：只转发行 persona.js
├── lib/persona.js         # 人格段：注册 system prompt section（每轮现读 persona.md）
├── lib/review.js          # 结构确认：pending 队列 + /dsh-wpac-review 端点 + wpac_structure_review 工具
├── lib/tools.js           # 预设内插件行：把 review.js 接到 Cordis（tools / webServer）
├── lib/client.js          # 浏览器半边：shell.overlay 里的结构确认弹窗（左编辑栏 + 右结构/详情）
├── persona.md             # 人格段正文（唯一真源）
├── skills/wpac/SKILL.md   # 深度手册（判定表/选项库/约束清单/模板/例句/产出前清单）
├── templates/profile.md   # 长期设定模板（可选，复制到工作区 wpac/profile.md）
├── scripts/verify.mjs     # 装前自检
├── scripts/install-skill.mjs  # 把 skills/wpac 装进 ~/.dsh/skills/wpac
├── scripts/publish-github.mjs # 推到 GitHub
├── tests/behavior.md      # 行为回归场景（改人格段后照着跑）
├── CHANGELOG.md           # 版本与改动
├── LICENSE                # MIT
└── README.md
```

三层分工，改东西只动对应那一层：

1. **人格层**（`persona.md`，由 `lib/persona.js` 每轮现读）：常驻上下文，只放铁律与流程，
   越短越好。改流程、改默认值、改自检项，改这里。
2. **手册层**（`skills/wpac/SKILL.md`）：按需加载，放长内容。加模板、加例句、加选项库，
   改这里，不动人格。
3. **工具层**（`plugins` 列表）：决定这个预设能用哪些工具。工具面克隆自 `standard`
   （已验证可激活），宿主上已启用的插件（`univer_*`、`sd_*`、`memory`、
   `computer-use` 等）由宿主上下文继承，**不要在这里重复声明**，否则会出现重复注册。

## 最终架构与验证方法

一条链：

```
cordis.patch.yml（预设 wpac）
   └── plugins[0] wpac-persona → dsh-wpac/inject → lib/inject6.js → lib/persona.js
          └── ctx.systemPrompt.section({ name:'wpac:protocol', order:10, text })
                 └── persona.md（每轮现读，改文案不用重启）
```

四条实测结论（写死在这里，避免以后重复踩）：

1. 预设里的 `persona` 行会被部署级人格顶掉，人格必须由插件注册。
2. 插件必须先 `export const inject = ['systemPrompt']`，否则读 `ctx.systemPrompt` 直接抛错，整个预设变「加载失败」。
3. `section()` 必须同时给 `name` 与 `order`。
4. **验证方式**：不要看 `ctx.systemPrompt.assemble()`——它只反映部署级段，会误判成"没挂上"；
   要读会话里真正发给模型的 system 消息：`agent.session.deriveMessages()` 的第一条，
   里面出现「你是 **WPAC**」才算挂上。

`lib/inject6.js` 这个入口名是契约（预设行指向 `dsh-wpac/inject`，exports 也指它）。ESM 按 URL 缓存，真要换实现就换它转发的文件，入口别动。

## 文件类委托（实验性）：PDF / PPT / Word / 表格

文件类也纳入 WPAC，但和文字类走两条路：

1. **开头先问**「是否启用文件类 WPAC（实验性）」——启用 / 不启用两个选项。没问过、用户选不启用，就按普通任务做，不弹窗；问之前禁止生成任何成品文件。
2. **启用后走 F1–F5**：问两轮（给谁/解决什么、格式页数模板禁项）→ 拆 4–12 块（`format`= slides / document / pdf / table，每块带 `text`）→ 弹结构确认 → 按意见改完直接生成文件 → 文件自检（能打开、页数/目录对得上、无占位符、字不出框）→ 只给路径 + 一行说明。
3. **选中模块看的是那一页的截图**：每块的 `preview` 先渲染成 PNG（PPT/PDF 整页、Word 按节首页、表格按区域），弹窗选中模块时直接显示这张图，下面是文字要点；出不了图自动回退文字。预览图由宿主端点 `/dsh-wpac-preview?review=&module=` 按当前结构白名单取，**按文件头嗅探**（DSH 附件对象没有扩展名也认），确认后 15 分钟内仍可加载。review 带 `schemaVersion`：宿主旧时弹窗会直接说「宿主还是旧版」，不会误报模型没给图。
4. **格式文案唯一真源**：`lib/formats.js` 定义五种格式的标签/单位/标题（PPT=页、Word=节、PDF=页、表格=块），宿主随 `review.display` 下发给弹窗，浏览器不再各写一份。
5. 细则在技能 `references/文件类-WPAC.md`（各格式骨架、问题库、自检清单、六个常见坑）。

## 结构确认弹窗（交付前强制）

交付前最后一步：模型调 `wpac_structure_review`，在**当前会话里直接弹出**一个盖住整个应用的弹窗（挂 `shell.overlay`，不依赖外部浏览器）。用户在弹窗里按模块确认，模型才准交付正文。

- **两半边**：宿主 `lib/review.js`（pending 队列 + `/dsh-wpac-review` 端点 + 工具）；浏览器 `lib/client.js`（轮询端点 → 弹窗 → POST 决定）。客户端靠 profile Loader 里那行 `name: 'dsh-wpac'`（`cordis.patch.yml` 的 `wpac-client`）被 DSH 扫到，少了它弹窗永远不出来、工具只会返回 `no-client`。
- **弹窗**：顶部一条引导（① 点模块看正文 ② 写意见 ③ 点蓝色确认）；左侧 380px 用 grid 固定四行（步骤标签 / 模块列表 / 意见编辑 / 确认栏），窗口再矮也不会互相挤；右侧默认结构总览，点左侧模块切成该模块详情（标题 / 作用 / 摘要 / 正文 `text` / 待改意见）。
- **只有一个确认键**：没有 ×、也没有取消；不写意见直接确认就是交付。同一份结构再送进来（模型多调一次）会被客户端按指纹静默确认，不会再弹第二遍。
- **按交付物适配**：`format` = `prose`（文字稿按段）/ `slides`（PPT 按页）/ `document`（Word 按节）/ `table`（表格按区域）；不传按 `kind` 猜。每块 `text` 必填，缺了宿主直接打回 `reason=missing-text`，不开弹窗。
- **一轮确认**：按 feedback 改完、跑 preflight 直接交付，不再弹第二轮（除非用户明确要求复看）；`cancel` / `timeout` / `no-client` / `superseded` 一律不许交付。宿主是单槽队列：新的一条进来，旧的自动作废，不会出现「确认完又冒出一个旧弹窗」。
- **排障**：`/tmp/wpac-review-boot.log` 里看 `row apply` → `endpoint mounted` → `tool registered` → `client half is alive`（客户端在轮询）→ `modal slot registered`（弹窗槽位挂上）→ `review start: #id kind=… format=… modules=N withText=M`。断在哪一步就知道缺哪半。

## 安装

```bash
node scripts/verify.mjs          # 先自检
```

然后让 DSH 安装这个 bundle（绝对路径）：

```
plugin_manager  action=install_bundle  target=<本目录的绝对路径>   # 例：~/Documents/deepseek-harness/default-workspace/adapted/dsh-wpac
```

装完在新建会话的预设列表里选「wpac模式」。

## 长期设定（可选）

把 `templates/profile.md` 复制到工作区 `wpac/profile.md` 并填几行（我是谁、常写什么、
固定受众、禁用词），WPAC 每次开工前会先读它当默认值，本次对话里的指令优先。

```bash
mkdir -p wpac && cp templates/profile.md wpac/profile.md
```

## 发布到 GitHub

```bash
node scripts/publish-github.mjs --dry-run   # 看会推哪些文件
node scripts/publish-github.mjs             # 推到 bigfatdsh/dsh-wpac
```

走 `api.github.com`（本机 `github.com:22` 不通），token 取 macOS 钥匙串，不落文件；
按远端 sha 比对，只推变化的文件。仓库不存在时脚本会先建（public）。

## 看不到预设？

先分清两件事：**预设是"新建会话时选的模式"，不是"当前会话里能切换的开关"**。
已经开着的会话固定用创建时那个预设，标题旁边显示的就是它。

按顺序排查：

1. 新建会话 → 模式列表 → **自定义**分组，WPAC 应排在第一张卡（`order: 0`）。
2. 还是没有：⌘R 重载窗口，或退出重开 App（预设声明来自 bundle 层，界面只在新会话时读一次名册）。
3. 命令行核对：
   ```bash
   node scripts/verify.mjs                      # 声明/人格/技能是否完整
   ```
   再看 `plugin_manager` 的 `list_plugins`，`preset-wpac` 应为 `enabled: true`、`fiberPhase: active`。
4. 卡片上写「**加载失败**」→ 设置页会把坏在哪一行写出来，按这句分两种：
   - `Preset services require isolate realms: …`：预设里的服务没隔离（1.3.1 已修
     `toolResultPruner` / `workflowEngine`，`scripts/verify.mjs` 静态拦）。
   - `…: never started`：这一行是 `standard` 后来才加/改的（例如 0.2.2 起把
     subagent 工具收进 `delegation` 分组并加 `workflowEngine` 隔离），克隆体停在旧版本。
     跑 `node scripts/adapt-tools.mjs --write` 重新同步工具面 → `node scripts/verify.mjs` → 重启 App。
     （2.5.1 修的就是这一种。）
5. 都正常但还是不显示 → 多半是界面缓存，重开 App 即可。

即便预设暂时选不到，也还能用：技能已装进 `~/.dsh/skills/wpac`，
任何会话里说「用 wpac」或直接 `skill wpac` 就能加载同一套手册。

## 工具面跟着宿主走

工具行不是永久手抄的：`scripts/adapt-tools.mjs` 会从当前装的 DSH 里找到
`dsh-web-app/presets/standard.patch.yml`（装机自带的那份），把它的插件行同步进本预设，
只保留本包自己的 `wpac-persona` 注入行。

```bash
node scripts/adapt-tools.mjs            # 只报告差异（exit 1 = 有差异）
node scripts/adapt-tools.mjs --write    # 写入 cordis.patch.yml，重装后生效
```

找不到宿主时用 `DSH_ASAR` 指到 `app.asar`，或 `DSH_WEB_APP_PRESET` 直接指到那份 yml。
冒烟脚本会顺带跑一次对比，有差异直接报红。

## 冒烟（一条命令）

```bash
node scripts/smoke.mjs
```

自动断言：技能副本与源码逐字节一致、人格五条关键规则在场、追问口径三处一致
（人格 / 手册 / README）、预设声明完整、交付说明只剩「最多一行」。
行为部分宿主没有建会话的接口，脚本会打印 5 条固定委托和期望，人工过一遍即可。

## 更新后为什么要重启

预设里挂了一行 `wpac-persona → dsh-wpac/inject`，它直接引用本包。`plugin_manager` 会把这类
"预设内直接引用本包"的插件判为 unmanaged，装/卸都会回 `restart-required`。
所以：**改完重装一次 + 重启一次 App** 才保证新代码生效；只改 `persona.md` 不用——它每轮现读。

## 卸载 / 停用

```
plugin_manager  action=remove_bundle   target=dsh-wpac
```

只停用不改依赖：

```
plugin_manager  action=set_bundle  target=dsh-wpac  enabled=false
```

## 改法

| 想改什么 | 改哪里 | 注意 |
| --- | --- | --- |
| 追问规则、流程、默认值 | `persona.md` | 改完立即生效；别超过 ~3.5k 字 |
| 模板、例句、约束清单、产出前清单 | `skills/wpac/SKILL.md` | 加载才占上下文，可放心写长 |
| 加一个要素（如 E=证据） | 人格段 + 手册 + 自检表 | 三处都改，否则模型会漏 |
| 增删工具 | `plugins` 列表 | 先从 `standard` 抄；新增行先查会不会与宿主重复 |
| 改显示名/描述/排序 | `config.name` / `description` / `order` | 描述里保留作者 |

改完必须：`node scripts/verify.mjs` → **先 `remove_bundle` 再 `install_bundle`** → 新建会话验证。

> 注意：对同一个目录直接再跑 `install_bundle` 会返回 `already-installed` 且不做任何事
> （`changed:false`），磁盘上的改动不会重新载入。要更新必须按上面的两步走。
> `link:` 方式安装时文件本身是软链，技能手册立即生效；预设声明（人格段）需要这次重载。

## 验证清单（人工）

1. 新会话选 WPAC，发一句模糊需求（如"帮我写个总结"）：应先出简报 + 带选项的追问，
   而不是直接写。
2. 回答后：应给出优化后的提示词（或存到 `wpac/`），再给正文。
3. 发一句完整的委托（W/P/A/C 齐全）：仍应走完四轮（原话已给的槽用确认式问），四轮走完才出正文。
4. 说"直接来"：应跳过简报但结果不变。
5. 要求交付文件：应用对应工具生成并 `present`，末尾最多一行说明；纯正文则不加任何说明。

## 边界

- 去 AI 腔针对的是**原创内容的人类化表达**，不用于伪造他人作品、抄袭洗稿；
  评分、署名、投稿类场景会先说明能协助的范围。
- 预设不修改任何宿主行，也不改其他预设；升级 DSH 后需核对工具行是否要跟着 standard 同步。
- 技能不再用 `!!js` 解析路径，由 `scripts/install-skill.mjs` 实体安装到 `~/.dsh/skills/wpac`；
  代价是其他预设的技能清单里也会看到 `wpac`（按需加载，不占常驻上下文）。
