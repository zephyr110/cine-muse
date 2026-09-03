# 新建项目「对话式向导」设计（聊天壳）

日期：2026-09-03（v0.1）
状态：讨论稿（未编码）

## 0. 修订记录

v0.1（本版）：产品讨论定稿——「方案 1 全页聊天 + 简报摘要卡」；选项 chips 内嵌系统消息气泡底部（非输入框上方）；输入框支持自由文本（枚举题别名归一匹配，不产生自定义值）。

## 1. 背景与问题

新建项目目前是 **5 步结构化向导**（`new-project-wizard.tsx`：创意 → 风格 → 规格 → 模板 → 干预与资产），一次面对多个专家化参数（模板拓扑、干预深度 L0–L3、增强环节、资产绑定），认知负担集中、缺少"向智能体团队下 brief"的对话感。

**改造目标**：把步骤式交互改为**聊天对话框式**——assistant 一次只问一个问题、选项以可点击 chips 内嵌在提问消息中、同时支持输入框自由输入；同一时刻只面对一个决策点。**约束：不改数据模型**（`NewProjectInput` 字段一项不丢，`CREATE_PROJECT` dispatch 不变，reducer/engine/类型零改动，纯前端重构）。

**已排除方向**：
- 真·自然语言解析（自由文本 → LLM 抽取字段）：代码库目前无任何真实 LLM 集成（引擎全模拟，模型设置仅为 UI 配置），引入解析层需新依赖与密钥，成本高 → 列为后续升级点，本期不做（YAGNI）
- 左聊右表单双栏：等于保留表单本体，聊天沦为装饰

## 2. 交互设计

### 2.1 页面结构与对话流程

单页替换 Wizard 内容（`/projects/new` 页面，三个入口——site-header / app-sidebar / dashboard 空态——均指向该路由，全部兼容，无需改动）：

- 顶部常驻**「成片简报」悬浮摘要卡**：实时镜像全部字段 + 完成进度（已答/应答，分母随模板自适应：full=11、quick=10），承接原底部实时摘要条角色
- 中部消息流：assistant 提问气泡与用户回答气泡交替；自动滚底
- 底部固定输入栏：纯输入框（h-9）+ 发送按钮；Enter 发送，**IME 组合态不触发**（中文输入法回车安全，isComposing 守卫）
- 全部问题走完 → assistant 发「就绪卡」（全量回显 + 创建并启动按钮，沿用现有 in-flight 防重复提交）

**问题序列（11 问，与现有字段一一对应）**：

| # | 提问 | 回答通道 | 选项来源 |
|---|---|---|---|
| 1 | 项目标题 | 输入框 | —（任意文本，trim） |
| 2 | 一句话创意 | 输入框 | —（≥6 字，不足气泡内联报错） |
| 3 | 题材 | chips | `GENRE_LIBRARY` keys |
| 4 | 视觉风格 | 卡片组（含渐变色块预览） | `STYLE_LIBRARY` keys + 渐变描述 |
| 5 | 时长 | chips（首项「推荐 2 分钟」） | 30/60/90/120/180/240s |
| 6 | 画幅 | chips | 16:9 / 9:16 / 1:1 |
| 7 | 画质 | chips（标准·推荐） | draft / standard / hd |
| 8 | 工作流模板 | 模板卡（完整流水线·推荐 / 快速预览） | `TEMPLATES` |
| 8b | 增强环节（仅模板=full 时） | 模板答后紧随的下一问（行）复选 chips | `BOOST_SLOTS`（full 默认含 previs） |
| 9 | 干预模式 | 模式卡（引导式·推荐） | `MODES` 四档 |
| 10 | 绑定资产 | 分类分组资产 chips + 「暂不绑定，跳过」 | `state.assets`；资产库为空时气泡自动提示并跳过 |
| 11 | 就绪卡 | — | 全量回显 + 创建并启动 |

- 每题一个动作点：选项题带「推荐」优先 chip/卡，熟练用户连点推荐 ~30s 到达就绪卡
- 同一决策的连锁项（模板 → 增强环节）以**紧随的下一问（行）**呈现，不新增额外层级

### 2.2 气泡变体

- `text-ask`：纯问题（标题/创意）
- `chips-ask`（单选）：问题 + 气泡底部内嵌选项 chips；**点选即提交**并进入下一问（题材/时长/画幅/画质）
- `chips-ask`（多选）：选项 chips 可多选，气泡内提供「继续」动作点，全部点完才推进（8b 增强环节、10 资产绑定；资产题含「暂不绑定，跳过」单点即推进）
- `cards-ask`：问题 + 卡片组（风格/模板/模式，带渐变色块或图标；单选，点选即推进）
- `text-answer`：用户气泡（右对齐主题色）
- `system-note`：辅助信息（如「没找到『xx』」「资产库为空」）
- `ready`：就绪卡（回显 + CTA）

### 2.3 回改（修改机制）

