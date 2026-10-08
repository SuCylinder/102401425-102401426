"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto").webcrypto;
const Core = require("../assets/core");
const code = fs.readFileSync(path.join(__dirname, "../assets/app.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
const identity = "a".repeat(64);
const base = {
  id: "old",
  ownerId: identity,
  createdAt: 1,
  type: "寻物",
  name: "水杯",
  category: "日用品",
  place: "图书馆",
  time: "今天",
  feature: "蓝色",
  contact: "测试联系方式",
  status: "寻找中",
};
async function boot({
  raw = "[]",
  failRead = false,
  failWrite = false,
  clipboard,
  execCopy = false,
  timers,
} = {}) {
  class Node {
    constructor(tag = "div") {
      this.tagName = tag;
      this.children = [];
      this.value = "";
      this.textContent = "";
      this.style = {};
      this.hidden = false;
      this.checked = false;
      this.disabled = false;
      this.className = "";
    }
    get options() {
      return this.children;
    }
    getAttribute(name) {
      return this[name] ?? null;
    }
    get classList() {
      return {
        toggle: (name, enabled) => {
          const classes = new Set(this.className.split(/\s+/).filter(Boolean));
          if (enabled) classes.add(name);
          else classes.delete(name);
          this.className = [...classes].join(" ");
        },
      };
    }
    appendChild(node) {
      this.children.push(node);
      node.parent = this;
      return node;
    }
    replaceChildren() {
      this.children = [];
    }
    querySelectorAll() {
      return [];
    }
    select() {}
    remove() {
      this.parent.children = this.parent.children.filter((x) => x !== this);
    }
  }
  const nodes = new Map();
  for (const match of html.matchAll(/id="([^"]+)"/g)) {
    const node = new Node();
    node.id = match[1];
    nodes.set(node.id, node);
  }
  for (const id of ["filter-type", "filter-status"]) {
    const group = html.match(
      new RegExp('<div class="pills" id="' + id + '">([\\s\\S]*?)</div>'),
    )[1];
    const buttons = [
      ...group.matchAll(/<button class="([^"]+)" data-v="([^"]+)"/g),
    ].map((match) => {
      const button = new Node("button");
      button.className = match[1];
      button["data-v"] = match[2];
      return button;
    });
    nodes.get(id).querySelectorAll = () => buttons;
  }
  const store = { lost_items: raw, lost_publisher_token: identity },
    events = {};
  const context = {
    LostFound: Core,
    crypto,
    AbortController,
    setTimeout: timers ? timers.setTimeout : setTimeout,
    clearTimeout: timers ? timers.clearTimeout : clearTimeout,
    location: { protocol: "file:" },
    navigator: { clipboard },
    localStorage: {
      getItem(key) {
        if (failRead) throw new Error("不可读");
        return store[key] ?? null;
      },
      setItem(key, value) {
        if (failWrite) throw new Error("容量不足");
        store[key] = value;
      },
    },
    document: {
      hidden: false,
      body: new Node("body"),
      createElement(tag) {
        return new Node(tag);
      },
      getElementById(id) {
        assert.ok(nodes.has(id), "HTML 必须包含 " + id);
        return nodes.get(id);
      },
      querySelectorAll(selector) {
        return selector === ".page"
          ? [...nodes.values()].filter((x) => x.id.startsWith("page-"))
          : [];
      },
      execCommand() {
        return execCopy;
      },
    },
    window: {
      scrollTo() {},
      addEventListener(name, handler) {
        events[name] = handler;
      },
    },
    setInterval() {},
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  await context.appReady;
  const el = (id) => nodes.get(id);
  function fill(data = base) {
    for (const key of Object.keys(Core.limits))
      el("f-" + key).value = data[key] || "";
  }
  return { c: context, el, fill, store, events };
}
test("本地发布成功后清空表单、归属恢复并按新到旧排列", async () => {
  const b = await boot({ raw: JSON.stringify([base]) });
  b.fill({ ...base, name: "新钥匙" });
  const created = await b.c.doPublish();
  assert.ok(created);
  assert.equal(b.el("f-name").value, "");
  assert.equal(b.c.items[0].name, "新钥匙");
  assert.equal(b.c.items[0].isOwner, true);
  const restored = await boot({ raw: b.store.lost_items });
  assert.equal(restored.c.items[0].id, created.id);
  assert.equal(restored.c.items[0].isOwner, true);
});
test("招领发布后自动切换首页类型，不会误以为发布丢失", async () => {
  const b = await boot();
  b.fill();
  b.c.setPublishType("招领");
  const item = await b.c.doPublish();
  assert.equal(item.status, "待认领");
  assert.equal(b.c.homeTab, "招领");
});
for (const type of ["寻物", "招领"]) {
  test(type + "慢请求期间锁定输入和类型，成功后显示实际发布类型", async () => {
    const b = await boot();
    b.fill();
    b.c.setPublishType(type);
    b.c.shared = true;
    let complete, submitted;
    b.c.fetch = (url, options) => {
      submitted = JSON.parse(options.body);
      return new Promise((resolve) => {
        complete = resolve;
      });
    };
    const pending = b.c.doPublish();
    for (const key of Object.keys(Core.limits))
      assert.equal(b.el("f-" + key).disabled, true);
    assert.equal(b.el("seg-lost").disabled, true);
    assert.equal(b.el("seg-found").disabled, true);
    b.c.setPublishType(type === "寻物" ? "招领" : "寻物");
    assert.equal(b.c.currentType, type);
    assert.equal(submitted.type, type);
    assert.equal(await b.c.doPublish(), null); // 防止重复提交。
    complete({
      ok: true,
      json: async () => ({
        ...base,
        ...submitted,
        id: "new",
        isOwner: true,
        status: type === "寻物" ? "寻找中" : "待认领",
      }),
    });
    const item = await pending;
    assert.equal(b.c.homeTab, item.type);
    assert.equal(b.el("f-name").value, "");
    for (const key of Object.keys(Core.limits))
      assert.equal(b.el("f-" + key).disabled, false);
    assert.equal(b.el("seg-lost").disabled, false);
    assert.equal(b.el("seg-found").disabled, false);
  });
}
test("慢请求失败后恢复表单与类型切换，保留原输入供重试", async () => {
  const b = await boot();
  b.fill();
  b.c.shared = true;
  let fail;
  b.c.fetch = () =>
    new Promise((resolve, reject) => {
      fail = reject;
    });
  const pending = b.c.doPublish();
  assert.equal(b.el("f-name").disabled, true);
  fail(new Error("网络中断"));
  assert.equal(await pending, null);
  assert.equal(b.el("f-name").value, base.name);
  assert.equal(b.c.items.length, 0);
  for (const key of Object.keys(Core.limits))
    assert.equal(b.el("f-" + key).disabled, false);
  assert.equal(b.el("btn-publish").disabled, false);
  b.c.setPublishType("招领");
  assert.equal(b.c.currentType, "招领");
});
test("空白名称拒绝发布且保留输入", async () => {
  const b = await boot();
  b.fill({ ...base, name: " " });
  assert.equal(await b.c.doPublish(), null);
  assert.equal(b.c.items.length, 0);
  assert.equal(b.el("f-place").value, "图书馆");
});
test("日期时间控件的值按本地时间保存和展示，旧时间文字保留", async () => {
  const b = await boot({ raw: JSON.stringify([base]) });
  b.fill({ ...base, time: "2026-10-07T18:30" });
  const item = await b.c.doPublish();
  assert.equal(item.time, "2026-10-07 18:30");
  b.c.openDetail(item.id);
  assert.equal(b.el("d-time").textContent, "2026-10-07 18:30");
  const restored = await boot({ raw: b.store.lost_items });
  assert.equal(
    restored.c.items.find((x) => x.id === item.id).time,
    "2026-10-07 18:30",
  );
  assert.equal(restored.c.items.find((x) => x.id === "old").time, base.time);
});
test("状态更新后详情、搜索筛选及持久化保持一致", async () => {
  const b = await boot({ raw: JSON.stringify([base]) });
  b.c.searchStatus = "进行中";
  b.c.doSearch();
  assert.equal(b.el("search-result").children.length, 1);
  b.c.openDetail("old");
  assert.equal(await b.c.markDone(), true);
  b.c.show("page-detail");
  assert.equal(b.el("d-status").textContent, "已找到");
  b.c.show("page-search");
  assert.equal(b.el("search-result").children.length, 0);
  assert.equal(JSON.parse(b.store.lost_items)[0].status, "已找到");
  assert.equal(b.el("btn-done").disabled, true);
});
test("非发布者、访客和旧无归属数据均不能更新", async () => {
  for (const ownerId of ["b".repeat(64), undefined]) {
    const b = await boot({ raw: JSON.stringify([{ ...base, ownerId }]) });
    b.c.openDetail("old");
    assert.equal(b.el("btn-done").hidden, true);
    assert.equal(await b.c.markDone(), false);
    assert.equal(b.c.items[0].status, "寻找中");
  }
  const b = await boot({ raw: JSON.stringify([base]) });
  b.c.openDetail("old");
  b.el("visitor-toggle").onclick();
  assert.equal(await b.c.markDone(), false);
  b.fill();
  assert.equal(await b.c.doPublish(), null);
});
test("损坏存储保留原文、阻止写入，存储不可用不会中断初始化", async () => {
  const b = await boot({ raw: "{broken" });
  b.fill();
  assert.equal(b.c.storageError, true);
  assert.equal(await b.c.doPublish(), null);
  assert.equal(b.store.lost_items, "{broken");
  const denied = await boot({ failRead: true });
  assert.equal(denied.el("btn-publish").disabled, true);
});
test("写入失败保留表单和原状态，不显示成功页面", async () => {
  const b = await boot({ raw: JSON.stringify([base]), failWrite: true });
  b.fill({ ...base, name: "新物品" });
  assert.equal(await b.c.doPublish(), null);
  assert.equal(b.c.items.length, 1);
  assert.equal(b.el("f-name").value, "新物品");
  b.c.openDetail("old");
  assert.equal(await b.c.markDone(), false);
  assert.equal(b.el("d-status").textContent, "寻找中");
  assert.equal(JSON.parse(b.store.lost_items)[0].status, "寻找中");
});
test("卡片把 HTML 输入作为字面文字渲染", async () => {
  const b = await boot({
    raw: JSON.stringify([{ ...base, name: "<img src=x onerror=alert(1)>" }]),
  });
  const name = b.el("list").children[0].children[1].children[0];
  assert.equal(name.textContent, "<img src=x onerror=alert(1)>");
  assert.equal(name.children.length, 0);
  b.c.openDetail("old");
  assert.equal(b.el("d-name").textContent, name.textContent);
});
test("复制等待真正成功；拒绝或无 API 时不会虚报成功", async () => {
  let copied;
  const success = await boot({
    clipboard: {
      async writeText(text) {
        copied = text;
      },
    },
  });
  success.el("contact-text").textContent = "测试联系方式";
  assert.equal(await success.c.copyContact(), true);
  assert.equal(copied, "测试联系方式");
  const rejected = await boot({
    clipboard: {
      async writeText() {
        throw new Error("权限拒绝");
      },
    },
  });
  assert.equal(await rejected.c.copyContact(), false);
  assert.match(rejected.el("notice").textContent, /手动复制/);
  const absent = await boot();
  assert.equal(await absent.c.copyContact(), false);
  assert.equal(absent.c.document.body.children.length, 0);
  const fallback = await boot({ execCopy: true });
  assert.equal(await fallback.c.copyContact(), true);
});
test("另一个标签页写入后 storage 事件刷新列表与详情", async () => {
  const b = await boot({ raw: JSON.stringify([base]) });
  b.c.openDetail("old");
  b.store.lost_items = JSON.stringify([{ ...base, status: "已找到" }]);
  b.events.storage({ key: "lost_items" });
  await b.c.reloadItems();
  assert.equal(b.el("d-status").textContent, "已找到");
});
test("联系页反复刷新只更新内容，保留滚动位置；主动切页仍回到顶部", async () => {
  const b = await boot({ raw: JSON.stringify([base]) });
  let scrollY = 150,
    scrollCalls = 0;
  b.c.window.scrollTo = (x, y) => {
    scrollY = y;
    scrollCalls++;
  };
  b.c.openDetail("old");
  b.c.doContact();
  assert.equal(scrollY, 0);
  assert.equal(scrollCalls, 2);
  scrollY = 150;
  scrollCalls = 0;
  b.store.lost_items = JSON.stringify([
    { ...base, contact: "新的联系方式", status: "已找到" },
  ]);
  await b.c.reloadItems();
  await b.c.reloadItems();
  assert.equal(b.c.visiblePage, "page-contact");
  assert.equal(scrollY, 150);
  assert.equal(scrollCalls, 0);
  assert.equal(b.el("contact-text").textContent, "新的联系方式");
  assert.equal(b.el("d-status").textContent, "已找到");
  b.c.show("page-detail");
  assert.equal(scrollY, 0);
  assert.equal(scrollCalls, 1);
});
test("联系页对应信息被移除时安全返回首页", async () => {
  const b = await boot({ raw: JSON.stringify([base]) });
  b.c.openDetail("old");
  b.c.doContact();
  b.store.lost_items = "[]";
  await b.c.reloadItems();
  assert.equal(b.c.visiblePage, "page-home");
  assert.equal(b.c.currentId, null);
  assert.match(b.el("notice").textContent, /信息已不存在/);
});
function controlledTimers() {
  const pending = new Map();
  let sequence = 0;
  return {
    pending,
    setTimeout(callback, delay) {
      assert.ok(delay === 10000 || delay === 2500);
      if (delay !== 10000) return 9000 + sequence;
      const id = ++sequence;
      pending.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    expire() {
      assert.equal(pending.size, 1);
      pending.values().next().value();
    },
  };
}
function waitForAbort(signal) {
  return new Promise((resolve, reject) =>
    signal.addEventListener(
      "abort",
      () => {
        const error = new Error("请求已取消");
        error.name = "AbortError";
        reject(error);
      },
      { once: true },
    ),
  );
}
test("发布超时解除锁定并保留输入，提示核对结果且不自动重发", async () => {
  const timers = controlledTimers(),
    b = await boot({ timers });
  b.fill();
  b.c.shared = true;
  let calls = 0,
    signal;
  b.c.fetch = (url, options) => {
    calls++;
    signal = options.signal;
    return waitForAbort(signal);
  };
  const pending = b.c.doPublish();
  assert.equal(b.el("f-name").disabled, true);
  timers.expire();
  assert.equal(await pending, null);
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1);
  assert.equal(timers.pending.size, 0);
  assert.equal(b.c.busy, false);
  assert.equal(b.el("btn-publish").disabled, false);
  assert.equal(b.el("f-name").value, base.name);
  assert.equal(b.c.items.length, 0);
  assert.match(b.el("notice").textContent, /先刷新列表核对/);
  // 服务端可能已保存、只是响应丢失；用户刷新后能看到真正的结果。
  b.c.fetch = async () => ({
    ok: true,
    json: async () => [{ ...base, isOwner: true }],
  });
  await b.c.reloadItems();
  assert.equal(b.c.items.length, 1);
  assert.equal(timers.pending.size, 0);
});
test("更新超时不虚报成功，刷新后恢复服务端真实状态", async () => {
  const timers = controlledTimers(),
    b = await boot({ raw: JSON.stringify([base]), timers });
  b.c.shared = true;
  b.c.openDetail("old");
  b.c.fetch = (url, options) => waitForAbort(options.signal);
  const pending = b.c.markDone();
  timers.expire();
  assert.equal(await pending, false);
  assert.equal(b.el("btn-done").disabled, false);
  assert.equal(b.el("d-status").textContent, "寻找中");
  assert.equal(b.c.visiblePage, "page-detail");
  assert.match(b.el("notice").textContent, /刷新核对最新状态/);
  b.c.fetch = async () => ({
    ok: true,
    json: async () => [{ ...base, status: "已找到", isOwner: true }],
  });
  await b.c.reloadItems();
  assert.equal(b.el("d-status").textContent, "已找到");
  assert.equal(b.el("btn-done").disabled, true);
});
test("读取超时后可再次刷新，成功和接口失败均清理计时器", async () => {
  const timers = controlledTimers(),
    b = await boot({ timers });
  b.c.shared = true;
  b.c.fetch = (url, options) => waitForAbort(options.signal);
  const pending = b.c.reloadItems();
  timers.expire();
  await pending;
  assert.equal(b.c.refreshPromise, null);
  assert.equal(b.c.loading, false);
  assert.match(b.el("notice").textContent, /读取失败.*超过 10 秒/);
  assert.equal(timers.pending.size, 0);
  b.c.fetch = async () => ({ ok: true, json: async () => [] });
  await b.c.reloadItems();
  assert.equal(b.el("notice").hidden, true);
  assert.equal(timers.pending.size, 0);
  b.c.fetch = async () => ({
    ok: false,
    json: async () => ({ error: "只有原发布者可以更新状态" }),
  });
  await assert.rejects(
    b.c.request("/api/items/old/status", "PATCH", {}),
    /只有原发布者/,
  );
  assert.equal(timers.pending.size, 0);
});
test("响应头返回后响应体一直挂起也会超时", async () => {
  const timers = controlledTimers(),
    b = await boot({ timers });
  let started;
  const bodyStarted = new Promise((resolve) => {
    started = resolve;
  });
  b.c.fetch = async (url, options) => ({
    ok: true,
    json() {
      const pending = waitForAbort(options.signal);
      started();
      return pending;
    },
  });
  const pending = b.c.request("/api/items");
  await bodyStarted;
  timers.expire();
  await assert.rejects(
    pending,
    (error) => error.name === "RequestTimeoutError",
  );
  assert.equal(timers.pending.size, 0);
});
test("空数据与筛选无匹配使用不同提示，重置不会生成数据", async () => {
  const empty = await boot();
  empty.c.doSearch();
  assert.equal(empty.el("search-empty-title").textContent, "尚无人发布信息");
  empty.el("reset-search").onclick();
  assert.equal(empty.c.items.length, 0);
  const b = await boot({ raw: JSON.stringify([base]) });
  b.el("s-keyword").value = "不存在";
  b.c.doSearch();
  assert.equal(
    b.el("search-empty-title").textContent,
    "当前条件没有匹配的信息",
  );
  assert.equal(b.el("search-tip").hidden, false);
  assert.equal(b.el("search-result").children.length, 0);
});
test("清除筛选重置关键词、类型、状态、类别、地点及按钮高亮", async () => {
  const b = await boot({
    raw: JSON.stringify([
      base,
      { ...base, id: "found", type: "招领", status: "已归还" },
    ]),
  });
  b.el("s-keyword").value = "不存在";
  b.el("filter-category").value = "日用品";
  b.el("filter-place").value = "图书馆";
  b.el("filter-type").querySelectorAll(".pill")[2].onclick();
  b.el("filter-status").querySelectorAll(".pill")[1].onclick();
  const originalData = b.store.lost_items;
  b.el("reset-search").onclick();
  assert.equal(b.el("s-keyword").value, "");
  assert.equal(b.c.searchType, "全部");
  assert.equal(b.c.searchStatus, "全部");
  assert.equal(b.el("filter-category").value, "");
  assert.equal(b.el("filter-place").value, "");
  for (const id of ["filter-type", "filter-status"]) {
    const active = b
      .el(id)
      .querySelectorAll(".pill")
      .filter((button) => button.className.split(" ").includes("active"));
    assert.equal(active.length, 1);
    assert.equal(active[0].getAttribute("data-v"), "全部");
  }
  assert.equal(b.el("search-result").children.length, 2);
  assert.equal(b.el("search-tip").hidden, true);
  assert.equal(b.store.lost_items, originalData);
});
test("读取失败不会误报无人发布，恢复后显示正常空列表提示", async () => {
  const b = await boot({ raw: "{broken" });
  assert.equal(b.el("search-empty-title").textContent, "信息读取失败");
  assert.match(b.el("list").children[0].textContent, /读取失败/);
  b.store.lost_items = "[]";
  await b.c.reloadItems();
  assert.equal(b.el("search-empty-title").textContent, "尚无人发布信息");
});
test("只看我的发布为空时提示取消筛选，不误报整个列表为空", async () => {
  const b = await boot({
    raw: JSON.stringify([{ ...base, ownerId: "b".repeat(64) }]),
  });
  b.el("my-only").checked = true;
  b.c.renderList();
  assert.match(b.el("list").children[0].textContent, /取消“只看我的发布”/);
});
test("搜索详情返回保留全部搜索条件和原滚动位置", async () => {
  const b = await boot({ raw: JSON.stringify([base]) });
  b.c.window.scrollTo = (x, y) => {
    b.c.window.scrollY = y;
  };
  b.el("s-keyword").value = "水杯";
  b.c.searchType = "寻物";
  b.c.searchStatus = "进行中";
  b.el("filter-category").value = "日用品";
  b.el("filter-place").value = "图书馆";
  b.c.show("page-search");
  b.c.window.scrollY = 180;
  b.el("search-result").children[0].onclick();
  assert.equal(b.c.visiblePage, "page-detail");
  assert.equal(b.c.window.scrollY, 0);
  assert.equal(b.el("detail-return").textContent, "返回搜索结果");
  b.el("detail-back").onclick();
  assert.equal(b.c.visiblePage, "page-search");
  assert.equal(b.c.window.scrollY, 180);
  assert.equal(b.el("s-keyword").value, "水杯");
  assert.equal(b.c.searchType, "寻物");
  assert.equal(b.c.searchStatus, "进行中");
  assert.equal(b.el("filter-category").value, "日用品");
  assert.equal(b.el("filter-place").value, "图书馆");
  assert.equal(b.el("search-result").children.length, 1);
});
test("首页详情返回保留首页类型、我的发布筛选和原滚动位置", async () => {
  const b = await boot({
    raw: JSON.stringify([{ ...base, type: "招领", status: "待认领" }]),
  });
  b.c.window.scrollTo = (x, y) => {
    b.c.window.scrollY = y;
  };
  b.el("tab-found").onclick();
  b.el("my-only").checked = true;
  b.c.renderList();
  b.c.window.scrollY = 240;
  b.el("list").children[0].onclick();
  assert.equal(b.el("detail-return").textContent, "返回首页");
  b.el("detail-return").onclick();
  assert.equal(b.c.visiblePage, "page-home");
  assert.equal(b.c.window.scrollY, 240);
  assert.equal(b.c.homeTab, "招领");
  assert.equal(b.el("my-only").checked, true);
});
test("联系、刷新和状态更新不会覆盖详情来源，返回搜索时重新应用筛选", async () => {
  const b = await boot({ raw: JSON.stringify([base]) });
  b.c.window.scrollTo = (x, y) => {
    b.c.window.scrollY = y;
  };
  b.c.searchStatus = "进行中";
  b.c.show("page-search");
  b.c.window.scrollY = 120;
  b.c.openDetail("old");
  b.c.doContact();
  await b.c.reloadItems();
  b.c.show("page-detail");
  assert.equal(await b.c.markDone(), true);
  b.c.show("page-detail");
  b.el("detail-return").onclick();
  assert.equal(b.c.visiblePage, "page-search");
  assert.equal(b.c.window.scrollY, 120);
  assert.equal(b.c.searchStatus, "进行中");
  assert.equal(b.el("search-result").children.length, 0);
});
