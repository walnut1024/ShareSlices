# Cloudflare Drop 如何运行用户上传的站点

调研日期：2026-07-11

## 结论

Cloudflare Drop 的核心安全边界是“把每次上传部署成独立的 Cloudflare Workers 静态站点”。Drop 结果页会把该站点放进带 `sandbox="allow-scripts allow-same-origin"` 的预览 iframe，但也提供新窗口直接打开；因此 iframe sandbox 是内嵌预览的附加限制，真正持续成立的边界是上传代码运行在随机命名的 `workers.dev` origin，而不是 `www.cloudflare.com` origin。[Drop 页面](https://www.cloudflare.com/drop/)；[Drop 当前 Web 客户端](https://www.cloudflare.com/_summon/assets/index-D79nefMC.js)；[LiveStage 客户端 chunk](https://www.cloudflare.com/_summon/assets/LiveStage-baq-jDZ6.js)

这是一种 **origin isolation（源隔离）**：浏览器以 scheme、host、port 确定 origin；不同 origin 默认不能读取彼此的 DOM、存储和凭据。它解决的是上传代码伤害管理站点及其会话的问题，不等于限制上传代码自身的联网、弹窗、跳转、钓鱼或浏览器漏洞利用能力。

## 已验证的部署链路

1. Drop 接受一个目录或 ZIP，目标内容是 HTML、CSS 和 JavaScript；页面要求存在 `index.html`。[Drop 页面](https://www.cloudflare.com/drop/)
2. Web 客户端在上传前执行轻量限制：单个文件或 ZIP 最大 25 MiB、目录总文件数少于 2,000、总大小小于 100 MiB，并检查根目录或一层子目录中是否有 `index.html`。这些是客户端检查，不能据此断言服务端采用相同限制。[Drop 当前 Web 客户端](https://www.cloudflare.com/_summon/assets/index-D79nefMC.js)
3. 客户端调用 Cloudflare API 的 preview provisioning 接口，取得临时 account ID、API token、claim token、到期时间和领取 URL；Worker 名称是 `drop-` 加随机 UUID 的前 12 个字符。[Drop 当前 Web 客户端](https://www.cloudflare.com/_summon/assets/index-D79nefMC.js)
4. 客户端使用 Workers Static Assets 的上传会话和资产上传 API，把文件清单与缺失 blobs 上传到该临时账户。部署 metadata 配置 `assets.not_found_handling: "single-page-application"`，并启用 `ASSETS` binding。[Drop 当前 Web 客户端](https://www.cloudflare.com/_summon/assets/index-D79nefMC.js) Cloudflare 的 Direct Upload 文档描述了相同的三步协议：提交 manifest、上传缺失文件、创建 Worker 版本。[Direct Uploads](https://developers.cloudflare.com/workers/static-assets/direct-upload/)
5. 客户端创建 Worker、开启其 `workers.dev` subdomain，并从 API 返回的 subdomain 拼出最终 URL。结果页把该跨 origin URL 嵌入 `sandbox="allow-scripts allow-same-origin"` 的 iframe，并用透明链接覆盖预览；用户点击后以 `target="_blank" rel="noopener noreferrer"` 打开顶层页面。[Drop 当前 Web 客户端](https://www.cloudflare.com/_summon/assets/index-D79nefMC.js)；[LiveStage 客户端 chunk](https://www.cloudflare.com/_summon/assets/LiveStage-baq-jDZ6.js)
6. SPA 模式会在导航请求未匹配静态文件时返回 `/index.html`；这解释了 Drop 对前端路由站点的支持，并不构成安全沙箱。[Workers SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/)

## 安全边界究竟在哪里

### 1. 管理面与运行面分属不同 origin

Drop 控制页位于 `www.cloudflare.com`，上传结果位于随机 Worker 名称下的 `workers.dev` 站点。上传代码因此不会以 `www.cloudflare.com` origin 执行，也不能按同源权限读取 Drop 页面的 DOM、localStorage 或 Cloudflare cookie。随机 Worker 名还避免所有上传内容共用单一 host。[Drop 当前 Web 客户端](https://www.cloudflare.com/_summon/assets/index-D79nefMC.js)

内嵌预览的 sandbox 只授予脚本和自身 origin 能力，没有授予表单、弹窗、下载、顶层导航等 sandbox token；预览上方的透明链接也使它不可直接交互。不过 `allow-same-origin` 与 `allow-scripts` 同时存在意味着该 iframe 内的代码仍保有其 `workers.dev` origin 身份，并不是 opaque origin。新窗口打开后 iframe sandbox 不再适用。[LiveStage 客户端 chunk](https://www.cloudflare.com/_summon/assets/LiveStage-baq-jDZ6.js)

需要谨慎表述：从公开客户端能确认“每个部署使用随机 Worker 名”，但无法确认 Cloudflare 是否为每个 Drop 都分配独立的 `workers.dev` 注册域后缀、浏览器站点（site）边界或底层计算隔离单元。也无法只凭随机 hostname 证明相邻 Drop 站点之间不存在任何共享父域 cookie 风险；这需要观察实际生成 URL 与响应 cookie 才能确认。

### 2. 只部署静态资产，不执行用户服务端代码

客户端提交的 metadata 只声明静态 assets 和 `ASSETS` binding，没有上传用户 Worker 脚本。上传的 JavaScript 在访问者浏览器里执行，而不是作为 Cloudflare Worker 服务端代码运行。[Drop 当前 Web 客户端](https://www.cloudflare.com/_summon/assets/index-D79nefMC.js)

这把服务端风险面压缩为静态文件接收与分发，但浏览器端的用户 JavaScript 仍是完全主动内容。

### 3. Workers 平台负责内容寻址上传和静态分发

Direct Upload 协议先提交路径到内容哈希的 manifest，再只上传平台缺少的文件，最后部署 Worker 版本；上传时给出的文件 `Content-Type` 会在服务时附加到响应。[Direct Uploads](https://developers.cloudflare.com/workers/static-assets/direct-upload/) Workers Static Assets 默认还会附加 `Cache-Control`、`ETag` 和 `CF-Cache-Status` 等响应头。[Static asset headers](https://developers.cloudflare.com/workers/static-assets/headers/)

这说明 Drop 复用了 Workers 的资产上传和分发机制。公开证据没有表明 Drop 在上传 HTML/JS 前做代码净化、AST 审查或恶意脚本扫描。

### 4. 临时凭据与领取流程限制资源控制面权限

未登录上传先经过 challenge 和 preview provisioning；返回值包含账户/API token、claim token、账户到期时间与领取 URL。普通上传使用临时 API token，另一条 preview assets 路径使用 `X-Claim-Token`。[Drop 当前 Web 客户端](https://www.cloudflare.com/_summon/assets/index-D79nefMC.js)

这可验证凭据是有到期字段的、领取能力与部署能力使用不同 token。公开资料没有给出 token 的权限范围、服务端强制到期语义、未领取站点保留期或滥用处置细节，因此不能进一步声称它们具备最小权限或自动删除保证。

## 没有看到的防护

以下项目在 Drop 页面、当前客户端 bundle 和相关 Workers Static Assets 文档中均没有可验证的 Drop 专属说明：

- 对上传 HTML/JavaScript 做 sanitizer、静态恶意代码分析或反病毒扫描；
- 为最终站点强制注入 Content Security Policy、Permissions Policy 或禁用网络请求；
- 用 Remote Browser Isolation 或服务器端浏览器代替本机执行；结果页虽使用 sandbox iframe，但新窗口仍在本机浏览器正常执行，且 iframe 同时允许 scripts 与 same-origin。[LiveStage 客户端 chunk](https://www.cloudflare.com/_summon/assets/LiveStage-baq-jDZ6.js)
- 禁止用户通过 `_headers` 自定义安全头；Workers 文档反而说明静态目录中的 `_headers` 可以覆盖、添加或移除响应头。[Static asset headers](https://developers.cloudflare.com/workers/static-assets/headers/)
- 内容审核、举报、DMCA、钓鱼检测、站点到期删除及滥用封禁的具体 Drop 流程。

因此，Drop 的“安全 play”应理解为隔离信任域，而不是把不可信网页变成无害网页。

## 对 ShareSlices 的直接启示

1. **Viewer 必须使用与管理 Web 不同的 origin。** 路径隔离（例如同一 host 下 `/a/{slug}/`）不能阻止上传脚本读取同 origin 的管理页面数据或凭据。Drop 最有价值的做法是运行面独立 origin，而不是其上传 UI。
2. **Preview 与公开 Viewer 应采用相同的不可信内容边界。** 如果 Preview 在带管理 session 的 API origin 中直接运行用户 HTML，它比 Drop 的模型更弱；仅逐请求验证 ownership 不会隔离浏览器权限。
3. **不要把 CSP 当作完整替代。** CSP 能限制脚本、连接、表单和嵌套，但若产品承诺运行任意 HTML/CSS/JS，策略必然需要开放较多能力。独立 origin 是底线，CSP、Permissions Policy、`Referrer-Policy`、下载策略和滥用检测是叠加层。
4. **静态资产运行面不需要对象存储 URL。** Drop 的模式是平台边缘静态站点对外响应；ShareSlices 也可以保持对象存储私有，由 Viewer origin 的后端只读取已提交 manifest 中的对象。
5. **每个 Artifact 独立 hostname 与共享 Viewer hostname 是下一项关键决策。** 每 Artifact hostname 提供更强的 DOM/storage/service-worker 隔离；共享 Viewer hostname 更便宜简单，但不同上传者的内容会共享 origin，必须额外处理 cookie、存储、service worker 和缓存污染。

## 仍需实测的问题

当前未实际完成一次 Drop 上传，因此以下决策相关事实仍未知：

- 最终 URL 的精确结构，以及不同 Drop 是否共享同一个 `*.workers.dev` 父域；
- 最终 HTML、JS、asset 响应的 CSP、Permissions Policy、跨源隔离、CORS、cookie 和下载相关响应头；
- `_headers`、重定向文件、service worker、root-absolute URL、表单提交和外部网络请求是否完整可用；
- 未领取站点的实际到期时间、到期后的响应，以及领取后域名和保留策略；
- ZIP 解包发生在浏览器还是服务端，以及服务端对 zip bomb、路径穿越、重复路径、符号链接和 MIME 欺骗的强制校验。

在把 Drop 作为 ShareSlices 安全基线之前，应上传一组专门的探针 artifact，并记录最终页面 DOM、Network、Storage、Application/Service Worker 与全部响应头。
