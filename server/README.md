# Codex 额度 API

与仓库根目录的 [Scriptable 小组件](../README.md) 配套使用，也可供其他项目通过 HTTP 调用。使用 Node.js 内置模块，无第三方依赖。

通过本机 `codex app-server` 的 `account/rateLimits/read` 读取额度，并通过 `account/usage/read` 读取账号 token 活动汇总及每日记录。由 Codex 自己处理登录凭据，API 不读取或输出登录令牌，也不发起模型对话。返回的是账号共享数据，不是某个项目的单独消耗量。

## 环境要求

- Node.js 22 或以上。
- 能运行 `codex app-server` 的 Codex，已使用 ChatGPT 登录且能够联网。
- 与 Codex 登录账号相同的系统用户。默认继承 `CODEX_HOME`，未设置时使用 Codex 默认目录。

Windows 提供后台启停脚本和通知区域状态图标。其他系统可运行 `node src/server.mjs`；未提供系统服务安装程序。仅有 OpenAI API Key 的登录方式不等于 ChatGPT 订阅额度登录。

## 本机快速开始

从仓库根目录进入 `server/`，首次创建配置：

```powershell
cd server
Copy-Item config.example.json config.json
node src/server.mjs
```

服务默认监听 `127.0.0.1:58321`，供本机访问，默认未配置 API Key。关闭前台进程可按 Ctrl+C。无需 `npm install`。

```powershell
Invoke-RestMethod 'http://localhost:58321/health'
Invoke-RestMethod 'http://localhost:58321/api/usage'
Invoke-RestMethod 'http://localhost:58321/api/token-usage'
```

已有个人配置时直接编辑 `config.json`，不要用模板覆盖。该文件已加入 `.gitignore`。

## 供手机或其他设备调用

先生成随机 API Key：

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

编辑 `config.json`，把 `host` 改成 `0.0.0.0`，把 `apiKey` 改成刚生成的值。非回环监听必须配置至少 **24 个字符**的 Key；端口默认 `58321`，也可自行修改。

局域网内使用电脑的局域网 IP。公网访问需要自己的域名、路由器 TCP 端口转发或反向代理，以及对应防火墙规则。转发目标为这台电脑的地址和配置端口。服务不会自动配置路由器或防火墙。公网入口应配置 HTTPS，HTTP 会明文传输 Key。

例如部署后的地址可为 `https://codex-api.example.com/api/usage`。本文的域名是占位示例，必须替换为自己的服务地址。反向代理可以在 HTTPS 443 端口接入，再转发到本机 API 端口。不要把 `0.0.0.0` 或手机上的 `localhost` 填进 Scriptable 设置。

在 Scriptable 首次运行时填入**完整额度接口 URL**和同一个 Key；之后通过脚本菜单“设置接口 / API Key”修改。Key 保存在手机 Keychain，不写入脚本代码或组件参数。

## Windows 任务栏监控与启动

在 `server/` 目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-tray.ps1
```

安装脚本会立即启动监控和 API，并创建桌面 **Codex Usage API Monitor** 快捷方式、当前用户 Windows“启动”文件夹中的开机快捷方式。以后在用户登录后，监控会自动启动 API；双击桌面监控快捷方式也会启动 API，已有监控或服务时不会重复运行。安装时会移除旧的 **Codex Usage API** 直启快捷方式。

通知区域图标**绿色**表示本机 `/health` 返回本项目的正常响应，**红色**表示 API 未运行或无响应。右键可启动、停止或刷新 API 状态，也可只退出图标；退出图标不会停止 API。手动停止 API 后，监控不会每 10 秒擅自重启它；可用右键“启动 API”或双击桌面监控快捷方式重新启动。状态每 10 秒检查一次，检查本机地址时绕过代理。图标可能在任务栏右侧的隐藏图标区域，可在 Windows 设置中选择始终显示。

配置修改后用右键菜单先停止、再启动 API。服务日志在 `.runtime/stdout.log`、`.runtime/stderr.log`，状态图标的启动错误在 `.runtime/tray-stderr.log`；这些文件不进入 Git。移除登录后自启时，删除“启动”文件夹中的 `Codex Usage API Status.lnk`，并通过图标右键菜单退出。

## 接口与鉴权

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/usage` | 查询额度，默认缓存最多 30 秒 |
| GET | `/api/usage?refresh=1` | 强制读取最新额度 |
| GET | `/api/token-usage` | 查询累计、本月、近 7 个日历日及昨日的 token 用量 |
| GET | `/api/token-usage?refresh=1` | 强制读取最新 token 用量 |
| GET | `/health` | HTTP 服务健康检查，不代表 Codex 已登录或额度可用 |
| GET | `/` | 返回服务与接口信息 |

