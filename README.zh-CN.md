<div align="center">

# Windsurf Auto Free

**Windsurf IDE 账号管理工具集**

自动批量注册 Windsurf 账号，并在 IDE 内便捷切换与管理

[![](https://img.shields.io/badge/Next.js-16-black?style=flat-square&logo=next.js)](https://nextjs.org/)
[![](https://img.shields.io/badge/React-19-blue?style=flat-square&logo=react)](https://react.dev/)
[![](https://img.shields.io/badge/Fastify-5-black?style=flat-square&logo=fastify)](https://fastify.dev/)
[![](https://img.shields.io/badge/Python-3.11-blue?style=flat-square&logo=python)](https://python.org/)
[![](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

 [中文](./README.md) | [English](./README.en.md)

</div>

---

## 项目用途

Windsurf Auto Free 是一个面向 Windsurf IDE 的账号自动化与管理工具集，提供从批量注册、过程监控到账号沉淀与 IDE 内切换的一整套流程。

适用场景：

- 需要批量生成 Windsurf 账号用于测试/隔离环境
- 需要沉淀一批可用账号并进行状态管理
- 希望在 Windsurf/VSCode 内直接切换账号，减少手工操作

## 核心功能

- **批量注册**
  - 支持一次性注册多个账号
  - 支持配置并发数，提高效率
- **实时监控**
  - 通过 SSE（Server-Sent Events）实时输出日志
  - 前端展示进度与运行状态
- **账号池管理**
  - 账号落库（SQLite）
  - 查询/筛选/导出（以当前 UI/接口为准）
- **IDE 扩展**
  - 在 Windsurf/VSCode 内打开管理面板
  - 通过后端接口进行账号切换/管理（以扩展实现为准）
- **Cloudflare 规避**
  - 使用 DrissionPage（Windows API 驱动）进行浏览器自动化
  - 避免常见无头模式（headless）被识别的问题

## 截图

<!--
  截图占位
  推荐尺寸：1200x800 或 1920x1080
-->

| 注册面板 | IDE 扩展 |
|:---:|:---:|
| ![注册面板](./docs/screenshots/dashboard-placeholder.png) | ![IDE 扩展](./docs/screenshots/extension-placeholder.png) |
| *实时注册进度与日志* | *在 Windsurf 内直接切换/管理* |

## 项目结构

```
windsurf-auto-free/
apps/
  extension/           # VSCode/Windsurf 扩展
    src/
      extension.ts     # 扩展入口
    package.json       # 扩展清单
  server/              # 后端 API 服务
    src/
      routes/          # API 路由
      services/        # 业务逻辑
      lib/             # 工具与基础设施
    prisma/
      schema.prisma    # 数据库 Schema
    windsurf_register.py  # Python 自动化脚本
  web/                 # Web UI（Next.js）
    src/app/
      page.tsx         # 注册页面
packages/
  shared/              # 共享类型与 Schema
```

## 技术栈

| 类别 | 技术 |
|------|------|
| **前端** | Next.js 16, React 19, Tailwind CSS, shadcn/ui |
| **后端** | Fastify 5, Prisma, SQLite |
| **自动化** | Python 3.11, DrissionPage |
| **扩展** | VSCode Extension API |

## 环境要求

- **Node.js** >= 18.0.0
- **pnpm** >= 8.0.0
- **Python** >= 3.11
- **Chrome/Chromium** 已安装
- **Windows**（DrissionPage 自动化依赖 Windows API）

## 安装与初始化

### 1. 安装 Node.js 依赖

在项目根目录执行：

```bash
pnpm install
```

### 2. 安装 Python 依赖

```bash
pip install DrissionPage requests
```

### 3. 初始化数据库

```bash
cd apps/server
pnpm db:generate
pnpm db:push
```

## 使用方式

### 启动后端

```bash
cd apps/server
pnpm dev
```

- API 服务：`http://localhost:3001`
- SSE 日志：`http://localhost:3002`
- Swagger 文档：`http://localhost:3001/docs`

### 启动 Web

```bash
cd apps/web
pnpm dev
```

- Web UI：`http://localhost:3000`

### 一键启动（根目录）

```bash
pnpm dev
```

## 功能使用说明

### 1. Windsurf 批量注册

打开：`http://localhost:3000/`

- **Count**：注册数量（1-100）
- **Concurrency**：并发数（建议 1-5，具体以机器性能为准）

注册流程（概览）：

1. 打开 Windsurf 注册页面
2. 自动填写注册信息
3. 处理 Cloudflare 校验
4. 等待验证步骤完成
5. 提取登录态/Token，并将账号写入数据库

注意事项：

- **不建议 headless**：Cloudflare 可能识别并阻断无头浏览器
- 自动化浏览器窗口可能会出现（通常被放到角落或尽量不打扰）

### 2. 账号管理接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/windsurf/register` | 启动批量注册 |
| POST | `/api/windsurf/stop` | 停止注册 |
| GET | `/api/windsurf/status` | 获取运行状态 |
| GET | `/api/windsurf/accounts` | 获取账号列表 |
| DELETE | `/api/windsurf/accounts/:id` | 删除账号 |

账号状态（后端约定）：

- `pending`
- `registering`
- `success`
- `failed`

### 3. IDE 扩展

构建与打包：

```bash
cd apps/extension
pnpm build:en
# 或
pnpm build:zh

pnpm package:en
```

安装到 Windsurf/VSCode：

1. 打开扩展面板
2. 点击右上角 `...`
3. 选择 `Install from VSIX...`
4. 选择生成的 `.vsix` 文件

## 配置

### 环境变量（后端）

在 `apps/server/` 下创建 `.env`：

```env
DATABASE_URL="file:./dev.db"
```

### 扩展后端地址

VSCode 设置：

```json
{
  "ideToolkit.backendUrl": "http://localhost:3001"
}
```

## 常见问题

| 问题 | 解决办法 |
|------|----------|
| 注册被 Cloudflare 拦截 | 确保不是 headless，保证浏览器可见 |
| 找不到 Chrome | 安装 Chrome/Chromium |
| Python 脚本异常 | 确认 `DrissionPage` 已正确安装 |
| 数据库相关报错 | 重新执行 `pnpm db:push` 同步 schema |
| SSE 无法连接 | 确认 3002 端口未被占用 |

## 已知限制

- **仅 Windows**：自动化依赖 Windows API
- **不支持 headless**：可能被 Cloudflare 识别
- **依赖 Chrome/Chromium**

## License

MIT

---

<div align="center">

**[返回顶部](#windsurf-auto-free)**

</div>
