# 📖 English Reading Assistant 英语阅读助手

面向英语文章（网页 / PDF）精读的学习工具，包含三部分：

| 组件 | 目录 | 用途 |
|---|---|---|
| 浏览器扩展（Chrome / Edge / Safari） | `extension/` | 桌面端阅读网页与 PDF，右键菜单整合 |
| 油猴脚本（Tampermonkey / Violentmonkey / iOS Userscripts） | `userscript/` | 与扩展功能一致，主要用于手机端 |
| 服务器（API + 数据库 + 网页应用） | `server/` | 生词本 / 好词好句存储、分类、测验、错题集、统计、Kokoro 朗读 |

扩展、油猴脚本和网页应用共用同一套核心代码 `shared/`，功能保持一致。

## 功能

**阅读端（扩展 / 油猴脚本）**

- 划词翻译：单词走**离线词典**（ECDICT 5.8 万词 + 8.1 万条词形→原形映射 + 611 条官方词根词缀表），句子走 AI 翻译（结合上下文）
- 高亮（4 色）、下划线、批注；按页面 / PDF 持久保存，重新打开自动恢复
- AI 生词分析：语境释义、**词根拆分（遵循拉丁/希腊/古英语等标准词源，一个词可有多个词根）**、词形（过去式、过去分词、现在分词、第三人称单数、复数、比较级…）、**不同时态**例句、搭配
- 朗读：所有单词、例句旁都有 🔊，使用浏览器内置 TTS（可选音色、语速）
- 右键菜单（扩展）/ 工具条（手机）：
  - **加入生词本**：单词 + 词典释义 + AI 词根时态 + 所属语句 + 语句翻译 + 文章信息
  - **加入好词好句**：词 / 词组 / 句子 + 翻译 + 所属语句及翻译 + 文章信息
  - **语法分析**：划句后浮动面板，主语/谓语/宾语/定语/状语/补语/表语/同位语 **彩色高亮 + 图例**，含翻译、句型、主干、从句表、讲解
- **收藏式状态与取消**：加入生词 / 好词好句后，原文上留下专属标记——生词为**细红色波浪线**，好词好句为**细紫色双下划线**（画在文字自身的框内，不插入任何字符、不改变排版、不遮挡相邻文字；鼠标悬停时浅色高亮，可在设置 / 生词本面板 / 右键菜单 / 脚本菜单一键显示或隐藏），与高亮（底色）、下划线（实线）、批注（虚线 + ✎）区分。工具条、卡片和右键菜单按钮像浏览器收藏按钮一样显示状态：☆ 未加入 / ☆+ 已从其他文章收录（点击追加本处）/ ★ 本文已加入（点击取消）。点击原文上的标记也可取消；取消会同步删除服务器上本文的这条出处，单词不再有任何出处时整条删除
- 自动获取文章信息：题目、作者、出版时间、期刊/来源、DOI、字数与预计阅读时长、阅读时间（网页取 `citation_*` / Open Graph / JSON-LD / byline；PDF 取文档元数据 + 首页最大字号标题 + "Published:" 日期 + DOI）
- PDF 学习阅读器：扩展自动接管 `.pdf` 链接；手机端在 PDF 链接后显示 📖，点击用内置阅读器打开（基于 pdf.js，可选择文字）
- 浮动卡片（词典 / 翻译 / 生词 / 语法）：按住标题栏拖动（鼠标、手指、触控笔都可以）；打开时完整显示在屏幕内，内容变长也不会超出屏幕，太长时卡片内滚动。手机上卡片是底部面板，上下拖动标题栏调整高度
- **AI 功能自动 / 手动**（设置 → AI 功能）：
  - 自动：查词时自动给出语境释义，划句自动 AI 翻译，加入生词本 / 好词好句时自动分析和翻译（可分别关闭）
  - 手动：不主动调用 AI；卡片上显示「AI 语境翻译」「AI 翻译」「AI 词根/时态分析」「AI 翻译例句」等按钮，点了才调用，结果会补进已保存的生词 / 好词好句（服务器端的词根整理仍由服务器自己的 AI 设置决定）
