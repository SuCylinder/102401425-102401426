"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createServer } = require("../server");
const base = {
  type: "寻物",
  name: "水杯",
  category: "日用品",
  place: "图书馆",
  time: "今天",
  feature: "蓝色",
  contact: "QQ 123",
};
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lost-found-test-"));
  const dataFile = path.join(dir, "items.json");
  const server = createServer({ dataFile });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    // 仅移除本次创建的两个固定测试文件，不递归删除。
    for (const file of [dataFile, dataFile + ".tmp"])
      if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(dir);
  });
  const url = "http://127.0.0.1:" + server.address().port;
  async function call(
    route,
    method = "GET",
    body,
    token = "a".repeat(64),
    headers = {},
  ) {
    const res = await fetch(url + route, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Publisher-Token": token,
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, data: await res.json() };
  }
  return { call, dataFile, url };
}
test("两位发布者共享列表，服务端拒绝非发布者修改并同步状态", async (t) => {
  const { call } = await fixture(t);
  const published = await call("/api/items", "POST", base);
  assert.equal(published.status, 201);
  assert.equal(published.data.isOwner, true);
  assert.equal("ownerId" in published.data, false);
  const id = published.data.id;
  const others = await call("/api/items", "GET", undefined, "b".repeat(64));
  assert.equal(others.data.length, 1);
  assert.equal(others.data[0].isOwner, false);
  assert.equal(
    (await call("/api/items/" + id + "/status", "PATCH", {}, "b".repeat(64)))
      .status,
    403,
  );
  assert.equal(
    (await call("/api/items/" + id + "/status", "PATCH", {})).data.status,
    "已找到",
  );
  assert.equal(
    (await call("/api/items", "GET", undefined, "b".repeat(64))).data[0].status,
    "已找到",
  );
  assert.equal(
    (await call("/api/items/" + id + "/status", "PATCH", {})).status,
    409,
  );
});
test("招领更新为已归还；服务重启后保留数据和归属", async (t) => {
  const { call, dataFile } = await fixture(t);
  const published = await call("/api/items", "POST", { ...base, type: "招领" });
  assert.equal(published.data.status, "待认领");
  assert.equal(
    (await call("/api/items/" + published.data.id + "/status", "PATCH", {}))
      .data.status,
    "已归还",
  );
  const restored = createServer({ dataFile });
  await new Promise((resolve) => restored.listen(0, "127.0.0.1", resolve));
  try {
    const res = await fetch(
      "http://127.0.0.1:" + restored.address().port + "/api/items",
      { headers: { "X-Publisher-Token": "a".repeat(64) } },
    );
    const list = await res.json();
    assert.equal(list[0].status, "已归还");
    assert.equal(list[0].isOwner, true);
  } finally {
    await new Promise((resolve) => restored.close(resolve));
  }
});
test("服务端拒绝非法输入、伪造归属、缺失身份和跨站写入", async (t) => {
  const { call } = await fixture(t);
  assert.equal(
    (await call("/api/items", "POST", { ...base, contact: " " })).status,
    400,
  );
  assert.equal((await call("/api/items", "POST", base, "")).status, 401);
  assert.equal(
    (
      await call("/api/items", "POST", base, "a".repeat(64), {
        Origin: "https://example.com",
      })
    ).status,
    403,
  );
  const item = await call("/api/items", "POST", {
    ...base,
    ownerId: "b".repeat(64),
    status: "已找到",
    id: "fake",
  });
  assert.equal(item.data.status, "寻找中");
  assert.notEqual(item.data.id, "fake");
  assert.equal(
    (
      await call(
        "/api/items/" + item.data.id + "/status",
        "PATCH",
        {},
        "b".repeat(64),
      )
    ).status,
    403,
  );
  assert.equal(
    (await call("/api/items/no-such-id/status", "PATCH", {})).status,
    404,
  );
});
test("静态文件白名单保护服务端数据和源码", async (t) => {
  const { url } = await fixture(t);
  assert.equal((await fetch(url + "/")).status, 200);
  for (const route of [
    "/server.js",
    "/data/items.json",
    "/README.md",
    "/tests/server.test.js",
  ])
    assert.equal((await fetch(url + route)).status, 404);
});
test("服务端保存失败不会污染内存列表", async (t) => {
  const { call, dataFile } = await fixture(t);
  fs.mkdirSync(dataFile); // 把目标文件路径占为目录，模拟持久化失败。
  try {
    assert.equal((await call("/api/items", "POST", base)).status, 500);
    assert.equal((await call("/api/items")).data.length, 0);
  } finally {
    fs.rmdirSync(dataFile);
  }
});
test("损坏数据阻止启动，原文件保留", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lost-found-corrupt-")),
    dataFile = path.join(dir, "items.json");
  fs.writeFileSync(dataFile, "{broken");
  try {
    assert.throws(() => createServer({ dataFile }));
    assert.equal(fs.readFileSync(dataFile, "utf8"), "{broken");
  } finally {
    fs.unlinkSync(dataFile);
    fs.rmdirSync(dir);
  }
});