配置 `apiKey` 后，除 `/health` 外上述接口都要求：

```http
Authorization: Bearer YOUR_API_KEY
```

用真实 Key 替换占位符。不要把 Key 放在 URL 查询参数里。浏览器地址栏直接打开额度接口不会附带请求头，因此会返回 `401`。测试连通性可以直接访问 `/health`。

两类数据分别缓存，按请求触发：过期后的下一次请求刷新数据，无访问时不轮询；同类并发查询合并。读取失败返回错误并清除该类旧快照，普通失败请求有 5 秒重试间隔，`refresh=1` 可以立即重试。切换 Codex 账号后应分别强制刷新，避免在缓存有效期内看到之前的账号数据。

### Token 用量

`/api/token-usage` 一次返回四项查询结果。示例中的数字和日期均为虚构数据：

```json
{
  "ok": true,
  "source": "codex-app-server",
  "fetchedAt": "2026-10-05T04:00:00.000Z",
  "cached": false,
  "ageSeconds": 0,
  "cacheTtlSeconds": 30,
  "lifetimeTokens": 12345,
  "asOfDate": "2026-10-05",
  "serverTimeZone": "Asia/Shanghai",
  "thisMonth": {
    "tokens": 110, "startDate": "2026-10-01", "endDate": "2026-10-05",
    "reportedDays": 3, "missingDates": ["2026-10-02", "2026-10-03"], "complete": false
  },
  "last7Days": {
    "tokens": 120, "startDate": "2026-09-29", "endDate": "2026-10-05",
    "reportedDays": 4, "missingDates": ["2026-09-29", "2026-10-02", "2026-10-03"], "complete": false
  },
  "yesterday": {
    "tokens": 40, "startDate": "2026-10-04", "endDate": "2026-10-04",
    "reportedDays": 1, "missingDates": [], "complete": true
  },
  "dailyCoverage": { "firstDate": "2026-09-30", "lastDate": "2026-10-05", "reportedDays": 4 }
}
```

`lifetimeTokens` 直接来自 Codex 的累计汇总，可能为 `null`。`thisMonth` 从服务器本地时区的本月 1 日算至今日；`last7Days` 包含今日及前 6 个日历日；`yesterday` 是服务器本地时区的昨日。上游每日记录的日期时区未在协议中明确规定，所以日界线可能与本机时区不同。

各周期的 `tokens` 是**已返回日期的合计**；`complete: false` 表示存在未返回的日期，合计可能偏低。`missingDates` 列出这些日期，不能直接将其视为零用量。周期内没有任何记录时 `tokens` 为 `null`。`dailyCoverage` 说明上游实际返回的日期跨度，历史长度不保证；今天的数据也可能尚未返回。此接口不按设备、项目或模型拆分，也不能从额度百分比推算 token 数。

## 调用示例

所有远程示例使用占位域名，需换成自己的部署地址。`YOUR_API_KEY` 是独立服务 Key，不是 Codex 登录令牌。

### curl

```bash
curl 'https://codex-api.example.com/api/usage' -H 'Authorization: Bearer YOUR_API_KEY'
curl 'https://codex-api.example.com/api/token-usage' -H 'Authorization: Bearer YOUR_API_KEY'
```

