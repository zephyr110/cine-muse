/**
 * Cine Muse 本地后端服务
 * - 认证（注册/登录/登出/找回/修改密码）：服务端 scrypt 哈希 + token 会话
 * - /api/state：AppState 全量读写（前端防抖推送）
 * - 仅监听 127.0.0.1，不暴露局域网；无服务时前端回退 localStorage
 * - 启动方式：Electron 主进程内嵌 require + listen；独立运行 `node server/index.js`
 */

const crypto = require("node:crypto")
const express = require("express")
const cors = require("cors")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const multer = require("multer")
const { randomUUID } = require("node:crypto")

const db = require("./db")

const { scrypt, randomBytes, timingSafeEqual } = crypto
const scryptAsync = require("node:util").promisify(scrypt)

const DEFAULT_PORT = 47832

// 资产上传：主流格式白名单（扩展名 + MIME 双重校验），单文件上限 50MB
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
const FILE_TYPE_RULES = {
  image: {
    exts: [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg", ".avif", ".bmp"],
    mimes: ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml", "image/avif", "image/bmp"],
  },
  video: {
    exts: [".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v"],
    mimes: ["video/mp4", "video/webm", "video/quicktime", "video/x-matroska", "video/x-msvideo", "video/x-m4v"],
  },
  audio: {
    exts: [".mp3", ".wav", ".flac", ".aac", ".ogg", ".m4a"],
    mimes: ["audio/mpeg", "audio/wav", "audio/flac", "audio/aac", "audio/ogg", "audio/mp4"],
  },
}
const EXT_TO_KIND = {}
for (const [kind, rule] of Object.entries(FILE_TYPE_RULES)) {
  for (const ext of rule.exts) EXT_TO_KIND[ext] = kind
}

// scrypt 参数显式锁定（N=16384/r=8/p=1 即当前 Node 默认值）：显式传入防止 Node
// 未来调整默认参数导致存量哈希全部无法校验（哈希不随参数迁移）。
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 }

async function hashPassword(password, salt) {
  const buf = await scryptAsync(password, salt, 64, SCRYPT_OPTS)
  return buf.toString("hex")
}

// 账号不存在时也执行一次 scrypt 假校验：抹平「账号不存在」与「密码错误」的响应时长差异
const DUMMY_SALT = "00000000000000000000000000000000"
const DUMMY_HASH = "0".repeat(128)

async function verifyPassword(password, salt, storedHex) {
  const candidate = await hashPassword(password, salt)
  const stored = Buffer.from(storedHex, "hex")
  const attempt = Buffer.from(candidate, "hex")
  return stored.length === attempt.length && stored.length > 0 && timingSafeEqual(stored, attempt)
}

function newSalt() {
  return randomBytes(16).toString("hex")
}

function newToken() {
  return randomBytes(32).toString("hex")
}

function isValidEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

function uid(prefix) {
  return `${prefix}_${randomUUID().slice(0, 13)}`
}

/** 启动服务；返回 http.Server（Electron 主进程在 app.quit 时 close）
 *
 * staticDir：Next 静态导出目录（out/）。传入后本服务同时充当渲染层的同源站点 —— 这是
 * 桌面端取代 file:// 的关键：`/models/*.glb`、`/_next/*` 等根绝对路径在 file:// 下会解析成
 * `file:///...` 而 404（静默回退程序化人偶），同源 http 下则天然正确。
 * 不传（独立运行 `node server/index.js`）时保持纯 API 服务。
 */
