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
- 自动获取文章信息：题目、作者、出版时间、期刊/来源、DOI、字数与预计阅读时长、阅读时间（网页取 `citation_*` / Open Graph / JSON-LD / byline；PDF 取文档元数据 + 首页最大字号标题 + "Published:" 日期 + DOI）
- PDF 学习阅读器：扩展自动接管 `.pdf` 链接；手机端在 PDF 链接后显示 📖，点击用内置阅读器打开（基于 pdf.js，可选择文字）
- AI 接口自行配置，三种方式：
  1. **直连** OpenAI 兼容接口（OpenAI / DeepSeek / 智谱 / 通义 / Ollama …）
  2. **本机 API 跳板**（one-api / new-api / LiteLLM / 自建转发）结构化配置：跳板地址、模式（OpenAI 兼容 或 转发：上游地址放在请求头）、上游地址请求头名、跳板密钥
  3. **使用服务器端 AI**（密钥只保存在服务器）
- 服务器地址、Token、各接口路径可配置；**AI 与服务器配置支持导入 / 导出**（可选择不含密钥）
- 本地生词本始终可用；启用服务器后自动同步，失败自动排队重试

**服务器 + 网页应用**

- REST API：前端（扩展 / 脚本 / 网页）通过 Token 读写
- SQLite 存储生词本与好词好句；**同一个单词可对应多篇文章**；**不同时态/复数的同一个词合并为一条**（ran / running → run，按 ECDICT 词形表 + AI 原形）
- 生词按文章类别归类：医学、时政、金融、科学、工业、娱乐、信息技术、法律、生物学、人工智能（AI 判断，失败时关键词兜底，可手动改）
- 生词按**词根**归类（前缀 / 词根 / 后缀，带含义与来源语言）
- 网页应用：
  - 按类别、词根、文章查询生词与好词好句
  - **生词测验**：单选题（1 个正确 + 3 个干扰项），题量 20 / 50 / 80 / 100 可选，可按类别、词根筛选或只考错题集；题型随机：英译中、中译英、例句填空
  - 测验结束后**复习错题**（卡片）+ **错题再测**，自动形成**错题集**（连续答对 3 次自动“已掌握”）
  - **统计**：总体正确率、按类别、按词（错误最多）、按题型、按词根、近 30 天趋势
  - **Kokoro 离线朗读**（Kokoro-82M，服务器 CPU 推理，模型下载一次后离线使用，带缓存）
  - **阅读器**：粘贴链接（服务器抓取网页 / PDF）、本地 PDF 或粘贴文本，同样支持划词翻译、语法分析、加入生词本
  - 服务器 AI 配置（Base URL / Key / 模型，**模型列表从上游服务器拉取**）及导入导出；一键生成扩展/脚本配置文件

## 目录结构

```
shared/        核心：配置、离线词典、AI、元数据与句子提取、标注、生词本/同步、浮动 UI、设置、PDF 阅读器
extension/     MV3 扩展（background、content 平台适配、PDF viewer、options、popup、lib/pdf.js、data/词典）
userscript/    platform.user.js（GM 适配 + PDF 浮层）→ 构建出 english-reading-assistant.user.js
server/        Node.js 服务：src/(index, db, service, lexicon, tts)  public/(网页应用 + shared 副本 + 词典)
deploy/        install.sh（服务器上运行）、deploy.sh（本机一键上传安装）
tools/         build-dict.mjs（从 ECDICT 生成词典）、build.mjs（同步 shared、打包脚本与扩展）、build-safari.sh
dist/          dict.json / roots.json（油猴脚本 @resource）、扩展 zip
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

- Android：Kiwi / Edge Canary / Firefox + Tampermonkey 或 Violentmonkey
- iOS：Safari + [Userscripts](https://apps.apple.com/app/userscripts/id1463298887)
- 安装地址：`https://cdn.jsdelivr.net/gh/EuHs/english-reading-assistant@main/userscript/english-reading-assistant.user.js`
- 离线词典通过 `@resource` 首次安装时下载并缓存；也可在服务器启用后回退到服务器词典接口
- 脚本菜单：设置、生词本、打开本地 PDF、用阅读器打开 PDF 链接、同步
- 手机上没有右键：选中文字后底部弹出工具条（译 / 🔊 / 高亮 / 下划线 / 批注 / ＋生词 / ★好句 / 语法）