Windows PowerShell 可使用 `curl.exe`，避免旧版 PowerShell 的别名影响。强制刷新时在地址后添加 `?refresh=1`，保持鉴权头。

### PowerShell（在服务端本机读取配置）

```powershell
$config = Get-Content -Raw .\config.json | ConvertFrom-Json
Invoke-RestMethod 'http://localhost:58321/api/usage' -Headers @{
    Authorization = "Bearer $($config.apiKey)"
}
```

本例使用默认端口。更改端口时同步修改 URL；其他电脑无法直接读取服务端配置，应自行设置 Key。

### JavaScript / Node.js

在调用方环境中设置 `CODEX_USAGE_API_KEY`：

```javascript
const apiKey = process.env.CODEX_USAGE_API_KEY;
if (!apiKey) throw new Error('请先设置 CODEX_USAGE_API_KEY');
const response = await fetch('https://codex-api.example.com/api/usage', {
  headers: { Authorization: `Bearer ${apiKey}` },
  signal: AbortSignal.timeout(30000)
});
const data = await response.json();
if (!response.ok) throw new Error(data.error.message);
const codex = data.limits.find(item => item.limitId === 'codex');
console.log(codex?.primary?.remainingPercent);

const tokenResponse = await fetch('https://codex-api.example.com/api/token-usage', {
  headers: { Authorization: `Bearer ${apiKey}` },
  signal: AbortSignal.timeout(30000)
});
const tokenData = await tokenResponse.json();
if (!tokenResponse.ok) throw new Error(tokenData.error.message);
console.log({
  lifetime: tokenData.lifetimeTokens,
  month: tokenData.thisMonth.tokens,
  last7Days: tokenData.last7Days.tokens,
  yesterday: tokenData.yesterday.tokens,
  monthComplete: tokenData.thisMonth.complete
});
```

### Python（标准库）

```python
import json
import os
from urllib.request import Request, urlopen

request = Request(
    'https://codex-api.example.com/api/usage',
    headers={'Authorization': f"Bearer {os.environ['CODEX_USAGE_API_KEY']}"},
)
with urlopen(request, timeout=30) as response:
    data = json.load(response)
print(data['limits'])
```

### Postman / Apifox

选择 GET，URL 填自己的完整额度接口地址。Authorization 选择 **Bearer Token**，Token 填实际 Key。

## 响应数据

以下为虚构示例，不代表任何账号的实时状态：

```json
{
  "ok": true,
  "source": "codex-app-server",
  "fetchedAt": "2029-12-31T00:00:00.000Z",
  "cached": false,
  "ageSeconds": 0,
  "cacheTtlSeconds": 30,
  "ordinaryUsageAllowed": true,
  "availableResetCount": 0,
  "limits": [{
    "limitId": "codex",
    "limitName": null,
    "planType": null,
    "primary": {
      "usedPercent": 35,
      "remainingPercent": 65,
      "windowDurationMins": 10080,
      "resetsAt": 1893456000,
      "resetsAtIso": "2030-01-01T00:00:00.000Z"
    },
    "secondary": null,
    "credits": null,
    "spendControlReached": false,
    "rateLimitReachedType": null
  }]
}
```

- `fetchedAt` 是数据抓取时间；`cached` 表示是否命中本服务缓存，`ageSeconds` 是数据年龄。
- `usedPercent` 是已用百分比；`remainingPercent` 为 `100 - usedPercent`，限制在 0–100。
- `primary` / `secondary` 不是固定周期。按 `windowDurationMins` 识别窗口，10080 分钟为一周，300 分钟为 5 小时。
- `resetsAt` 为 Unix 秒级时间戳，`resetsAtIso`、`fetchedAt` 为 UTC。小组件会转换成北京时间显示。
- `limits` 支持多个额度组，优先读取上游 `rateLimitsByLimitId`，旧版返回可回退到 `rateLimits`。
- `null` 表示上游未提供，不代表额度为零；百分比不能换算成固定剩余 token 数。
- `availableResetCount` 仅供查看，API 没有执行额度重置的功能。没有可用额度数据时返回 `503`。

