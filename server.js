"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Core = require("./assets/core");

function createServer({
  dataFile = path.join(__dirname, "data", "items.json"),
} = {}) {
  // 数据损坏时启动失败，绝不静默清空或覆盖。
  let items = fs.existsSync(dataFile)
    ? Core.parseItems(fs.readFileSync(dataFile, "utf8"))
    : [];
  const publicFiles = {
    "/": "index.html",
    "/index.html": "index.html",
    "/assets/style.css": "assets/style.css",
    "/assets/core.js": "assets/core.js",
    "/assets/app.js": "assets/app.js",
  };
  const types = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
  };
  function persist(next) {
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    const temp = dataFile + ".tmp";
    try {
      fs.writeFileSync(temp, JSON.stringify(next, null, 2), { mode: 0o600 });
      fs.renameSync(temp, dataFile);
    } catch (error) {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
      throw error;
    }
    items = next;
  }
  function json(res, status, body) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
    });
    res.end(JSON.stringify(body));
  }
  function owner(req) {
    const token = req.headers["x-publisher-token"];
    return typeof token === "string" && /^[a-f0-9]{64}$/.test(token)
      ? crypto.createHash("sha256").update(token).digest("hex")
      : "";
  }
  function exposed(item, identity) {
    const { ownerId, ...data } = item;
    return { ...data, isOwner: Boolean(identity && identity === ownerId) };
  }
  async function body(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 16384) {
        const error = new Error("请求过大");
        error.status = 413;
        throw error;
      }
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
      const error = new Error("JSON 格式无效");
      error.status = 400;
      throw error;
    }
  }
  return http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method === "GET" && publicFiles[url.pathname]) {
        const filename = publicFiles[url.pathname];
        res.writeHead(200, {
          "Content-Type": types[path.extname(filename)] + "; charset=utf-8",
        });
        res.end(fs.readFileSync(path.join(__dirname, filename)));
        return;
      }
      const identity = owner(req);
      if (req.method === "GET" && url.pathname === "/api/items") {
        json(
          res,
          200,
          Core.newest(items).map((item) => exposed(item, identity)),
        );
        return;
      }
      const mutation = req.method === "POST" || req.method === "PATCH";
      if (mutation) {
        if (!identity) {
          json(res, 401, { error: "发布者身份无效" });
          return;
        }
        // 不启用跨域访问；额外拒绝浏览器发出的跨站写入。
        if (
          req.headers.origin &&
          req.headers.origin !== "http://" + req.headers.host &&
          req.headers.origin !== "https://" + req.headers.host
        ) {
          json(res, 403, { error: "不允许跨站写入" });
          return;
        }
        if (
          !(req.headers["content-type"] || "").startsWith("application/json")
        ) {
          json(res, 415, { error: "请使用 JSON 请求" });
          return;
        }
      }
      if (req.method === "POST" && url.pathname === "/api/items") {
        const data = await body(req),
          error = Core.validatePublish(data);
        if (error) {
          json(res, 400, { error });
          return;
        }
        const item = {
          ...Core.normalizePublish(data),
          id: crypto.randomUUID(),
          createdAt: Date.now(),
          ownerId: identity,
          status: data.type === "寻物" ? "寻找中" : "待认领",
        };
        persist([item, ...items]);
        json(res, 201, exposed(item, identity));
        return;
      }
      const match = url.pathname.match(/^\/api\/items\/([^/]+)\/status$/);
      if (req.method === "PATCH" && match) {
        await body(req);
        const item = items.find(
          (item) => item.id === decodeURIComponent(match[1]),
        );
        if (!item) {
          json(res, 404, { error: "信息不存在" });
          return;
        }
        if (item.ownerId !== identity) {
          json(res, 403, { error: "只有原发布者可以更新状态" });
          return;
        }
        if (Core.isDone(item)) {
          json(res, 409, { error: "信息已经处理完成" });
          return;
        }
        const updated = {
          ...item,
          status: item.type === "寻物" ? "已找到" : "已归还",
        };
        persist(items.map((item) => (item.id === updated.id ? updated : item)));
        json(res, 200, exposed(updated, identity));
        return;
      }
      json(res, 404, { error: "地址不存在" });
    } catch (error) {
      console.error("请求失败：", error.message);
      if (!res.headersSent)
        json(res, error.status || 500, {
          error: error.status
            ? error.message
            : "保存或读取失败，请检查服务端数据文件和磁盘权限",
        });
      else res.end();
    }
  });
}
if (require.main === module) {
  try {
    const server = createServer();
    const port = Number(process.env.PORT || 3000),
      host = process.env.HOST || "127.0.0.1";
    server.on("error", (error) => {
      console.error("启动失败：", error.message);
      process.exitCode = 1;
    });
    server.listen(port, host, () =>
      console.log("打开 Chrome： http://" + host + ":" + server.address().port),
    );
  } catch (error) {
    console.error("数据读取失败，原文件未覆盖：", error.message);
    process.exitCode = 1;
  }
}
module.exports = { createServer };
