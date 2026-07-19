<!-- cspell:words Hyperdrive INFR PITR pooler Supabase -->

# ShareSlices 低成本公有云部署研究

调研日期：2026-07-18

> **状态：已被后续方案取代。** 本文保留为早期调研记录，不再作为实现或部署决策依据。当前方案以 [OpenSpec change](../../openspec/changes/support-kubernetes-and-cloudflare-deployment-targets/proposal.md) 为准：Kubernetes 与 Cloudflare 是互斥的生产部署目标，Kubernetes 的外部 CDN 可选，Cloudflare 使用 Resend，并允许在每次鉴权后复用内部不可变 Viewer 字节缓存。本文的混合部署建议、Cloudflare SMTP 讨论、Viewer 全面禁用内部缓存的推论，以及具体价格与额度快照均不得直接转化为实现要求。

## 结论

ShareSlices 不应把“兼容 Cloudflare”实现成“所有运行时必须搬到 Cloudflare”。当前系统包含静态 Web、Node/Hono 管理 API、独立的 Node/Hono 不可信内容运行面、PostgreSQL、常驻 Rust/Tokio Worker、私有 S3 兼容对象存储和 Chromium 缩略图；其中静态 Web、内容分发和对象存储最适合先迁到 Cloudflare，常驻后台处理最不适合直接照搬到 Workers isolate。

推荐采用三层部署目标：

1. **近期默认：Cloudflare 边缘 + 通用容器主机的混合部署。** Web 放 Workers Static Assets，Artifact 对象放私有 R2；Node API、PostgreSQL 和现有 Rust/Chromium Worker 先留在 Hetzner、Railway 或 Render。这样立即获得低价静态托管和免 R2 公网出口费，又不先重写后台作业模型。
2. **低流量生产：Cloudflare Workers + R2 + 外部托管 PostgreSQL + 按任务唤醒的 Container。** 先把公开内容运行面迁到 Worker，再把常驻 Worker 改成“PostgreSQL 持久化任务状态、Queue 只负责唤醒、Container 处理有限批次后休眠”。Cloudflare 低价的必要条件是 Container 能 scale to zero。
3. **暂不推荐：Cloudflare-only 或把 PostgreSQL 改成 D1。** 现有跨 API/Worker 的 PostgreSQL 作业、租约、事务和锁语义是系统合同的一部分；为了省数据库费用改写为 D1，工程风险远大于先保留 PostgreSQL 并使用 Hyperdrive。

[INFR:HI] 若目标是“尽快以最低固定费用上线”，首选 **Cloudflare Static Assets/R2 + Hetzner CX33 单机运行 API、PostgreSQL、Worker**，含 IPv4 与 Hetzner 的 7 个 Server Backup 槽约 **$12.59/月（税前）**，但这是单机、非高可用方案。若目标是“尽量托管、少做服务器运维”，首选 **Cloudflare Static Assets/R2 + Railway**，按本文低流量假设约 **$22–35/月**。若目标是“长期把流量面做成边缘原生”，再投入 Cloudflare 的事件驱动改造；使用 Supabase Pro 时固定基线约 **$30/月**，另加少量 Container、R2、Queue、日志和邮件用量费。

## 研究边界与当前合同

本报告不修改 `PRODUCT.md`、OpenSpec、API 合同或代码，只研究部署目标和改造顺序。仓库证据如下：

- [PRODUCT.md](../../PRODUCT.md) 规定 Preview 与 Viewer 响应不缓存；Gallery 的 authorization、entry 和 asset 响应也使用 `Cache-Control: no-store`。因此本文**不把 Cloudflare CDN 命中率计入 Viewer 成本收益**。
- [ADR 0004](../adr/0004-render-version-thumbnails-as-isolated-background-work.md) 规定缩略图由独立后台任务调用受限 Chromium，并且浏览器只能访问已提交 Manifest 内容、不能访问外部网络。
- [ADR 0008](../adr/0008-require-isolated-self-contained-gallery-content.md) 规定 Gallery 内容必须运行在管理凭据边界之外的独立浏览器 registrable site。
- [模块设计](../design/modules.md) 记录 API/Worker 通过 PostgreSQL migrations、durable job states、object layout 和 Manifest 协作；Worker 是独立 Tokio 进程，内容存储是 S3 兼容 Adapter。
- 当前 `api/package.json` 使用 `@hono/node-server`、`pg`、Drizzle、Better Auth、Nodemailer、AWS S3 SDK、Busboy 和 Archiver；`worker/Dockerfile` 安装固定版本 Chromium；`api/src/content/` 已把不可信内容 Hono app 与 PostgreSQL/S3 Adapter 分开。这意味着“只迁 Hono 路由”不等于“整个 Node API 可原样进 Workers”，但内容运行面已有较好的迁移 seam。
- Web 的请求全部使用同源相对 `/api`，Preview、thumbnail 和 export URL 也是 `/api/...`。现有 [Compose Caddyfile](../../deploy/compose/Caddyfile) 负责把 `/api/*`、health/readiness 和静态 SPA 分流。因此 Cloudflare Web 目标不是“把 `dist/` 纯静态上传完即结束”，而是一个 edge gateway：`/api/*` 代理到 API origin，其余请求交给 Static Assets，并继续为 Preview 文档保留 `no-store`。
- `api/src/main.ts` 启动 1 秒轮询的 authentication-email dispatcher 和 30 秒轮询的 reconciliation dispatcher；Rust `worker/src/main.rs` 同时启动 processing、thumbnail、alias reindex、Gallery safety/cover/copy 等多个长轮询 loop。这些常驻循环才是 API/Worker 无法直接 scale to zero 的首要阻碍。