- 每个用户回答气泡悬停出现「修改」入口
- 点击：滚动回该题气泡 → 重新激活其选项/输入；改完值直接更新 form state
- **数据源唯一**（form state 为单一事实源，气泡仅是渲染）：下游回答气泡与摘要卡随 state 联动，无需"重问链"，已答问题不回滚

## 3. 自由文本规则（输入框行为）

| 题 | 处理 |
|---|---|
| 标题/创意 | 任意文本；trim；创意 <6 字 → 气泡内联报错（不弹 toast 打断流） |
| 枚举题（题材/风格/时长/画幅/画质/模板/模式/资产） | 别名归一匹配（「竖屏」→9:16、「两分钟/2min/120秒」→2 分钟、「4k」→高清、题材/风格关键词包含匹配等）→ 命中即视为点选该 chip；未命中 → system-note「没找到『xx』，点下面选项试试」并保留输入内容供修改，**不产生自定义值**（枚举字段保持 chips-only 语义，数据模型不变） |

归一匹配抽成纯函数 `matchOption(text, options)`（别名与可检索文本内嵌于选项的 `OptionLike`，见 `src/lib/option-match.ts`），供组件与测试共用。

## 4. 状态与结构

- form state 完整平移自现有 Wizard（title/premise/genre/style/durationSec/aspectRatio/quality/template/interventionMode/assetIds/boostAgentIds 及模板切换时 previs 增强项联动逻辑）
- `CREATE_PROJECT` dispatch、`router.push("/dashboard")`、in-flight 防抖不变
- 常量（`STYLES` 渐变表、`DURATIONS`、`QUALITY_ITEMS`、`TEMPLATES`、`MODES`、`STEPS` 删除）从 wizard 文件抽出到独立配置模块（如 `src/components/projects/new-project-config.tsx`），chat 组件引用——保持"模板库派生、不双份维护"的既有约定
- 文件变更：
  - 新增 `src/components/projects/new-project-chat.tsx`（主组件：消息状态机 + 气泡渲染 + 输入栏 + 摘要卡）
  - 新增 `src/components/projects/new-project-config.tsx`（常量迁移）
  - 新增 `src/lib/option-match.ts`（matchOption 纯函数 + 别名表）
  - 新增 `src/lib/option-match.test.ts`（vitest）
  - 删除 `src/components/projects/new-project-wizard.tsx`
  - 修改 `src/app/projects/new/page.tsx`（换组件）
- reducer/engine/types/seed 零改动

## 5. 视觉（对齐 shadcn/现有风格）

- 容器沿用 max-w-3xl；消息区独立滚动；输入栏 sticky 底部
- assistant 气泡左对齐 + 头像（Sparkles/品牌图标）；用户气泡右对齐 `bg-primary text-primary-foreground`，气泡圆角 token 化（assistant `rounded-lg`、用户右收角 `rounded-r-md`）
- 选项 chips 用 outline 变体（选中态即提交进入下一问）；卡片组沿用现 Wizard 的选择卡样式（border-primary + ring 选中态）
- 摘要卡 `bg-card border rounded-lg`，字段值实时更新；进度 n/11 弱化展示
- 动画：气泡入场轻量 fade/slide（参照现 Card 的 `animate-in` 惯例）；无障碍：消息区 `aria-live="polite"` 播报新提问

## 6. 边界与错误处理

- 非法输入（创意过短、时长越界）：气泡内联提示，不打断流、不弹 toast
- 重复提交：沿用 submitting 防抖
- 页面刷新：纯前端 state，与现 Wizard 行为一致（重新开始），无持久化要求
- 移动端：chips 自动换行，气泡宽度自适应

## 7. 测试

- `option-match.test.ts`：别名归一（竖屏/两分钟/4k/包含匹配）、未命中返回 null、空串
- 组件级人工验收清单（见 §8）；不新增 reducer 测试（引擎零改动）

## 8. 验收清单

- [ ] `/projects/new` 三入口进入均为对话式界面
- [ ] 11 问完整走完可创建项目，落库字段与现 Wizard 一致（控制变量对比同一输入）
- [ ] 枚举题输入框别名归一生效；未命中给出 system-note 且不产生自定义值
- [ ] 模板=full 时出现「增强环节」一问（预选空间预演台，可多选/继续/跳过）；切 quick 时该问消失且移除 previs 增强（原联动逻辑保留）
- [ ] 修改任意已回答气泡 → 摘要卡与下游联动更新；不产生重问链
- [ ] 输入框 IME 组合态回车不发送
- [ ] 资产库为空时第 10 问自动提示跳过
- [ ] 创意 <6 字气泡内联报错；标题为空不可进入下一问
- [ ] 就绪卡创建后跳转 dashboard；双击不重复建项目
- [ ] 原 `new-project-wizard.tsx` 删除无残留引用

## 9. 本期不做（YAGNI）

- 真·LLM 自由文本解析（后续接真实模型时升级点：仅需在 chat 组件加解析层，字段/气泡架构不变）
- 对话记忆/偏好复用（多轮快速起片）
- 历史项目「对话改写」入口