- AI 接口自行配置，三种方式：
  1. **直连** OpenAI 兼容接口（OpenAI / DeepSeek / 智谱 / 通义 / Ollama …）
  2. **本机 API 跳板**（one-api / new-api / LiteLLM / 自建转发）结构化配置：跳板地址、模式（OpenAI 兼容 或 转发：上游地址放在请求头）、上游地址请求头名、跳板密钥
  3. **使用服务器端 AI**（密钥只保存在服务器）；服务器同样可以直连或经过跳板，结构化配置与扩展相同
- **通用请求参数**（扩展、脚本、服务器相同）：温度、top_p、最大输出 tokens、**思考强度**（关闭 / minimal / low / medium / high / xhigh / max，或供应商要求的其他值）、自定义参数 JSON（最后合并，可覆盖任何字段）。留空 = 不发送，用模型默认
  - 思考强度按供应商的写法发送，默认按接口地址和模型名自动判断，也可手动选：`reasoning_effort`（OpenAI 标准：OpenAI、Gemini、Groq、xAI、Ollama…）、`thinking` + `reasoning_effort`（智谱 GLM）、`thinking` 开关（豆包等）、`enable_thinking`（通义千问 DashScope、硅基流动）、`reasoning` 对象（OpenRouter）
  - **从供应商拉取参数结构**：「拉取模型」时读取 `/models` 里的参数信息（OpenRouter 等提供：支持哪些参数、思考强度可选值、能否关闭思考、默认参数、最大输出），显示在设置里，思考强度只列出可选值，模型不支持的温度 / top_p / max_tokens 不发送。多数供应商只给模型名，此时靠下一条
  - **按报错自动适配**：供应商以 400 拒绝某个参数时（例如 GLM-5.3 不能关闭思考：`please use low, high, or max`），自动改成报错里列出的最接近的值或去掉该参数后重试，并提示；同一设置之后不再先失败。设置里的「测试」会把需要的调整直接填回表单
- 服务器地址、Token、各接口路径可配置；**AI 与服务器配置支持导入 / 导出**（可选择不含密钥）
- **浏览器里的生词本只看这篇文章**：页面上的「本文生词本」（扩展弹窗、脚本菜单「📒 本文生词本」、PDF 阅读器）只列当前文章里标记的生词和好词好句，配例句，方便边读边复习；点面板外面即可关闭；× 只取消本文的这一条（和点 ★ 取消一样），不影响其他文章。**复习全部生词请到服务器网页**。扩展设置里的「生词本」页是本机保存过的全部记录（导出 / 备份 / 上传用），在那里删除会删掉该词在本机和服务器上的全部记录（会先确认）
- 本地记录始终可用；启用服务器后自动上传，失败自动排队重试。「上传到服务器」会先处理待上传的修改，再把本机全部生词和好词好句上传（包括连接服务器之前加的），服务器按原形和例句合并，不会重复。服务器上的内容不会下载回浏览器
- 升级扩展 / 脚本时**不要先删除旧的**：直接覆盖扩展文件夹后在扩展管理页点刷新；油猴脚本直接重新安装覆盖。删除扩展或脚本会清空它在本机保存的标记和生词（服务器上的不受影响）

**服务器 + 网页应用**

- REST API：扩展 / 油猴脚本用 API Token 读写；网页应用用管理员账号登录（默认 `admin` / `123456`，首次登录必须改密码）
- SQLite 存储生词本与好词好句；**同一个单词可对应多篇文章**；**不同时态/复数的同一个词合并为一条**（ran / running → run，按 ECDICT 词形表 + AI 原形）
- 生词按文章类别归类：医学、时政、金融、科学、工业、娱乐、信息技术、法律、生物学、人工智能（AI 判断，失败时关键词兜底，可手动改）
- 生词按**词根**归类（前缀 / 词根 / 后缀，带含义与来源语言）
- 网页应用：
  - 按类别、词根、文章查询生词与好词好句
  - **生词测验**：单选题（1 个正确 + 3 个干扰项），题量 20 / 50 / 80 / 100 可选，可按类别、词根筛选或只考错题集；题型可选（见下）
  - **题型可多选**：单词填空（例句挖空选词）、句中词义（选单词在这句话里的意思）、看中文选单词、看单词选中文；按所选题型平均出题，需要例句的题型只出给有例句的生词
  - 干扰项不会和正确答案意思相同：中文释义相同或高度相似（如「不情愿」与「不愿意」）、或 AI 分析列为近义词的词都会排除，避免一题两个正确选项
  - 测验结束后**复习错题**（卡片）+ **错题再测**，自动形成**错题集**（连续答对 3 次自动“已掌握”）
  - **统计**：总体正确率、按类别、按词（错误最多）、按题型、按词根、近 30 天趋势
  - **Kokoro 离线朗读**（Kokoro-82M，服务器 CPU 推理，模型下载一次后离线使用，带缓存）
  - **阅读器**：粘贴链接（服务器抓取网页 / PDF）、本地 PDF 或粘贴文本，同样支持划词翻译、语法分析、加入生词本
  - 服务器 AI 配置（直连或跳板、Base URL / Key / 模型、通用请求参数，**模型列表与参数信息从上游拉取**）及导入导出；一键生成扩展/脚本配置文件

