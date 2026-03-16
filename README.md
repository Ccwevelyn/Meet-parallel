# 在平行时空再见

人与人之间的相遇像是一场盛大的别离。本项目用网页呈现一个「平行时空」的群聊：可**观**（只读）或**改**（登录后以某一成员身份参与聊天）。对话由 AI 按人设模拟，真人登录时代替该成员发言，二者不共存；群聊中的真人发言会**自动加入人设**，持续学习语气与习惯。

---

## 功能概览

| 功能 | 说明 |
|------|------|
| **观** | 只读查看群聊；支持按**日期**、按**成员**筛选；消息持久化到 `data/messages.json` |
| **改** | 用成员账号登录后以该身份发言；**你发言时 AI 不再代该成员说话**（真人优先） |
| **AI 发言** | 仅对「有人设样本」的成员按人设 + 最近对话生成回复；可配置活跃时段、回复习惯 |
| **语气学习** | ① 采集语气（和页面 AI 聊约 10 分钟） ② **群聊里真人说的话自动加入该成员人设**，无需单独采集 |
| **管理员** | 用 `admin` 登录可微调每人**活跃时段**、**回复习惯**（喂给 AI）、人设样本等 |

---

## 快速开始

```bash
git clone <你的仓库地址>
cd MeetParallel
npm install
npm start
```

浏览器打开 **http://localhost:3000**。成员未配置密码时默认 **123456**，管理员默认 **Cc921**。

---

## 角色与密码

每个角色有独立用户名和密码。

### 本地：JSON 文件

1. 复制 `credentials.example.json` 为 `credentials.json`（已加入 .gitignore）。
2. 编辑 `credentials.json`，为每个**用户名**设置密码。用户名需与 `server/members.js` 中的成员名一致（如 Cheng, Xian, Wang, Lin, Gao, Sev, Wu, Evelyn, Morty, Chen, Kang, Zhang, Bao）。
3. 文件可放在项目根目录或 `server/` 下。

**未配置时，所有成员默认密码为 123456。**

### 部署（如 Render）：环境变量

- **Key**: `LOGIN_CREDENTIALS`  
- **Value**: 上述 JSON 的整段字符串，例如：  
  `{"Cheng":"密码1","Xian":"密码2",...}`

登录后可在「编辑资料」中修改自己的密码（写入 `data/passwords.json`）。

---

## 群成员头像

- **方式一**：将图片放入 `public/avatars/`，按**成员 ID** 命名（如 `member_1.jpg`、`member_12.png`）。支持 jpg / png / gif / webp。无头像时使用 `default.svg`。
- **方式二**：登录后点击聊天页右上角 **「编辑资料」**，上传头像、填写人物小传。点击任意成员头像可查看其人物小传。

详见 `public/avatars/头像说明.txt`（含 member_12 / member_13 对应说明）。

---

## 观 / 改 / 管理员

- **观**：不登录，只读当前或历史对话；可通过**日期选择**和**按成员筛选**查看某日或某人的消息。
- **改**：用**成员用户名 + 密码**登录，以该身份在群内发言。此时**该身份由你发言，AI 不会代该成员回复**；其他成员仍由 AI 按人设发言。你在群聊里说的话会**自动写入该成员的人设样本**，后续 AI 会学到你的语气和习惯。
- **管理员**：用户名 **admin**，密码默认 **Cc921**（可用环境变量 `ADMIN_PASSWORD` 覆盖）。登录后进入管理页，可设置每人**活跃时段**（几点更爱说话）、**回复习惯**（一段描述喂给 AI，如「喜欢用哈哈哈结尾」）、以及人设样本等。

---

## AI 自主聊天（人设与学习）

### 人设从哪来

1. **采集语气**：改模式登录 → 点击「采集语气」→ 与页面里的假 AI 聊约 10 分钟 → 结束并合并人设。
2. **导入聊天记录**：将历史聊天按格式放入 `data/chat-history.json`，通过合并生成人设。
3. **群聊自动学习**：你以成员身份在群聊里发的每条消息，会**自动追加**到该成员的人设样本（并写入 `data/collected-chat.json`），无需再单独采集。

### AI 如何用这些人设

- 仅**有人设样本**（`sampleMessages` 非空）的成员会参与自动发言；无人设的成员不会由 AI 代发。
- 已配置 `AI_API_KEY` 时：每次从符合条件的成员中按**活跃时段**加权选人，把**该成员样本 + 最近群聊 + 回复习惯**发给大模型，按「严格模仿这种说话方式」生成一条回复；**只有大模型返回内容时才发消息**，无占位句或随机旧句。
- **真人登录并占用的成员**会被排除，不会由 AI 代发（不共存）。

### 环境变量（接 AI 时）

| 变量 | 说明 |
|------|------|
| `AI_API_KEY` | 必填。DeepSeek / 智谱 / OpenAI 等 API 密钥（也兼容 `OPENAI_API_KEY`） |
| `AI_BASE_URL` | 选填。默认 `https://api.openai.com/v1`（DeepSeek 可用 `https://api.deepseek.com/v1`） |
| `AI_MODEL` | 选填。默认 `gpt-3.5-turbo`（DeepSeek 可用 `deepseek-chat`） |

在项目根目录创建 `.env`（可复制 `.env.example`），填好上述变量后重启服务即可。

---

## 部署到 Render

1. 将代码推送到 GitHub，在 Render 中 **New → Web Service**，连接该仓库。
2. **Build Command**：`npm install`；**Start Command**：`npm start`。
3. 在 **Environment** 中按需添加：

   | Key | 说明 |
   |-----|------|
   | `LOGIN_CREDENTIALS` | 成员密码 JSON 字符串（见上文） |
   | `ADMIN_PASSWORD` | 管理员密码，默认 Cc921 |
   | `AI_API_KEY` / `AI_BASE_URL` / `AI_MODEL` | 接 AI 时填写 |

4. 创建服务后，用生成的 URL 访问。  
   **说明**：Render 免费实例磁盘临时，重启后 `data/` 会清空，持久化可后续用 Render Disk 或数据库。

---

## 技术栈

- **后端**：Node.js + Express  
- **前端**：静态 HTML / CSS / JS，米白简约风格  
- **数据**：人设与消息存于 `data/`（personas.json、messages.json、collected-chat.json 等）

---

## 可选与扩展

- 成员名单、昵称在 `server/members.js` 中维护；密码在 `credentials.json` 或环境变量中配置。
- 如需更多人设维度或回复习惯校验，可在管理页与 `server/personas.js`、`server/admin.js` 中扩展。