function startServer({ port = DEFAULT_PORT, dbPath, staticDir, onReady, onError } = {}) {
  try {
    db.initDb(dbPath)
  } catch (err) {
    // 数据库不可用（磁盘损坏/权限）不阻止 HTTP 服务启动：db 层每个访问器都对 sqlite === null
    // 有容错（loadStateJson → null，于是 /api/state 404，渲染层回退 localStorage；saveStateJson
    // → false，由调用方如实上报）。静态站点照常提供，界面起得来且不会静默覆盖 —— 桌面端
    // loadURL 依赖本服务，若在此抛出则界面根本无从加载。
    console.error("[cine-server] initDb failed, serving without persistence:", err)
  }

  const app = express()

  // 本机服务安全边界：仅放行 Electron 渲染层（file://，Origin: null）与本地开发页面
  // 任意公网网页的 fetch 一律 403（防恶意页面读写状态 / 重置密码）
  app.use((req, res, next) => {
    const host = req.headers.host
    if (!host || !/^127\.0\.0\.1(?::\d+)?$/.test(host)) {
      return res.status(403).json({ error: "forbidden host" })
    }
    const origin = req.headers.origin
    if (origin && origin !== "null" && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return res.status(403).json({ error: "forbidden origin" })
    }
    next()
  })
  app.use(cors())
  app.use(express.json({ limit: "20mb" }))
  // 畸形 JSON / 超限 body：返回结构化 400 而非 Express 默认 HTML 500
  app.use((err, _req, res, _next) => {
    res.status(400).json({ error: "请求体不是合法 JSON" })
  })

  /* ---------- 健康检查 ---------- */

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, mode: "local-backend" })
  })

  /* ---------- 认证 ---------- */

  // 注册（成功后自动登录，返回 token）
  app.post("/api/auth/register", async (req, res) => {
    const { email, name, password } = req.body ?? {}
    const em = typeof email === "string" ? email.trim().toLowerCase() : ""
    if (!isValidEmail(em)) return res.status(400).json({ error: "邮箱格式无效" })
    if (typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ error: "密码至少需要 6 位" })
    }
    if (db.findAccount(em)) return res.status(409).json({ error: "该账号已注册" })

    const salt = newSalt()
    const passwordHash = await hashPassword(password, salt)
    const now = new Date().toISOString()
    db.insertAccount({
      id: uid("acc"),
      email: em,
      name: (name ?? "").trim() || em.split("@")[0],
      passwordHash,
      salt,
      createdAt: now,
    })
    const token = newToken()
    db.createSession(token, em, now)
    const acc = db.findAccount(em)
    res.json({ token, email: acc.email, name: acc.name })
  })

  // 登录
  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body ?? {}
    const em = typeof email === "string" ? email.trim().toLowerCase() : ""
    const acc = db.findAccount(em)
    if (typeof password !== "string") return res.status(401).json({ error: "账号或密码不正确" })
    // 账号不存在时对固定假哈希执行同成本校验：抹平时序侧信道
    const ok = await verifyPassword(password, acc?.salt ?? DUMMY_SALT, acc?.password_hash ?? DUMMY_HASH)
    if (!ok || !acc) return res.status(401).json({ error: "账号或密码不正确" })

    const token = newToken()
    db.createSession(token, em, new Date().toISOString())
    res.json({ token, email: acc.email, name: acc.name })
  })

  // 登出（使 token 失效）
  app.post("/api/auth/logout", (req, res) => {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "")
    if (token) db.deleteSession(token)
    res.json({ ok: true })
  })

  // 会话恢复（刷新页面用）
  app.get("/api/auth/me", (req, res) => {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "")
    const session = token ? db.findSession(token) : undefined
    if (!session) return res.status(401).json({ error: "未登录" })
    const acc = db.findAccount(session.email)
    if (!acc) return res.status(401).json({ error: "账号不存在" })
    res.json({ email: acc.email, name: acc.name })
  })

  // 找回密码 · 步骤 1：验证账号存在
  app.post("/api/auth/verify-account", (req, res) => {
    const { email } = req.body ?? {}
    const em = typeof email === "string" ? email.trim().toLowerCase() : ""
    if (!db.findAccount(em)) return res.status(404).json({ error: "该账号不存在" })
    res.json({ ok: true })
  })

  // 找回密码 · 步骤 2：设置新密码（演示环境不发邮件，验证账号后直接重置）
  app.post("/api/auth/reset-password", async (req, res) => {
    const { email, password } = req.body ?? {}
    const em = typeof email === "string" ? email.trim().toLowerCase() : ""
    if (!db.findAccount(em)) return res.status(404).json({ error: "该账号不存在" })
    if (typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ error: "密码至少需要 6 位" })
    }
    const salt = newSalt()
    db.updatePassword(em, await hashPassword(password, salt), salt)
    db.deleteSessionsByEmail(em)
    res.json({ ok: true })
  })

  // 修改密码（需登录 + 旧密码）
  app.post("/api/auth/change-password", async (req, res) => {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "")
    const session = token ? db.findSession(token) : undefined
    if (!session) return res.status(401).json({ error: "未登录" })
    const acc = db.findAccount(session.email)
    if (!acc) return res.status(401).json({ error: "账号不存在" })

    const { oldPassword, newPassword } = req.body ?? {}
    if (typeof oldPassword !== "string") return res.status(400).json({ error: "缺少当前密码" })
    if (typeof newPassword !== "string" || newPassword.length < 6) {
      return res.status(400).json({ error: "新密码至少需要 6 位" })
    }
    const ok = await verifyPassword(oldPassword, acc.salt, acc.password_hash)
    if (!ok) return res.status(400).json({ error: "当前密码不正确" })

    const salt = newSalt()
    db.updatePassword(session.email, await hashPassword(newPassword, salt), salt)
    // 改密后吊销该账号其他会话（保留当前 token），防止旧 token 继续有效
    db.deleteSessionsByEmail(session.email, token)
    res.json({ ok: true })
  })

  /* ---------- 资产文件上传 ---------- */

  const dbFile = dbPath ?? path.join(os.homedir(), ".cine-muse", "cine-muse.db")
  const uploadsDir = path.join(path.dirname(dbFile), "uploads")
  // 与 initDb 同理：数据目录不可用不该让整个服务起不来（桌面端界面依赖本服务 listen）。
  // 建不出来就跳过 /uploads 静态服务，上传接口在真正落盘时再如实报错。
  let uploadsReady = true
  try {
    fs.mkdirSync(uploadsDir, { recursive: true })
  } catch (err) {
    uploadsReady = false
    console.error("[cine-server] uploads dir unavailable, asset uploads disabled:", err)
  }

  // 已上传文件静态服务（路径穿越由 express.static 防护；仅本机可访问）
  if (uploadsReady) {
    app.use("/uploads", express.static(uploadsDir, { maxAge: "7d", fallthrough: false, index: false }))
  }

  // multer.diskStorage 构造时就会 mkdirp(destination)，目录建不出来会直接抛出 —— 同样不能让
  // 它带倒整个服务。uploadsReady 为假时置空，上传接口另给 503。
  const upload = uploadsReady
    ? multer({
        storage: multer.diskStorage({
          destination: uploadsDir,
          filename: (_req, file, cb) => {
            const ext = path.extname(file.originalname).toLowerCase()
            cb(null, `${randomUUID().slice(0, 13)}${ext}`)
          },
        }),
        limits: { fileSize: MAX_UPLOAD_BYTES },
        fileFilter: (_req, file, cb) => {
          const ext = path.extname(file.originalname).toLowerCase()
          const rule = FILE_TYPE_RULES[EXT_TO_KIND[ext]]
          if (!rule || !rule.mimes.includes(file.mimetype)) {
            return cb(new Error("仅支持主流图片 / 视频 / 音频格式"))
          }
          cb(null, true)
        },
      })
    : null

  // 上传：multipart/form-data，字段名 file；返回相对 url（前端拼接 API_URL）
  app.post("/api/assets/upload", (req, res) => {
    if (!upload) return res.status(503).json({ error: "上传目录不可用，无法保存文件" })
    upload.single("file")(req, res, (err) => {
      if (err) {
        const msg = err.code === "LIMIT_FILE_SIZE" ? `文件超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB 上限` : err.message || "上传失败"
        return res.status(400).json({ error: msg })
      }
      const f = req.file
      if (!f) return res.status(400).json({ error: "缺少文件字段 file" })
      const kind = EXT_TO_KIND[path.extname(f.originalname).toLowerCase()]
      res.json({
        url: `/uploads/${f.filename}`,
        kind,
        mimeType: f.mimetype,
        size: f.size,
        name: f.originalname,
      })
    })
  })

  // 删除已上传文件（仅限 uploads 目录内的合法文件名）
  app.delete("/api/uploads/:name", (req, res) => {
    const name = path.basename(req.params.name)
    const ext = path.extname(name).toLowerCase()
    if (!EXT_TO_KIND[ext] || name !== req.params.name) {
      return res.status(400).json({ error: "非法文件名" })
    }
    fs.unlink(path.join(uploadsDir, name), (err) => {
      if (err) return res.status(404).json({ error: "文件不存在" })
      res.json({ ok: true })
    })
  })

  /* ---------- AppState ---------- */

  app.get("/api/state", (_req, res) => {
    const json = db.loadStateJson()
    if (json == null) return res.status(404).json({ error: "no state" })
    res.type("application/json").send(json)
  })

  app.put("/api/state", (req, res) => {
    if (typeof req.body !== "object" || req.body == null || Array.isArray(req.body)) {
      return res.status(400).json({ error: "body 必须是 JSON 对象" })
    }
    db.saveStateJson(JSON.stringify(req.body))
    res.json({ ok: true })
  })

  /* ---------- 静态导出（桌面端同源站点） ---------- */

  // 注册在全部 /api 路由之后：`out/` 下没有 api 目录，但按序注册可保证 API 永远优先命中。
  if (staticDir) {
    const root = path.resolve(staticDir)
    const indexHtml = path.join(root, "index.html")
    if (fs.existsSync(indexHtml)) {
      // redirect:true 把 `/dashboard` 补成 `/dashboard/`，与 trailingSlash 导出的目录式路由一致
      app.use(express.static(root, { index: "index.html", fallthrough: true, redirect: true }))
      const notFoundHtml = path.join(root, "404.html")
      const has404 = fs.existsSync(notFoundHtml)
      // 未命中的 GET/HEAD 回落到导出的 404 页（存在时），其余交给 Express 默认 404
      app.use((req, res, next) => {
        if (!has404 || (req.method !== "GET" && req.method !== "HEAD")) return next()
        res.status(404).sendFile(notFoundHtml)
      })
      console.log(`[cine-server] serving static export from ${root}`)
    } else {
      // 未构建时只跳过静态站点，API 仍可用 —— 不因此让整个后端起不来
      console.warn(`[cine-server] staticDir 下缺少 index.html，跳过静态站点：${root}`)
    }
  }

  const server = app.listen(port, "127.0.0.1", () => {
    // 取实际绑定端口而非入参：传 0 时由内核分配，入参 0 不是可连接的端口
    const actual = server.address()?.port ?? port
    console.log(`[cine-server] listening on http://127.0.0.1:${actual}`)
    onReady?.(actual)
  })
  server.on("error", (err) => {
    console.error(`[cine-server] listen failed on ${port}:`, err.code ?? err.message)
    onError?.(err)
  })
  return server
}

/* 独立运行：node server/index.js [port] */
if (require.main === module) {
  const port = Number(process.argv[2] ?? process.env.CINE_SERVER_PORT ?? DEFAULT_PORT)
  // CINE_DB_PATH 与 Electron 内嵌模式共用同一 db 文件（默认 ~/.cine-muse/cine-muse.db）
  startServer({ port, dbPath: process.env.CINE_DB_PATH })
}

module.exports = { startServer, DEFAULT_PORT }