## 目录结构

```
shared/        核心：配置、离线词典、AI、元数据与句子提取、标注、生词本/同步、浮动 UI、设置、PDF 阅读器
extension/     MV3 扩展（background、content 平台适配、PDF viewer、options、popup、lib/pdf.js、data/词典）
userscript/    platform.user.js（GM 适配 + PDF 浮层 + 悬浮菜单）→ 构建出 english-reading-assistant.user.js 与 .ios.user.js
server/        Node.js 服务：src/(index, db, service, lexicon, tts)  public/(网页应用 + shared 副本 + 词典)
deploy/        install.sh（服务器上运行）、deploy.sh（本机一键上传安装）
tools/         build-dict.mjs（从 ECDICT 生成词典）、build.mjs（同步 shared、打包脚本与扩展）、build-safari.sh
dist/          dict.json / roots.json（油猴脚本运行时下载）、扩展 zip
```

修改 `shared/` 或 `userscript/platform.user.js` 后运行 `node tools/build.mjs`。

## 安装

### Chrome / Edge

1. `node tools/build.mjs`（仓库已包含构建结果，可跳过）
2. 打开 `chrome://extensions`（Edge：`edge://extensions`）→ 开启“开发者模式” → “加载已解压的扩展程序” → 选择 `extension/` 目录
3. 打开本地 PDF：在扩展详情里开启“允许访问文件网址”，或在弹窗点“打开本地 PDF”

### Safari（macOS / iOS）

```bash
sudo xcodebuild -runFirstLaunch   # 仅首次
tools/build-safari.sh
```

用 Xcode 打开生成的 `safari/` 工程运行，然后在 Safari 设置 → 扩展中启用（本地构建需在“开发”菜单允许未签名扩展）。

### 油猴脚本（手机 / 桌面）

- Android / 桌面：Tampermonkey 或 Violentmonkey（Android 用 Kiwi / Edge Canary / Firefox），安装
  `https://cdn.jsdelivr.net/gh/EuHs/english-reading-assistant@main/userscript/english-reading-assistant.user.js`