### 成本计算假设

除非另有说明，本文使用以下统一假设：

| 项目 | 假设 |
| --- | --- |
| 月时长 | 730 小时 |
| 流量 | 低流量早期产品；动态请求未超过 Workers Paid 的 1,000 万次/月 |
| 对象存储 | R2 Standard 不超过 10 GB-month、100 万 Class A、1,000 万 Class B/月 |
| PostgreSQL | 原型不超过 Supabase Free 的 500 MB；生产使用 Supabase Pro Micro |
| 浏览器 | Browser Run 不超过 Workers Paid 所含 10 小时/月 |
| Container burst 模型 | `standard-1`（4 GiB、8 GB disk）每月运行 30 小时；CPU 超额单列，不假设为零 |
| 未计入 | 域名、税费、邮件发送、付费支持、日志超额、跨区流量、灾备演练和人工运维 |

Gallery 需要与 Web/API 不同的 registrable site；最稳妥的基线是准备第二个域名并让部署 eligibility 检查实际拓扑。域名价格因注册商和后缀而异，不能用 `$0` 代替。

## Cloudflare 官方事实

以下表格只记录厂商拥有的一手事实，不包含 ShareSlices 适配判断。

| 产品 | 当前价格与免费额度 | 关键限制 |
| --- | --- | --- |
| Workers | Free 为 100,000 请求/日、每次 10 ms CPU；Paid 账户最低 $5/月，含 1,000 万请求和 3,000 万 CPU-ms/月，超额分别为 $0.30/百万请求、$0.02/百万 CPU-ms。静态资源请求免费且不限量。[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) | Free/Paid isolate 都是 128 MB；Free/Paid 包大小分别为 3/10 MB；Paid HTTP CPU 默认 30 秒、最高 5 分钟，Queue/Cron 最长 15 分钟；Free/Pro 账户的入站请求体上限为 100 MB。[Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Static Assets | 静态资产请求免费且不限量，资产存储无附加费用。[Static Assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) | 单文件 25 MiB；每 Worker version 的文件数 Free 20,000、Paid 100,000。它适合 Web build，不适合把所有用户 Artifact 当作一次 Worker deployment。[Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| R2 Standard | 10 GB-month、100 万 Class A、1,000 万 Class B/月免费；超额为 $0.015/GB-month、$4.50/百万 A、$0.36/百万 B；公网出口免费。[R2 pricing](https://developers.cloudflare.com/r2/pricing/) | 免费额度只适用于 Standard；计费单位向上取整。Infrequent Access 没有免费额度，还有读取费和 30 天最低保存期，早期产品不应只看其较低的存储单价。 |
| Hyperdrive | Free 与 Paid 都可连接外部 PostgreSQL/MySQL；Free 100,000 条语句/日，Paid 不单独按查询收费。[Workers pricing: Hyperdrive](https://developers.cloudflare.com/workers/platform/pricing/#hyperdrive) | Free/Paid 每配置约 20/100 个源数据库连接；单条语句最长 60 秒，缓存响应最多 50 MB。[Hyperdrive limits](https://developers.cloudflare.com/hyperdrive/platform/limits/) |
| Queues | Free 10,000 operations/日、保留 24 小时；Paid 含 100 万 operations/月，超额 $0.40/百万，默认保留 4 天、可调到 14 天。通常一条小消息完成 write/read/delete 会产生 3 operations。[Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/) | 单消息 128 KB；at-least-once delivery，消费者必须幂等；Queue Consumer wall time 最长 15 分钟。[Queues limits](https://developers.cloudflare.com/queues/platform/limits/) |
| Containers | 仅 Workers Paid 可用。$5 套餐含 25 GiB-hours memory、375 vCPU-minutes、200 GB-hours disk；超额分别为 $0.0000025/GiB-second、$0.000020/vCPU-second、$0.00000007/GB-second。内存和 disk 按 provisioned 规格计费，CPU 按 active usage 计费，容器休眠后停止容器计费。[Containers pricing](https://developers.cloudflare.com/containers/pricing/) | 容器由 Worker + Durable Object 管理，请求还会产生相应平台用量；镜像必须是 `linux/amd64`，disk 默认是 ephemeral。默认无活动后休眠，下一次启动得到新 disk。[Container lifecycle](https://developers.cloudflare.com/containers/platform-details/architecture/) |
| Browser Run | Free 为 10 分钟/日；Paid 含 10 小时/月，超额 $0.09/browser-hour。Browser Sessions 含月均 10 个并发，超出为 $2/并发浏览器。[Browser Run pricing](https://developers.cloudflare.com/browser-run/pricing/) | Free 为 3 并发、每 20 秒启动 1 个；Paid 平台默认硬上限为 120 并发、每秒启动 1 个。默认空闲超时 60 秒，可延长到 10 分钟。[Browser Run limits](https://developers.cloudflare.com/browser-run/limits/) |

Cloudflare 官方支持 Hono on Workers，且 Hyperdrive 的 PostgreSQL 示例列出 `pg >= 8.13.0`、Drizzle 和其他驱动；这证明 Hono/Drizzle/PostgreSQL 的目标组合可行，但不证明本仓库的 Node 依赖集合无需修改。[Hono on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/hono/)；[Hyperdrive PostgreSQL drivers](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/)

Cloudflare Containers 已于 2026-04-13 GA，不应再按 beta 能力描述。[Containers and Sandboxes GA](https://developers.cloudflare.com/changelog/post/2026-04-13-containers-sandbox-ga/)

Hyperdrive 明确不支持 PostgreSQL advisory locks，并建议需要这些语句的应用建立第二个不经过 Hyperdrive 的 direct client。[Supported databases and features](https://developers.cloudflare.com/hyperdrive/reference/supported-databases-and-features/) 本仓库的 `GalleryRollbackCoordinator`、Gallery reconciliation、authentication email rate serialization 和 migration 都使用 `pg_advisory_*`；因此完整管理 API 不能只替换 connection string 后全部走 Hyperdrive。公开 content runtime 未使用这些 lock，可先迁；管理 API 要么为 lock 路径保留 direct client，要么先用可验证的数据库行锁/协调模型替代。

Workers 的 `nodejs_compat` 只实现 Node API 的一个子集；部分模块可导入但调用会报错。Workers 可建立 TCP/TLS 连接，但默认禁止 SMTP port 25；当前 Nodemailer transport 是否能在目标 compatibility date 和邮件供应商端口上工作，必须实测，不能由“支持 Node”推导出来。[Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)；[TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)

## Cloudflare 成本计算

### 1. 为什么 `$0/月` 不是完整 ShareSlices 的真实落点

Free 可以覆盖 Web 静态资源、少量 Worker 请求、R2 小容量、少量 Queue operations、Supabase Free 和每天 10 分钟 Browser Run，但 **Cloudflare Containers 没有免费档**，而当前 Rust Worker 是产品完整链路的一部分。Free Workers 每次只有 10 ms CPU 和 128 MB memory，也不能承载现有解包、对象写入和 Chromium 子进程。

[INFR:HI] 因而 `$0/月` 只适合 UI、只读演示或关闭后台处理能力的 preview，不是当前完整产品合同的可用部署。

### 2. 按任务休眠的 Cloudflare-first

`standard-1` Container 每月运行 30 小时：

```text
memory = 4 GiB × 30 h = 120 GiB-h
memory overage = (120 - 25) × 3600 × $0.0000025 = $0.855

disk = 8 GB × 30 h = 240 GB-h
disk overage = (240 - 200) × 3600 × $0.00000007 = $0.01008

Workers Paid + memory + disk = $5 + $0.855 + $0.01008 = $5.86508
```

[CALC:HI] 在 CPU、Durable Objects、日志、R2 和 Queue 都未超额时，Cloudflare 平台约 **$5.87/月**；若 30 小时都持续使用 `standard-1` 的 0.5 vCPU，则 CPU 为 900 vCPU-minutes，扣除 375 后再增加约 **$0.63**。因此合理预算写作 **$6–8/月**，而不是承诺 `$5` 封顶。

叠加 PostgreSQL：

| 档位 | 固定/近固定成本 | 适用性 |
| --- | ---: | --- |
| Workers Paid + Supabase Free | 约 $6–8/月 | 原型；Free 只有 500 MB DB，无自动备份，低活动 7 天可能暂停。[Supabase pricing](https://supabase.com/pricing)；[pausing](https://supabase.com/docs/guides/platform/free-project-pausing) |
| Workers Paid + Supabase Pro | 约 $31–33/月 | 低流量生产基线；Pro 从 $25/月起，含首个 Micro compute、8 GB disk 和 7 天 daily backups。[Supabase pricing](https://supabase.com/pricing) |

### 3. 把当前 Worker 原样常驻 Container

若 `standard-1` 24×7 运行：

```text
memory overage = (4 × 730 - 25) × 3600 × $0.0000025 = $26.055
disk overage = (8 × 730 - 200) × 3600 × $0.00000007 = $1.42128
Workers Paid + memory + disk = $32.47628/month
```

[CALC:HI] 这还没有计算 CPU、Durable Objects、日志和数据库。Supabase Free 时总基线约 **$32.5/月**，Supabase Pro 时约 **$57.5/月**。1 GiB/4 GB 的 `basic` 常驻约 `$12.03/月`（未含 CPU 等），但 1 GiB 是否足够同时稳定运行 Rust Worker 和 Chromium 没有压测证据。

[INFR:HI] 因此不能把“Containers 最低只要 $5”当作当前 daemon 的成本；必须先实现可休眠的任务触发模型，或接受其成本与容量风险。

### 4. `no-store` 对账单的直接影响

Workers Static Assets 的免费不限量只适用于 Web build 等真正的静态部署资产。ShareSlices 的 Preview、Viewer 和 Gallery 内容需要逐请求授权、Manifest 路径校验，并返回 `no-store`；这些请求会执行 Worker 并读取 R2。即使对象键不可变，当前产品合同未授权 Cloudflare CDN 缓存这些响应。

[INFR:HI] 低流量时 Workers/R2 免费额度仍可能覆盖它们，但成本模型必须按“每个 asset 请求 = Worker 请求 + 至少一次 R2 Class B 读”估算，不能按 CDN hit 估算。若未来要缓存，必须先变更产品和安全合同，定义 Publication/authorization 撤销、缓存 key、TTL 和失效语义。

## 推荐的 Cloudflare 改造路径

### 阶段 A：先做可移植的低成本 public profile

目标是降低成本而不改变领域合同：

1. Web build 部署到 Workers Static Assets；Preview 文档仍保持 `no-store`，不要让 `run_worker_first` 无意扩大动态请求量。
   - 新增 gateway Worker，完整复刻当前 Caddy 的分流合同：拒绝 `/internal/*`；把 `/api/*`、`/a/*`、`/gallery/{slug}/download`、请求 JSON 的 `/gallery` 与 `/gallery/*`、`/gallery-media/*`、`/health`、`/ready` 代理到 Node API origin；其余请求交给 Static Assets 和 SPA fallback；Preview 文档继续返回 `no-store`。若 Viewer 使用独立 host，同一份路由合同还要按 host 拆分验证。
   - 验证 `Cookie`、`Set-Cookie`、origin/host、CSRF/CORS、流式 upload/export 和错误响应在代理前后不变。现有 Web 依赖同源 `/api`，不能改成跨域 API 后只靠宽松 CORS 补救。
2. 为现有 S3 Adapter 增加 R2 deployment profile 配置和兼容性测试，并保持 bucket private；浏览器仍不能拿到 bucket URL 或签名下载 URL。
3. 首阶段保留当前经 API 流式上传的 50 MiB 默认合同；它低于 Workers Free/Pro 的 100 MB 入站请求体上限，但仍需验证 gateway 不缓冲请求体。只有在产品上调上限、实测代理成为瓶颈，或需要断点续传时，再改为经 API 授权后的 multipart 直传 R2。该变化涉及持久 upload session 与 HTTP contract，届时必须走 OpenSpec 并同步 OpenAPI。
4. Node API、PostgreSQL、Rust Worker 和 Chromium 暂留通用容器主机；先记录每次 Upload 的 CPU、peak RSS、临时磁盘、处理秒数、thumbnail 秒数和对象操作数。
5. 用独立 registrable site 承载不可信内容。Cloudflare DNS、反向代理或一个 sibling subdomain 本身不能替代 Gallery eligibility 所要求的站点边界。

[INFR:MD] 一个可降低第二域名固定成本的候选是：管理 Web 使用自定义域，内容代理保留在独立 Worker 的 `workers.dev` URL。它看起来能形成与管理域不同的浏览器站点，但目前没有针对 ShareSlices 实际 URL、cookie、Public Suffix、响应头和 topology validator 的验证证据；必须用浏览器探针和 live eligibility/readiness 实测，未通过前不能宣称 Gallery-eligible。最稳妥的生产基线仍是第二个明确独立的 registrable domain。

### 阶段 B：先迁公开内容运行面，不先迁管理 API

`api/src/content/app.ts` 已经是薄 Hono app，适合新增 Workers entrypoint，并分别实现：

- PostgreSQL credential/Manifest lookup → `pg` + Hyperdrive Adapter；
- S3 stream → R2 binding Adapter；
- 保留 `Cache-Control: no-store`、`Referrer-Policy`、CSP、Permissions Policy、path normalization 和日志脱敏；
- 自定义域绑定到内容专用 registrable site，且不设置/转发管理 cookie。

[INFR:HI] 这是最有价值的第一段代码迁移：它把高 fan-out 的 Artifact asset bytes 留在 Cloudflare/R2，避免 Railway/Render 的公网 egress，同时修改范围小于把整个管理 API 搬入 Workers。它仍需对每个请求收费和执行鉴权，不依赖 CDN cache。

该阶段只迁没有 advisory lock 的 content lookup。管理 API 的 lock-heavy 路径继续使用原 Node/direct PostgreSQL 连接，不能经 Hyperdrive 透明代理。

### 阶段 C：把后台处理改为“数据库权威 + Queue 唤醒”

不要让 Cloudflare Queue 取代 PostgreSQL 的 durable job contract。推荐链路：

```text
API transaction
  ├─ 写 processing/thumbnail job 与 attempt 状态
  └─ 写 outbox 事件
          ↓
outbox dispatcher → Cloudflare Queue → Queue Consumer
                                          ↓
                                唤醒 Container，处理有限批次
                                          ↓
                             PostgreSQL claim/lease/heartbeat/commit
                                          ↓
                                  无待处理任务后主动退出
```

Queue 是 at-least-once delivery，消息只能放 job ID/attempt ID 等小型非敏感引用；重复消息继续由当前 claim/lease/idempotency 语义消解。outbox 避免“数据库提交成功但消息发送失败”的双写窗口；周期 reconciliation 继续负责漏信号恢复。

API 中的 1 秒邮件 dispatcher 和 30 秒 reconciliation 也必须拆出：邮件改为 Queue/Cron 驱动的短任务，reconciliation 改为 Scheduled Worker、独立短时 release/operations job，或保留在常驻容器。仅改 Rust Worker 仍不能让整个后端 scale to zero。

为了让 cost model 成立，应增加并验证：

- Container 冷启动到可 claim 的 p50/p95；
- 每次唤醒的最大 job 数、最大运行时间与空队列退出条件；
- 进程收到 SIGTERM 后在 15 分钟 grace period 内停止 claim、归还或续租状态；
- 临时 disk 不承载 durable state，所有 attempt 结果在 PostgreSQL/R2；
- Queue 保留期耗尽或消息丢失时，reconciliation 仍能发现数据库中的待处理 job；
- 预算告警和 Worker CPU limit，防止 denial-of-wallet。

### 阶段 D：谨慎评估 Browser Run，再决定是否移除自带 Chromium

Browser Run 的价格很低，但不是现有 Chromium 的无风险替换：

- 当前 ADR 使用非公开、单 Version、single-use capture route；远程 Browser Run 需要能够访问该 route，不能为省钱把它变成普通公开 Viewer URL。
- 必须验证请求拦截确实阻止 Artifact 外部网络、字体一致、viewport/animation 抑制、10 秒 deadline、800×450 WebP 和 renderer revision 语义。
- Browser Run 会滚动升级浏览器；现有镜像固定 Chromium 版本。迁移后必须用新的 renderer revision，不能让旧 Version 的 immutable thumbnail 身份指向不同渲染器。

[INFR:MD] 若这些安全与视觉回归通过，Browser Run 可让 Rust Container 去掉 Chromium 与字体包，降低内存和镜像成本；在验证前，保留现有 Chromium Container 更符合 ADR 0004。

### 阶段 E：最后再决定管理 API 是否进入 Workers

管理 API 的 Hono 路由不是主要障碍，障碍是运行时和 I/O Adapter：

- `@hono/node-server` entrypoint 需改为 Worker fetch handler；
- `node-postgres` 改经 Hyperdrive，并验证事务、prepared statements、advisory locks、60 秒 query limit 和连接池；
- 使用 advisory lock 的事务不能经 Hyperdrive；必须路由到 direct client，或在单独的合同变更中移除该依赖；
- Node `Readable`、Busboy、Archiver、AWS SDK multipart 与临时文件路径需改成 Web Streams/R2-native 实现；
- Nodemailer/SMTP 需做 compatibility spike，或改成 HTTP/Workers email Adapter；
- migration 不能在请求时执行，应成为独立 release job；
- 1 秒 authentication-email dispatcher 与 30 秒 reconciliation loop 必须移出 HTTP isolate；
- 128 MB isolate memory 下必须保持真正 streaming，不能把 archive 或 export 收集到 Buffer。

[INFR:HI] 在这些工作完成前，管理 API 留在廉价容器主机更稳；只迁 content data plane 已能获得 Cloudflare 的主要带宽优势。

## 可行替代组合

### 方案 1：Hetzner CX33 + R2（最低固定费用、最低改造量）

#### Hetzner 官方事实

- 2026-06-15 后欧洲 CX33 为 4 shared vCPU、8 GB RAM、80 GB SSD，$9.99/月（不含 IPv4、税）。[Hetzner 价格调整](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/)；[实例规格](https://www.hetzner.com/cloud/cost-optimized/)
- Cloud Primary IPv4 为 $0.60/月；Server Backups 为服务器价格的 20%，提供 7 个 backup slots。[IP pricing](https://docs.hetzner.com/general/infrastructure-and-availability/ipv4-pricing/)；[Cloud billing FAQ](https://docs.hetzner.com/cloud/billing/faq/)
- 每台 CX33 含 20 TB traffic；shared CPU 适合低到中等 CPU 使用，不承诺 dedicated CPU 的稳定性能。[European Cloud](https://www.hetzner.com/european-cloud)；[server FAQ](https://docs.hetzner.com/cloud/servers/faq/)
- Hetzner Object Storage 另有 $5.99/月基础价，含 1 TB storage 与 1 TB egress，S3 operations 免费；R2 小于 10 GB 时通常固定费用更低。[Hetzner Object Storage](https://docs.hetzner.com/storage/object-storage/overview/)

#### Hetzner 成本计算

```text
CX33 $9.99 + IPv4 $0.60 = $10.59/month
7-slot server backups = $9.99 × 20% = $2.00/month
total = $12.59/month, before tax
```

[CALC:HI] 若 R2 在免费额度内，固定成本约 `$12.59/月`。若改用 Hetzner Object Storage，总固定成本约 `$18.58/月`，换取 1 TB 对象容量与 1 TB egress 配额。

#### Hetzner 适配与陷阱

- 现有 Docker Compose/镜像最接近该目标；Node、Rust、Chromium 和 PostgreSQL 无需运行时迁移。
- PostgreSQL、API、Worker 在同一 VM 是单故障域。Server Backup 不等于 PostgreSQL PITR，也不能替代定期 `pg_dump`、R2 异地副本和恢复演练。
- 需要自行维护 OS、安全更新、Docker、监控、备份、证书和故障恢复；Hetzner 的 DPA 也明确 Cloud Server 的维护与安全责任由客户承担。
- Gallery 仍需第二 registrable site 和独立 content ingress；“同一 VM”可以是基础设施实现，但不能让管理 cookie、路由或操作泄漏到 content runtime。

**判断**：适合单维护者、早期低流量、能接受单机恢复而非高可用的产品；是最便宜且最少改代码的完整方案。

### 方案 2：Railway Hobby + Railway Postgres + R2（最佳低成本 PaaS）

#### Railway 官方事实

- Hobby 最低 $5/月且包含前 $5 usage；超过后总账单等于实际 usage。Free 只有 $1/月资源 credit，单服务最多 0.5 GB RAM。[Railway plans](https://docs.railway.com/pricing/plans/)
- 资源单价为 RAM $10/GB-month、CPU $20/vCPU-month、egress $0.05/GB、volume $0.15/GB-month，按分钟计费。[Railway pricing](https://docs.railway.com/pricing)
- Railway PostgreSQL 是基于官方 PostgreSQL image 的模板服务；volume 可做 daily/weekly/monthly backup，增量占用按 volume 单价计费。[PostgreSQL](https://docs.railway.com/databases/postgresql)；[backups](https://docs.railway.com/volumes/backups)
- Serverless 可以让无活动服务睡眠，但当前 Rust Worker 通过数据库持续 claim，不满足“无活动 Web service”模型，不能先假设会自动降到零。

#### Railway 成本估算

| 服务 | 低流量月均资源假设 | 月费 |
| --- | --- | ---: |
| Node API + content | 0.25 GB RAM + 0.05 vCPU | $3.50 |
| Rust/Chromium Worker | 1–2 GB RAM + 0.10 vCPU | $12–22 |
| PostgreSQL | 0.5 GB RAM + 0.05 vCPU + 5 GB volume | $6.75 |
| 合计 | 未含公网 egress 与 backup 增量 | $22.25–32.25 |

[CALC:MD] 加上低量 egress、backup 和波动，建议预算 **$22–35/月**。这是基于资源假设的估算，不是 Railway 套餐报价；必须用一周实测的 peak/average memory 与 CPU 校准。

#### Railway 适配与陷阱

- 可直接运行当前 Node 与 Rust Docker image，私网连接 PostgreSQL，改造量小于 Workers。
- Railway Postgres 是容器模板，不应表述为具有独立托管数据库 SLA 的产品；备份需显式配置并付 storage usage。
- 若 Viewer bytes 从 Railway API 输出，超过套餐 usage 后会按 `$0.05/GB` 收 egress；把 content runtime 迁到 Cloudflare Worker + R2 可消除这部分 Railway 出口。
- Free `$1` credit、0.5 GB/service 对 Chromium Worker 与 always-on PostgreSQL 不现实；Hobby `$5` 是最低承诺，不是该拓扑的真实总价。

**判断**：适合希望减少服务器运维、接受 usage-based 月费、仍想原样运行 Docker 的团队。

### 方案 3：Render Static Site + Web Service + Background Worker + Postgres + R2（费用可预测）

#### Render 官方事实

- Static Site 为 $0；Starter service 为 512 MB/0.5 CPU、$7/月，Standard 为 2 GB/1 CPU、$25/月。Background Worker 支持持续后台任务和 Docker。[Render pricing](https://render.com/pricing)；[service types](https://render.com/docs/service-types)
- Render Postgres Basic-256mb 为 $6/月，Basic-1gb 为 $19/月；paid database 有 PITR，Hobby workspace 的 recovery window 为 3 天。[Render pricing](https://render.com/pricing)；[Postgres backups](https://render.com/docs/postgresql-backups)
- Hobby workspace 含 5 GB bandwidth，之后 $0.15/GB。[Render pricing](https://render.com/pricing)
- Free web service 空闲 15 分钟后休眠，恢复约一分钟；Free Postgres 30 天到期、无 backup；Background Worker 没有 Free instance。[Render Free](https://render.com/docs/free)

#### Render 成本计算

| 组件 | 最小选择 | 固定月费 |
| --- | --- | ---: |
| Web | Static Site | $0 |
| API/content | Starter 512 MB | $7 |
| Rust/Chromium Worker | Standard 2 GB | $25 |
| PostgreSQL | Basic-256mb / Basic-1gb | $6 / $19 |
| 合计 | 未含 egress、R2 overage | **$38 / $51** |

[INFR:MD] 2 GB Worker 是对 Chromium 的保守起点，不是压测结论；若 512 MB Worker 和 256 MB PostgreSQL 实测稳定，最低可再降，但不应先把它作为生产承诺。

#### Render 适配与陷阱

- 当前 Web、API、Background Worker、Postgres 的进程形状与 Render service types 直接对应，迁移简单、月费直观。
- 512 MB API 可能在 multipart/export 高峰不足；若 API 也升 Standard，固定成本再增加 $18/月。
- 5 GB 之后 `$0.15/GB` 的出口明显高于 Railway，且当前 Viewer `no-store` 不能靠 Render edge cache 规避；建议同样把 content runtime 放 Cloudflare Worker + R2。
- Free Web + Free Postgres 组合不是持久部署：一个冷启动，一个 30 天到期且无备份，后台 Worker 还没有 Free 档。

**判断**：适合重视固定价、部署体验和内建 PITR，且可接受比 Railway/Hetzner 更高基线的团队。

## 横向比较

| 方案 | 早期完整拓扑月费 | 固定/用量结构 | 代码改造 | 运维负担 | 最大陷阱 |
| --- | ---: | --- | --- | --- | --- |
| Cloudflare-first + Supabase Free | 约 $6–8 | $5 固定 + Container/DO/R2/Queue 用量 | 高 | 中 | DB 会暂停且无自动备份；必须让 Container 休眠 |
| Cloudflare-first + Supabase Pro | 约 $31–33 | $30 固定 + 用量 | 高 | 低到中 | Node/stream/email/worker 都需适配，不能假设 Viewer cache |
| Hetzner CX33 + R2 + local PG | $12.59 含 server backup | 基本固定 | 低 | 高 | 单机故障域；backup 不等于 PITR |
| Railway + R2 | 估算 $22–35 | $5 最低承诺，实际按资源 | 低 | 中低 | Chromium RAM 与常驻 DB 让 `$5` 宣传价失真 |
| Render + R2 | $38–51 | 固定 instance 为主 | 低 | 低 | Free PG 30 天到期；5 GB 后 egress $0.15/GB |

上表的“完整拓扑”指保留 Node API、PostgreSQL、Rust processing 和 thumbnail 能力；不包含 Gallery 治理依赖是否全部 ready，也不包含邮件、域名和外部身份供应商费用。

## 决策建议

### 推荐 1：先交付混合部署，不以 Cloudflare-only 为验收标准

首个低成本目标应是：

```text
Cloudflare Workers Static Assets  → Web build
Cloudflare R2 private bucket      → Artifact/thumbnail objects
Hetzner CX33 或 Railway            → Node API + Rust/Chromium Worker
PostgreSQL                         → 同机（最低成本）或 Supabase Pro（更少 DB 运维）
独立 content registrable site     → content runtime，后续迁到 Worker
```

它同时保留 S3/PostgreSQL/容器可移植性。Cloudflare 是一个优先优化的 public profile，而不是侵入领域层的强制依赖。

### 推荐 2：以“公开内容运行面”作为第一段 Cloudflare 代码改造

这段服务已经有 Hono app + Adapter seam，R2/Hyperdrive 与其职责匹配；它还能把大量小 asset response 留在 Cloudflare 网络。成功标准不是 cache hit，而是：每次请求仍完成 authorization 与 Manifest validation、`no-store` 头保持、R2 bucket 私有、管理 cookie 不进入 content site、未知/失效 credential 返回合同规定的结果。

### 推荐 3：只有在 worker harness 证明能 scale to zero 后，才承诺 `$6–8/月` Cloudflare 运行费

先构建可重复的成本 harness，输入一组真实 ZIP/7z/RAR/native HTML 样本，输出：

- 每个 Upload 的 expanded bytes、file count、CPU seconds、wall seconds、peak RSS、temporary disk peak；
- R2 Class A/B operations 与 bytes；
- thumbnail browser seconds、失败/重试次数；
- Container wake cold start、active minutes、empty wake ratio；
- 每个 Viewer session 的 asset count 和 Worker/R2 reads（不使用 cache 假设）。

用 7 天 shadow/预生产数据外推 730 小时账单，再决定 Container instance type、sleep timeout 和是否迁 Browser Run。

## 实施前的 Go/No-Go 条件

| 条件 | Go 标准 |
| --- | --- |
| R2 兼容 | 当前 AWS SDK 与 Rust S3 client 的 PUT/GET/HEAD/multipart、metadata、range、delete 全部通过 contract test |
| 直接上传 | 断点续传、过期 part、重复 complete、配额预留、失败清理和 OpenAPI contract 完成 |
| Content Worker | 鉴权、Manifest-only path、响应头、日志脱敏、R2 stream 和 Hyperdrive 断连回退通过 |
| PostgreSQL | advisory locks、prepared statements、事务、lease heartbeat、migration 与连接上限通过；不使用未经验证的 transaction pooler 模式 |
| Edge gateway | 同源 `/api`、Cookie/Set-Cookie、Preview `no-store`、streaming upload/export、SPA fallback 与现有 Caddy 行为一致 |
| Queue/Container | 重复、乱序、过期、漏信号、冷启动、SIGTERM 和 reconciliation 测试通过 |
| Thumbnail | renderer revision 更新；网络阻断、字体、尺寸、deadline、WebP 与旧实现对比通过 |
| 安全拓扑 | content 使用独立 registrable site，bucket private，管理 cookie/操作不可达，Gallery live eligibility gate 通过 |
| 成本 | 7 天实测外推值在预算内，并为 R2 ops、日志、CPU、egress 和重试设置告警 |

任何一个 Go 条件失败，都应退回“Cloudflare Static Assets/R2 + 通用容器主机”的混合方案，而不是为了 Cloudflare-only 改弱现有安全或一致性合同。

## 来源索引

### Cloudflare

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Static Assets billing and limitations](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Hyperdrive limits](https://developers.cloudflare.com/hyperdrive/platform/limits/)
- [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/)
- [Queues limits](https://developers.cloudflare.com/queues/platform/limits/)
- [Containers pricing](https://developers.cloudflare.com/containers/pricing/)
- [Container lifecycle](https://developers.cloudflare.com/containers/platform-details/architecture/)
- [Browser Run pricing](https://developers.cloudflare.com/browser-run/pricing/)
- [Browser Run limits](https://developers.cloudflare.com/browser-run/limits/)
- [Node.js compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)
- [TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)

### PostgreSQL 与替代主机

- [Supabase pricing](https://supabase.com/pricing)
- [Supabase Free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
- [Railway pricing plans](https://docs.railway.com/pricing/plans/)
- [Railway resource pricing](https://docs.railway.com/pricing)
- [Railway PostgreSQL](https://docs.railway.com/databases/postgresql)
- [Railway volume backups](https://docs.railway.com/volumes/backups)
- [Render pricing](https://render.com/pricing)
- [Render Free limitations](https://render.com/docs/free)
- [Render Postgres backups](https://render.com/docs/postgresql-backups)
- [Hetzner 2026-06-15 price adjustment](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/)
- [Hetzner Cloud instance specifications](https://www.hetzner.com/cloud/cost-optimized/)
- [Hetzner IP pricing](https://docs.hetzner.com/general/infrastructure-and-availability/ipv4-pricing/)
- [Hetzner Cloud billing and backups](https://docs.hetzner.com/cloud/billing/faq/)
- [Hetzner Object Storage](https://docs.hetzner.com/storage/object-storage/overview/)