## 服务器

要求 Node.js ≥ 22.13（使用内置 `node:sqlite`，无需编译）。

```bash
cd server
cp .env.example .env      # 设置 API_TOKEN、AI_BASE_URL、AI_API_KEY、AI_MODEL
npm install --include=optional
npm start                  # http://localhost:8080
```

### 一键部署到云服务器

```bash
# 可选：deploy/server.env 会作为服务器的 .env（已 git-ignore）
deploy/deploy.sh root@<服务器IP> 8080
```

脚本会上传 `server/`，在服务器上安装 Node（npmmirror 镜像）、依赖、systemd 服务 `era`，并打开防火墙端口。云厂商的**安全组**需放行该端口。
日志：`journalctl -u era -f`；升级：再次运行 `deploy.sh`（保留 `data/` 与 `.env`）。

部署完成后在扩展/脚本“设置 → 服务器”填写 `http://<IP>:8080` 与 API Token 并启用；或在网页应用“设置 → 生成扩展/油猴脚本配置文件”，再到扩展里导入。

### 环境变量

| 变量 | 说明 |
|---|---|
| `API_TOKEN` | 必填。请求头 `Authorization: Bearer <token>` |
| `AI_BASE_URL` / `AI_API_KEY` / `AI_MODEL` | 上游 OpenAI 兼容接口，例如 Z.AI `https://api.z.ai/api/coding/paas/v4`；模型可在网页设置里从上游拉取 |
| `AI_EXTRA` | 合并进每次请求的 JSON，如 Z.AI 关闭思考加速：`{"thinking":{"type":"disabled"}}` |
| `ENABLE_TTS` / `KOKORO_DTYPE` / `TTS_VOICE` | Kokoro 朗读；`q8` 模型约 90 MB |
| `HF_ENDPOINT` | 模型下载镜像（国内用 `https://hf-mirror.com`） |
| `NODE_USE_ENV_PROXY=1` + `HTTPS_PROXY` | 服务器需代理访问 AI 时 |

### API

所有 `/api/*`（除 `/api/health`）需 Token。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 状态 |
| POST | `/api/words` | 加入生词（见下方字段）；按原形去重，追加出处 |
| POST | `/api/words/batch` | `{items:[...]}` 批量 |
| GET | `/api/words?q=&category=&root=&article=&sort=new\|alpha\|wrong\|freq&page=&size=` | 查询 |
| GET / PATCH / DELETE | `/api/words/:id` | 详情（含全部出处与文章）/ 修改 / 删除 |
| POST | `/api/words/:id/enrich` | AI 重新分析词根、词形、时态 |
| POST / GET / DELETE | `/api/phrases`, `/api/phrases/:id` | 好词好句 |
| GET | `/api/categories`, `/api/roots`, `/api/articles` | 类别统计、词根、文章 |
| PATCH | `/api/articles/:id` | `{category}` 手动改类别 |
| GET | `/api/dict/:word` | 离线词典 |
| POST | `/api/quiz` | `{size:20\|50\|80\|100, category, root, mode:"all"\|"wrong"}` 开始测验 |
| POST | `/api/quiz/:id/answer` | `{question_id, choice}` |
| POST | `/api/quiz/:id/finish` | 结果与错题详情 |
| GET | `/api/wrongbook`, POST `/api/wrongbook/:wordId` | 错题集 / 标记掌握 |
| GET | `/api/stats` | 统计（总体 / 类别 / 词 / 题型 / 词根 / 每日） |
| POST | `/api/ai/chat` | `{messages}` AI 代理（扩展“服务器 AI”模式） |
| GET | `/api/ai/models` | 从上游拉取模型列表 |
| GET / PUT | `/api/settings`，GET `/api/settings/export`，POST `/api/settings/import` | 服务器 AI 配置及导入导出 |
| GET | `/api/tts?text=&voice=&speed=` | Kokoro 朗读（WAV） |
| GET | `/api/fetch?url=` | 抓取网页 / PDF（网页阅读器用） |
| GET | `/api/export` | 全量数据备份 |

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
