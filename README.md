# 在平行时空再见

人与人之间的相遇像是一场盛大的别离。本项目用网页呈现一个「平行时空」的群聊：可**观**（只读）或**改**（登录后以某一成员身份参与聊天）。对话与回复节奏由 AI 模拟（后续可接入基于真实聊天记录训练的模型）。

## 每个角色的用户名与密码在哪里提前设置

每个角色都有**独立的用户名和密码**，需在服务端提前配置，有两种方式：

### 方式一：本地 / 自建服务器——用 JSON 文件（推荐）

1. 复制示例文件并改名为 `credentials.json`（不提交到 Git，已加入 .gitignore）：
   ```bash
   cp credentials.example.json credentials.json
   ```
2. 编辑 `credentials.json`，把每个用户名对应的值改成该角色的密码，例如：
   ```json
   {
     "Cheng": "仅该角色知道的密码",
     "Xian": "另一个密码",
     "Wang": "第三个密码",
     ...
   }
   ```
3. 将 `credentials.json` 放在**项目根目录**或 **server 目录**下均可，程序会自动读取。

**用户名**必须与 `server/members.js` 里的成员名称一致（当前为 Cheng, Xian, Wang, Lin, Gao, Sev, Wu, Evelyn, Morty, Chen, Kang, Zhang, Bao）。若你改了成员名，这里也要同步。**未配置时，所有成员默认密码为 123456。**

### 方式二：Render 部署——用环境变量

在 Render 的 Web Service 里添加环境变量：

- **Key**: `LOGIN_CREDENTIALS`
- **Value**: 上述 JSON 的**整段字符串**（一行），例如：
  ```text
  {"Cheng":"密码1","Xian":"密码2","Wang":"密码3","Lin":"密码4","Gao":"密码5","Sev":"密码6","Wu":"密码7","Evelyn":"密码8","Morty":"密码9","Chen":"密码10","Kang":"密码11","Zhang":"密码12","Bao":"密码13"}
  ```

未配置任一方式时，所有成员使用默认密码 **123456**。登录后可在「编辑资料」中修改自己的密码（写入 `data/passwords.json`）。

---

## 群成员头像

聊天里会显示每个人的头像，有两种方式设置：

### 方式一：直接放图片到文件夹（推荐，避免上传 404）

把头像图片放进项目的 **`public/avatars/`** 文件夹，按**成员 ID** 命名即可：

| 文件名 | 对应成员 |
|--------|----------|
| member_1.jpg | 复制粘贴吧黄牌 |
| member_2.jpg | 离离原上草 |
| member_3.jpg | 群之共主 |
| member_4.jpg | L.ing |
| member_5.jpg | 话痨用户 |
| member_6.jpg | 小七 |
| member_7.jpg | 伍子軒 |
| member_8.jpg | Looking up at the starry sky |
| member_9.jpg | 小可 |
| member_10.jpg | 石墨烯 |
| member_11.jpg | 小米康 |
| member_12.jpg | Tree (Zhang) |
| member_13.jpg | 烟火° (Bao) |

支持 `.jpg` / `.jpeg` / `.png` / `.gif` / `.webp`。放好后刷新网页即可，无需上传接口。

更详细的说明见 **`public/avatars/头像说明.txt`**。

### 方式二：登录后编辑自己的头像与人物小传

进入**改**模式并登录后，在聊天页右上角点击 **「编辑资料」**，可上传自己的头像、填写**人物小传**。保存后，在观/改任意聊天中点击**任意成员头像**即可查看该成员的人物小传（未填写则显示「暂无人物小传」）。

---

## 本地运行 / 怎么打开页面

在项目目录执行：

```bash
cd MeetParallel
npm install
npm start
```

然后在浏览器打开 **http://localhost:3000** 即可。无需先配置 `credentials.json`（成员默认密码 123456）。

---

## 部署到 Render

