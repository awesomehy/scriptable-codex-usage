# Codex Usage · Scriptable 额度组件

版本 **1.0.0**。按提供的 ChatGPT 原版截图制作，支持自建 Codex 额度 API；默认显示真实数据。支持小号、中号、大号，以及浅色、深色和跟随系统。

[查看脚本](https://github.com/awesomehy/scriptable-codex-usage/blob/main/CodexUsage.js) · [下载源码](https://raw.githubusercontent.com/awesomehy/scriptable-codex-usage/main/CodexUsage.js)

## 安装或升级

1. 复制同目录 `CodexUsage.js` 的全部内容。
2. 在 iPhone 的 Scriptable 中新建 **CodexUsage**；如果已经安装，打开原脚本，替换全部内容并保存。
3. 运行脚本。首次运行会弹出设置框，填写自己的额度接口完整地址和 API Key，点击 **保存并刷新**。代码不预置任何私人服务地址或密钥。
4. 在 iOS 桌面添加 Scriptable 小组件，选择所需尺寸。在“编辑小组件”中将 Script 设为 **CodexUsage**，Parameter 留空。
5. 如果之前填过 `{"scenario":"demo"}` 等预览参数，请清空，或将 `scenario` 改成 `live`。

接口地址和 API Key 一起保存到本机 [Scriptable Keychain](https://docs.scriptable.app/keychain/)，不写入脚本、组件参数、预览页面或额度缓存。以后替换脚本代码时，已保存的连接设置会保留。HTTP 不加密传输；接口支持时请使用 HTTPS。

点击桌面组件会打开脚本菜单，可预览三个尺寸、**立即刷新**或修改接口 / API Key。保存设置后会读取一次真实额度并显示中号预览。

## 一键更新

运行脚本 → **一键更新脚本**，或点击中号、大号组件右下角的 **更新 ↗**。

更新从本公开仓库 `main` 分支获取，清单与源码锁定同一个提交，并校验 SHA-256、脚本标识、版本和语法。先备份当前代码，再写入并回读校验；不使用文件移动替换。失败时尝试恢复原脚本，菜单提供 **恢复更新前版本**。

更新成功后重新运行新版脚本，自动强制读取一次额度并显示预览。接口地址、密钥和桌面参数保留。桌面组件的实际重绘时机仍由 iOS 控制。更新只请求 GitHub 公共资源，不向 GitHub 发送额度接口凭据；无法访问 GitHub 时可手动复制完整源码覆盖原脚本。

仓库不包含私人接口地址、API Key 或私钥；仅保留代码、通用测试样例、发布清单及示例预览。个人连接配置仅在手机首次运行时填写。

## 显示和刷新

- 小号、中号：默认优先展示周额度；没有周额度时展示该额度组实际返回的第一个窗口。
- 大号：最多显示两个实际存在的窗口；只有周额度时只显示一组，并补充重置时刻和可用重置次数。重置次数仅供查看。
- `primary` / `secondary` 不代表固定周期，实际按 `windowDurationMins` 识别。10080 分钟显示 Weekly，300 分钟显示 5-hour。
- 底部“上次刷新”使用 API 的 **`fetchedAt`**，时间统一为北京时间。读取旧缓存不会将其改成手机当前时间。
- 默认每 **10 分钟**申请运行；本地数据和服务端数据时间都在 10 分钟内时复用本地缓存，减少请求。超过 30 分钟未更新时默认标记“已过期”。
- “立即刷新”跳过本地缓存，调用 `/api/usage?refresh=1`，让服务端重新读取额度；服务端限流时仍遵守 `Retry-After`。
- 失败时保留上次成功数据和时间，标注“刷新失败”或“验证失败”；没有旧数据时显示 `—` 和错误说明。未知额度也显示 `—`，不会转换成 0%。
- 重置时刻已到但还没有新数据时，提示等待刷新，不自行改成 100%。

根据 [Scriptable 刷新说明](https://docs.scriptable.app/listwidget/#refreshafterdate)，10 分钟是申请的最早运行间隔，实际由 iOS 调度。脚本内刷新并展示预览后，桌面组件仍由 iOS 安排重绘，不能保证立刻变化。

## 参数

桌面组件的 Parameter 接受 JSON，例如：

```json
{"theme":"dark","window":"weekly"}
```

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `theme` | `light` | `light` / `dark` / `auto` |
| `window` | `auto` | `auto` / `weekly` / `session` / `primary` / `secondary`；仅影响小号、中号 |
| `limitId` | `codex` | 精确选择 `limits` 中的额度组，不混用其他模型额度 |
| `refreshMinutes` | `10` | 1–1440 的整数；本地缓存和申请刷新间隔 |
| `scenario` | `live` | `live` 为真实数据；`demo` / `stale` / `empty` / `error` 用于不联网的界面预览 |

`session` 选择实际存在的、短于一周的最短周期，不会虚构缺失的窗口。显式选择的周期不存在时显示“此额度窗口暂无数据”。演示场景会标注“示例”，日期固定为 2026-10-24，不能当作实时额度。不要在 Parameter 中填写 API Key 或接口地址；在脚本设置菜单中管理它们。

## API 适配与缓存

请求使用 `Authorization: Bearer <API Key>`，普通查询为 `GET /api/usage`。请求超时设为 20 秒；拒绝重定向，以免凭据被转发到其他地址。更换地址时需要重新输入密钥。

适配字段包括 `ok`、`fetchedAt`、`limits[].limitId`、两类窗口的 `remainingPercent` / `usedPercent`、`windowDurationMins`、`resetsAtIso` / Unix 秒级 `resetsAt`，以及是否允许使用、消费限制、可用重置次数等状态。缺少剩余比例而提供已用比例时，按 `100 - usedPercent` 计算并限制到 0–100。

本地缓存位于 Scriptable 本机文档目录 `CodexUsageWidget`。两份文件交替写入并读回校验，不依赖 iCloud 同步或文件移动。新文件损坏时可回退到另一份有效文件。密钥或接口改变会切换缓存分区，避免显示另一连接的旧额度。

“未保存”表示当次网络数据可显示，但没有成功保存到本地供下次离线使用。一般请求失败后冷却 60 秒，手动刷新可跳过此冷却；429 限流则遵守服务端给出的重试时间。

## 开发验证

```sh
npm test
npm run preview
npm run check:release
node --check CodexUsage.js
```

自动测试覆盖鉴权、窗口映射、缓存命中、强制刷新、未知值、超时、格式错误、重定向、限流、凭据切换和缓存写入失败。测试使用模拟响应，不包含真实密钥。

发布新版本时，修改脚本顶部版本标记和 `VERSION`，运行 `npm run release` 生成 `update.json`，将源码与清单在同一提交中推送。不要将个人配置文件加入仓库。

`preview.html` 是由实际渲染函数生成的交互式界面预览，使用明确标注的示例数据，不访问接口。浏览器的字体和布局与 iOS 会有差异，最终显示需要在 iPhone 的 Scriptable 中确认。
