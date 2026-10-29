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
├── cordis.patch.yml       # 唯一入口：insert 一行 preset-wpac
├── skills/wpac/SKILL.md   # 深度手册（判定表/选项库/约束清单/模板/例句/评分表）
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

1. **人格层**（`cordis.patch.yml` 的 `persona.prefix`）：常驻上下文，只放铁律与流程，
   越短越好。改流程、改默认值、改自检项，改这里。
2. **手册层**（`skills/wpac/SKILL.md`）：按需加载，放长内容。加模板、加例句、加选项库，
   改这里，不动人格。
3. **工具层**（`plugins` 列表）：决定这个预设能用哪些工具。工具面克隆自 `standard`
   （已验证可激活），宿主上已启用的插件（`univer_*`、`sd_*`、`memory`、
   `computer-use` 等）由宿主上下文继承，**不要在这里重复声明**，否则会出现重复注册。

## 安装

```bash
node scripts/verify.mjs          # 先自检
```

然后让 DSH 安装这个 bundle（绝对路径）：

```
plugin_manager  action=install_bundle  target=<本目录的绝对路径>   # 例：~/Documents/deepseek-harness/default-workspace/adapted/dsh-wpac
```

装完在新建会话的预设列表里选「WPAC · 先定义，再交付」。

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
4. 卡片上写「**加载失败**」→ 预设里的服务没有 isolate（registry 报
   `Preset services require isolate realms: …`）。1.3.1 已修 `toolResultPruner` / `workflowEngine`
   两处，`scripts/verify.mjs` 现在会静态拦住这类问题。
5. 都正常但还是不显示 → 多半是界面缓存，重开 App 即可。

即便预设暂时选不到，也还能用：技能已装进 `~/.dsh/skills/wpac`，
任何会话里说「用 wpac」或直接 `skill wpac` 就能加载同一套手册。

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
| 追问规则、流程、默认值 | `persona.prefix` | 别超过 ~3.5k 字，常驻上下文 |
| 模板、例句、约束清单、评分表 | `skills/wpac/SKILL.md` | 加载才占上下文，可放心写长 |
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
3. 发一句完整的委托（W/P/A/C 齐全）：应直接执行，不追问、不硬套简报。
4. 说"直接来"：应跳过简报但结果不变。
5. 要求交付文件：应用对应工具生成并 `present`，末尾三行内说明。

## 边界

- 去 AI 腔针对的是**原创内容的人类化表达**，不用于伪造他人作品、抄袭洗稿；
  评分、署名、投稿类场景会先说明能协助的范围。
- 预设不修改任何宿主行，也不改其他预设；升级 DSH 后本包通常无需改动。
- 技能目录通过 `!!js` 按 bundle 自身路径解析；若包名被改（`package.json` 的 `name`），
  需同步改 `cordis.patch.yml` 里的 `resolve('dsh-wpac/package.json')`。