1. **把代码推到 GitHub**（你已推送到 `Ccwevelyn/Meet-parallel`）。
2. 打开 [Render](https://render.com) → 登录 → **New** → **Web Service**。
3. **Connect repository**：选 GitHub 里的 `Meet-parallel`，分支选 `main`。
4. Render 会自动识别 Node：
   - **Build Command**：`npm install`（默认即可）
   - **Start Command**：`npm start`（默认即可）
   - **Plan** 选 Free。
5. **Environment** 里添加环境变量（按需）：

   | Key | 说明 | 必填 |
   |-----|------|------|
   | `LOGIN_CREDENTIALS` | 成员密码 JSON 字符串，见上文「方式二」 | 否，不设则默认 123456 |
   | `ADMIN_PASSWORD` | 管理员 admin 的密码，默认 `Cc921` | 否 |
   | `AI_API_KEY` | 接 AI 时的 API 密钥（DeepSeek/智谱等，也兼容 `OPENAI_API_KEY`） | 否 |
   | `AI_BASE_URL` | 接口地址（如 `https://api.deepseek.com/v1`） | 否 |
   | `AI_MODEL` | 模型名（如 `deepseek-chat`） | 否 |

   Render 会自动注入 `PORT`，无需自己设。

6. 点 **Create Web Service**，等构建和部署完成，用生成的 **URL**（如 `https://xxx.onrender.com`）访问即可。

**说明**：Render 免费实例的磁盘是临时的，重启或重新部署后 `data/`（人设、采集记录、修改的密码等）会清空，如需持久化可之后用 Render Disk 或数据库。

---

## 接 AI 自主聊天（让 AI 学各成员说话方式）

要让群聊里的 AI **按每个人的说话方式自主聊天**，需要：

1. **先有人设**：用「采集语气」让成员和页面里的假 AI 聊约 10 分钟，或导入聊天记录，生成 `data/personas.json`（每人有样本句子和活跃时段）。
2. **配置大模型 API**：
   - 在项目根目录复制 `.env.example` 为 `.env`（或直接新建 `.env`）。
   - 在 `.env` 里填写 `AI_API_KEY=你的密钥`（或用 `OPENAI_API_KEY`）。若用 DeepSeek/智谱等，加 `AI_BASE_URL=...`、`AI_MODEL=...`。
   - 重启服务（`npm start`）。启动时控制台会显示「已接入 AI，群聊将按人设自主发言」。

之后群聊会每隔约 8–20 秒随机选一位成员，由大模型根据**该成员的人设样本 + 最近对话**生成一条回复，尽量模仿其口吻和用词。未配置 `AI_API_KEY` 时，会用「人设样本随机一句」或占位句，不调用接口。

## 管理员账号（微调人设）

- **用户名**：`admin`  
- **密码**：`Cc921`（也可用环境变量 `ADMIN_PASSWORD` 覆盖）

用 admin 登录后进入**管理页**，可对每个成员的**发消息时间（活跃时段）**等人设信息做微调，保存后群聊 AI 会按新设置表现。

## 功能说明

- **入口**：先显示题记（含换行），随后出现两个选项：「观」「改」。
- **观**：只读查看当前对话流，不登录。
- **改**：用**该角色的用户名 + 该角色密码**登录，登录后以该身份在群内发言；其他人（及回复时机）由后台 AI 模拟。也可用 **admin** 登录进入管理页微调人设。
- **13 成员**：在 `server/members.js` 中维护；密码在 `credentials.json` 或环境变量 `LOGIN_CREDENTIALS` 中设置（未配置则默认 123456）。

---

## 人设从哪来：对话采集（和 AI 聊 10 分钟）

人设只靠**网页里的「对话采集」**，让成员和页面里的假 AI 聊约 10 分钟，你的回复会用来学说话风格：

1. 用**改**模式登录自己的账号，在聊天页右上角点 **「采集语气」**。
2. 进入采集页后点 **「开始采集」**，按提示随意回复即可。
3. 聊满约 10 分钟（或随时点 **「结束并合并人设」**），采集内容会写入 `data/collected-chat.json` 并合并进 `data/personas.json`。接上大模型后，群聊 AI 会按这些人设自主发言。

**无需导入聊天记录**；若需微调谁在几点更爱说话，用 admin 登录后在管理页改「活跃时段」即可。

### AI 如何用这些人设（自主聊天）

- **未配置 AI_API_KEY**：从该成员的**人设样本**里随机选一句，或占位句。
- **已配置 AI_API_KEY**：每次轮到某成员发言时，把**该成员的人设样本 + 最近群聊**发给大模型，按「严格模仿这种说话方式」生成一条回复。
- **发言时机**：按人设里的「活跃时段」加权。

### 环境变量（接 AI 时用）

| 变量 | 说明 |
|------|------|
| `AI_API_KEY` | **必填**。DeepSeek/智谱/OpenAI 等 API 密钥（也兼容 `OPENAI_API_KEY`） |
| `AI_BASE_URL` | 选填。默认 `https://api.openai.com/v1`（用 DeepSeek 则填 `https://api.deepseek.com/v1`） |
| `AI_MODEL` | 选填。默认 `gpt-3.5-turbo`（用 DeepSeek 则填 `deepseek-chat`） |

### 推荐：便宜、好用、兼容本项目的 AI（国内可直连）

本项目使用 **OpenAI 兼容的 Chat Completions 接口**，以下任选一个即可，在 `.env` 里设 `AI_BASE_URL` + `AI_API_KEY` + `AI_MODEL`：

| 服务 | 特点 | 大致价格 |
|------|------|----------|
| **DeepSeek** | 便宜、中文好、接口完全兼容 | 约 1 元/百万 tokens 量级 |
| **智谱 GLM**（glm-4-flash） | 国内直连、响应快 | 按量计费，较便宜 |
| **月之暗面 Moonshot** | 中文表现好 | 有免费额度，按量不贵 |
| **OpenAI gpt-3.5-turbo** | 默认即可，需能访问 api.openai.com | 相对便宜 |

`.env.example` 里已写好上述几家的示例，复制到 `.env` 后改成自己的密钥即可。

在项目根目录建 `.env`（可复制 `.env.example`），填好 `AI_API_KEY`（及可选 `AI_BASE_URL`、`AI_MODEL`）后重启即可。

---

## 可选

- 成员名单、昵称、密码：在 `server/members.js` 和 `credentials.json`（或环境变量）中修改。

## 技术栈

- 后端：Node.js + Express
- 前端：静态 HTML/CSS/JS，极简米白 + 古风字体（仿宋类）
- 先本地跑通后再考虑部署（如 Render、自建服务器等）