- iPhone / iPad：Safari + [Userscripts](https://apps.apple.com/app/userscripts/id1463298887)，安装 **iOS 专用版**
  `https://cdn.jsdelivr.net/gh/EuHs/english-reading-assistant@main/userscript/english-reading-assistant.ios.user.js`
  - Userscripts 不支持 `@resource`、脚本菜单和 `GM_getValue`，所以 iOS 版去掉了这些声明，否则安装会出错
  - 先在 设置 → App → Safari → 扩展 里启用 Userscripts，并允许“所有网站”；Safari 打开上面的地址后，点地址栏的 “大小”(aA) 菜单 → Userscripts → 安装
  - iOS 上用 Tampermonkey App 也可以安装上面的完整版
- **jsDelivr 打不开时**（中国大陆常见）：部署服务器后从服务器安装，
  `http://<服务器IP>:8080/userscript/english-reading-assistant.ios.user.js`（完整版去掉 `.ios`），网页应用“设置”页也有这两个链接
- 脚本不依赖 `@require` / `@resource`（这些 CDN 下载失败时管理器往往不报错，脚本却缺文件）：
  - pdf.js 打包在脚本里；约 1 MB 的 PDF 解析组件在第一次打开 PDF 时下载，依次尝试：你的服务器 → npmmirror → jsDelivr → unpkg。页面禁止 Worker 时自动改在主线程解析
  - 离线词典（约 7 MB）：启用服务器时直接用服务器逐词查询，不下载；否则在第一次查词时下载（依次尝试你的服务器 → 国内可用的 jsDelivr 镜像 cdn.jsdmirror.com → jsDelivr 的几个节点）。
    第三方镜像下载的文件必须与构建时记录的 SHA-256 一致才会使用；PDF 解析组件是代码，不论来自哪里都校验 SHA-256。
    iOS Userscripts 下载一次后保存在本机，换页面、重开 Safari 都不再下载；Tampermonkey / Violentmonkey 会把脚本存储的全部数据注入每个页面，所以只在当前页面内存里保留。
    下载失败后 30 分钟内不再重试（下载地址变化时例外，例如刚启用服务器），菜单「📥 下载离线词典」可立即重试
- 从服务器安装的脚本，更新地址会自动指向你的服务器（`/userscript/…`），不依赖 jsDelivr
- 脚本菜单：设置、生词本、打开本地 PDF、用阅读器打开 PDF 链接、显示/隐藏标记、同步
- 悬浮按钮「英」：手机上（以及管理器没有脚本菜单时）显示在屏幕右侧，点开就是上面的菜单；上下拖动可移开，位置会记住。可在 设置 → 悬浮菜单按钮 中改为总是显示 / 不显示
- 手机上没有右键：选中文字后底部弹出工具条（译 / 🔊 / 高亮 / 下划线 / 批注 / ＋生词 / ★好句 / 语法）

## 服务器

要求 Node.js ≥ 22.13（使用内置 `node:sqlite`，无需编译）。

```bash
cd server
cp .env.example .env      # 设置 API_TOKEN、AI_BASE_URL、AI_API_KEY、AI_MODEL
ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm install --include=optional
npm start                  # http://localhost:8080
```

`ONNXRUNTIME_NODE_INSTALL_CUDA=skip`：Kokoro 朗读依赖的 onnxruntime-node 在 Linux x64 上默认会从 GitHub 下载 225 MB 的 CUDA（GPU）库，且没有超时，国内服务器上会一直卡住；Kokoro 只用 CPU，CPU 版的库已包含在 npm 包里，不需要这一步。

### 一键部署到云服务器

```bash
# 可选：deploy/server.env 会作为服务器的 .env（已 git-ignore）
deploy/deploy.sh root@<服务器IP> 8080      # 用 ubuntu 等普通账号登录也可以，会用 sudo 安装
```

脚本会上传 `server/`，在服务器上安装 Node（npmmirror 镜像）、依赖、systemd 服务 `era`，并打开防火墙端口。云厂商的**安全组**需放行该端口。
日志：`journalctl -u era -f`；升级：再次运行 `deploy.sh`（保留 `data/` 与 `.env`）。

### 在服务器上从 GitHub 拉取安装

```bash
sudo apt-get install -y git || sudo yum install -y git
git clone https://github.com/EuHs/english-reading-assistant.git ~/era-src
cd ~/era-src && sudo env PORT=8080 AI_API_KEY=你的key bash deploy/install.sh
# 升级：cd ~/era-src && git pull && sudo env PORT=8080 bash deploy/install.sh
```

安装需要 root（root 登录可省略 `sudo`）。开头一行显示正在安装的版本，如 `English Reading Assistant server v1.4.2 (git 1a2b3c4 2026-10-29)`，可以确认 `git pull` 是否生效。
安装分 5 步：Node.js → 程序文件（`/opt/era`）→ npm 依赖 → systemd 服务 → 防火墙。第 3 步从 npmmirror 下载约 150 MB，通常几分钟，期间每 30 秒显示一次进度：已下载的大小，以及正在运行哪个包的安装脚本——卡住时据此就能看出卡在哪个包。
超过 20 分钟（`NPM_TIMEOUT`，秒）会停止 npm 及其安装脚本，改为不装可选的 Kokoro 朗读依赖，服务器照常可用，网页朗读改用浏览器语音；按 Ctrl+C 也会把它们一起停掉。
v1.4.0 及更早的 `install.sh` 第 3 步显示 `npm install`（新版显示 `npm packages`），在 x86 服务器上会卡住（原因见上方 `ONNXRUNTIME_NODE_INSTALL_CUDA`）：按 Ctrl+C 结束，`git pull` 后重新运行即可，不用清理。

部署完成后用浏览器打开 `http://<IP>:8080`，用 `admin` / `123456` 登录，按提示设置新密码（账号名也可以改；之后在“设置 → 管理员账号”里修改）。
扩展 / 油猴脚本不用账号密码，而是用 API Token：网页应用“设置 → 扩展 / 油猴脚本连接”里可以查看、复制 Token，也可以自己输入新 Token 保存（12–128 位）或随机生成，把服务器地址和 Token 填到扩展/脚本的“设置 → 服务器”并启用；或在同一处生成配置文件，再到扩展里导入。换了 Token 后旧 Token 立即失效。网页的脚本和样式带版本号、每次打开都会检查更新，升级服务器后刷新一次页面即可用上新版。

### 环境变量

| 变量 | 说明 |
|---|---|
| `API_TOKEN` | 扩展 / 脚本的初始 Token，请求头 `Authorization: Bearer <token>`；在网页设置里重新生成后以数据库中的为准 |
| `ADMIN_USER` / `ADMIN_PASSWORD` | 网页管理员的初始账号密码，仅首次启动时写入；默认 `admin` / `123456`，用默认密码登录后必须先改密码 |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | 上游 OpenAI 兼容接口，例如 Z.AI `https://api.z.ai/api/coding/paas/v4`；模型可在网页设置里从上游拉取 |
| `AI_TYPE` / `AI_RELAY_URL` / `AI_RELAY_MODE` / `AI_RELAY_TARGET_HEADER` / `AI_RELAY_KEY` | `AI_TYPE=relay` 时经过跳板：`openai` 模式请求跳板的 `/chat/completions`（有跳板密钥时代替 API Key）；`forward` 模式 POST 到跳板，上游地址放在 `AI_RELAY_TARGET_HEADER`（默认 `X-Target-URL`），跳板密钥放在 `X-Relay-Key`。网页设置里可改 |
| `AI_HEADERS` | 附加请求头 JSON，如 `{"X-Channel":"zhipu"}` |
| `AI_TEMPERATURE` / `AI_TOP_P` / `AI_MAX_TOKENS` | 通用请求参数，留空不发送（默认温度 0.2） |
| `AI_REASONING` / `AI_REASONING_FORMAT` | 思考强度（`off` / `low` / … / `max`，留空不发送）及写法（默认 `auto`），见上文“通用请求参数”；`off` 回答最快，不能关闭思考的模型会自动改用最低档 |
| `AI_EXTRA` | 合并进每次请求的 JSON（最后合并，可覆盖上面各项）。1.5 及以前的默认值 `{"thinking":{"type":"disabled"}}` 升级时会自动改成 `AI_REASONING=off` |
| `ENABLE_TTS` / `KOKORO_DTYPE` / `TTS_VOICE` | Kokoro 朗读；`q8` 模型约 90 MB |
| `HF_ENDPOINT` | 模型下载镜像（国内用 `https://hf-mirror.com`） |
| `NODE_USE_ENV_PROXY=1` + `HTTPS_PROXY` | 服务器需代理访问 AI 时 |

### API

除 `/api/health` 和 `/api/auth/login` 外，所有 `/api/*` 需要 `Authorization: Bearer <API Token>`（扩展 / 脚本）或登录后的会话 Token（网页应用）。服务器设置、配置导入导出、数据备份和 API Token 只对网页上登录的管理员开放；仍在用默认密码时，管理员会话只能改密码。同一地址 10 次密码错误后锁定 15 分钟。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 状态 |
| POST | `/api/auth/login` | `{username, password}` → `{token, user, mustChange}`，会话 30 天 |
| GET / POST | `/api/auth/me`，`/api/auth/logout` | 当前账号 / 退出登录 |
| POST | `/api/auth/password` | `{current, password, username?}` 改密码（及账号名），其他会话随之失效 |
| GET / POST / PUT | `/api/settings/api-token` | 查看 / 随机生成 / 设为 `{token}`（12–128 位）扩展用的 API Token（管理员） |
| POST | `/api/words` | 加入生词（见下方字段）；按原形去重，追加出处 |
| POST | `/api/words/batch` | `{items:[...]}` 批量 |
| DELETE | `/api/words?lemma=&article_url=` | 取消生词：带 `article_url` 只删本文出处，无出处时删整条 |
| POST | `/api/book/status` | `{words:[], phrases:[], article_url}` → 每项 `none` / `other` / `here` |
| GET | `/api/words?q=&category=&root=&article=&sort=new\|alpha\|wrong\|freq&page=&size=` | 查询 |
| GET / PATCH / DELETE | `/api/words/:id` | 详情（含全部出处与文章）/ 修改 / 删除 |
| POST | `/api/words/:id/enrich` | AI 重新分析词根、词形、时态 |
| POST / GET / DELETE | `/api/phrases`, `/api/phrases/:id` | 好词好句 |
| DELETE | `/api/phrases?text=&article_url=` | 取消好词好句（同上规则） |
| GET | `/api/categories`, `/api/roots`, `/api/articles` | 类别统计、词根、文章 |
| PATCH | `/api/articles/:id` | `{category}` 手动改类别 |
| GET | `/api/dict/:word` | 离线词典 |
| POST | `/api/quiz` | `{size:20\|50\|80\|100, category, root, mode:"all"\|"wrong", types:["cloze","ctx","zh2en","en2zh"]}` 开始测验（types 不填为全部题型） |
| POST | `/api/quiz/:id/answer` | `{question_id, choice}` |
| POST | `/api/quiz/:id/finish` | 结果与错题详情 |
| GET | `/api/wrongbook`, POST `/api/wrongbook/:wordId` | 错题集 / 标记掌握 |
| GET | `/api/stats` | 统计（总体 / 类别 / 词 / 题型 / 词根 / 每日） |
| POST | `/api/ai/chat` | `{messages, model?, fresh?}` AI 代理（扩展“服务器 AI”模式）→ `{content, notes}`，`notes` 为按供应商报错做的参数调整；`fresh` 不用已记住的调整（测试用） |
| GET | `/api/ai/models` | 从上游拉取模型列表 → `{models, info}`，`info` 为供应商提供的各模型参数信息 |
| GET / PUT | `/api/settings`，GET `/api/settings/export`，POST `/api/settings/import` | 服务器 AI 配置及导入导出（管理员） |
| GET | `/api/tts?text=&voice=&speed=` | Kokoro 朗读（WAV） |
| GET | `/api/fetch?url=` | 抓取网页 / PDF（网页阅读器用） |
| GET | `/api/export` | 全量数据备份（管理员） |

`POST /api/words` 字段：

```json
{
  "word": "ran", "lemma": "run", "phonetic": "rʌn", "pos": "v.",
  "translation": "词典释义", "meaning": "语境释义",
  "morphology": [{"part": "re-", "type": "prefix", "meaning": "回", "origin": "Latin"}],
  "roots": ["spect"], "forms": {"past": "ran"}, "tenses": [{"name": "一般过去时", "form": "ran", "example": "..."}],
  "sentence": "所属语句", "sentence_translation": "语句翻译",
  "article": {"url": "", "title": "", "author": "", "published_at": "", "site": "", "journal": "", "doi": "",
              "word_count": 0, "reading_minutes": 0, "read_at": "ISO 时间", "category": "医学"}
}
```

### 配置文件格式

扩展 / 脚本导出（`type: era-config`）：

```json
{
  "type": "era-config",
  "ai": {"active": "relay", "profiles": [{
    "id": "relay", "name": "本机跳板", "type": "relay",
    "baseUrl": "https://api.deepseek.com/v1", "apiKey": "sk-...", "model": "deepseek-chat",
    "relay": {"url": "http://127.0.0.1:3000/v1", "mode": "openai", "targetHeader": "X-Target-URL", "relayKey": ""}
  }]},
  "server": {"enabled": true, "baseUrl": "http://1.2.3.4:8080", "apiToken": "...",
             "endpoints": {"health": "/api/health", "words": "/api/words", "phrases": "/api/phrases", "aiChat": "/api/ai/chat", "dict": "/api/dict"}}
}
```

跳板 `mode: "forward"` 时，请求 POST 到 `relay.url`，真实上游地址放在 `targetHeader` 指定的请求头里（适合自写的简单转发器）。

## 致谢

- [ECDICT](https://github.com/skywind3000/ECDICT)（MIT）：离线词典、词形表、词根表
- [pdf.js](https://github.com/mozilla/pdf.js)（Apache-2.0）
- [kokoro-js](https://github.com/hexgrad/kokoro) / Kokoro-82M（Apache-2.0）

## License

MIT