## 配置

| 字段 | 默认值 | 环境变量 |
| --- | --- | --- |
| `host` | `127.0.0.1` | `CODEX_USAGE_HOST` |
| `port` | `58321` | `CODEX_USAGE_PORT` |
| `cacheTtlSeconds` | `30`，范围 0–3600 | `CODEX_USAGE_CACHE_SECONDS` |
| `timeoutSeconds` | `20`，范围 1–120 | `CODEX_USAGE_TIMEOUT_SECONDS` |
| `codexPath` | 自动查找可执行文件 | `CODEX_BIN` |
| `apiKey` | 空，默认仅本机访问 | `CODEX_USAGE_API_KEY` |
| `allowedOrigins` | `[]` | 使用配置文件 |

环境变量优先于配置文件。`codexPath` 可以指定可执行文件的路径；Windows 使用 `codex.exe`，不要填 `.cmd` 启动脚本。应用会从 PATH 查找，Windows 也会查找 Codex 桌面端安装的可执行文件。

修改 `apiKey` 后重启服务，并更新 Scriptable 和其他调用方保存的 Key。非回环监听要求至少 24 字符；若环境变量中设置了 Key，须同时检查覆盖关系。

`allowedOrigins` 用于浏览器跨域调用，填写调用方网页的完整 Origin，例如 `https://dashboard.example.com`；不要包含路径或尾部斜杠，不支持通配符。Scriptable、Node.js、Python 和 curl 不受浏览器 CORS 约束。允许跨域后仍需携带 Key；HTTPS 网页访问 HTTP 接口还可能被混合内容策略阻止。

## 错误与排查

```json
{ "ok": false, "error": { "code": "CODEX_TIMEOUT", "message": "读取额度超时，请检查网络及 Codex 登录状态。" } }
```

| 状态 / 现象 | 处理 |
| --- | --- |
| `401 UNAUTHORIZED` | 核对 `Authorization: Bearer 实际Key`，确认服务端和调用方 Key 一致。 |
| `403 ORIGIN_DENIED` | 将浏览器网页来源加入 `allowedOrigins` 并重启。 |
| `403 HOST_DENIED` | 检查监听地址和请求 Host。默认回环模式拒绝非本机 Host。 |
| `502` | Codex 查询失败，检查登录状态、网络和错误码。 |
| `503` | 找不到 Codex、无法启动或没有额度数据，检查 `codexPath` 和 ChatGPT 登录。 |
| `504` | 读取超时，检查网络后重试。 |
| 连接失败 | 检查服务运行、监听地址、端口占用、路由器转发、防火墙及域名解析。 |
| 修改配置无效 | 停止并重新启动，检查是否存在覆盖配置的环境变量。 |

`/health` 正常只代表 HTTP 服务存活；以带 Key 的 `/api/usage` 响应确认额度读取。手机离开局域网后测试自己的 `/health`，可进一步验证外部网络连通性。

## 开发与隐私

在 `server/` 中运行 `npm test`，或在仓库根目录运行 `npm test` 同时验证 API 和小组件。测试使用模拟 RPC 进程和虚构数据，无需真实登录，不消耗模型额度。

发布只包含源码、测试和空配置模板。`config.json`、`.env*`、`.runtime/`、日志和密钥文件已通过 `.gitignore` 排除。接口使用字段白名单，不返回账号标识、登录令牌或原始 RPC 错误；服务不将 Codex stderr 转发给调用方。

协议参考：[OpenAI Codex App Server 文档](https://learn.chatgpt.com/docs/app-server)。Codex 版本或登录状态变化可能影响可用性，以实际错误状态为准。
