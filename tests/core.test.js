"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../assets/core");
const base = {
  type: "寻物",
  name: "蓝色水杯",
  category: "日用品",
  place: "图书馆",
  time: "9月26日",
  feature: "ABC",
  contact: "QQ 123",
};
test("合法寻物和招领均通过校验", () => {
  assert.equal(Core.validatePublish(base), null);
  assert.equal(Core.validatePublish({ ...base, type: "招领" }), null);
});
for (const key of ["name", "place", "time", "contact"]) {
  test("拒绝空白必填字段：" + key, () =>
    assert.ok(Core.validatePublish({ ...base, [key]: "   " })),
  );
}
test("拒绝非法类型、非字符串字段和超长名称", () => {
  assert.ok(Core.validatePublish({ ...base, type: "其他" }));
  assert.ok(Core.validatePublish({ ...base, contact: 123 }));
  assert.equal(Core.validatePublish({ ...base, name: "物".repeat(80) }), null);
  assert.ok(Core.validatePublish({ ...base, name: "物".repeat(81) }));
});
const list = [
  { ...base, id: "1", createdAt: 1, status: "寻找中", isOwner: true },
  {
    ...base,
    id: "2",
    createdAt: 2,
    type: "招领",
    place: "操场",
    status: "已归还",
    isOwner: false,
  },
  {
    ...base,
    id: "3",
    createdAt: 3,
    name: "钥匙",
    category: "钥匙",
    status: "已找到",
    isOwner: true,
  },
];
test("空白关键词浏览全部信息并按发布时间倒序", () => {
  assert.deepEqual(
    Core.filterItems(list, { keyword: "   " }).map((x) => x.id),
    ["3", "2", "1"],
  );
  assert.deepEqual(
    list.map((x) => x.id),
    ["1", "2", "3"],
  );
});
test("多关键词 AND 匹配且忽略英文大小写", () => {
  assert.deepEqual(
    Core.filterItems(list, { keyword: "水杯 图书馆 abc" }).map((x) => x.id),
    ["1"],
  );
});
test("关键词无匹配返回空列表", () =>
  assert.deepEqual(Core.filterItems(list, { keyword: "不存在" }), []));
test("类型、状态、类别和地点组合筛选", () => {
  assert.deepEqual(
    Core.filterItems(list, {
      type: "寻物",
      status: "进行中",
      category: "日用品",
      place: "图书馆",
    }).map((x) => x.id),
    ["1"],
  );
  assert.deepEqual(
    Core.filterItems(list, {
      type: "招领",
      status: "已处理",
      place: "操场",
    }).map((x) => x.id),
    ["2"],
  );
});
test("我的发布仅展示归属匹配的信息", () =>
  assert.deepEqual(
    Core.filterItems(list, { mine: true }).map((x) => x.id),
    ["3", "1"],
  ));
test("旧数据恢复保留状态、不冒认发布者，ID 统一为字符串", () => {
  const restored = Core.parseItems(
    JSON.stringify([{ ...base, id: 123, status: "寻找中" }]),
  );
  assert.equal(restored[0].id, "123");
  assert.equal(restored[0].ownerId, "");
  assert.equal(restored[0].createdAt, 123);
  assert.equal(Core.parseItems(null).length, 0);
});
test("拒绝损坏 JSON、非数组、重复 ID 和非法状态", () => {
  for (const raw of [
    "{bad",
    "{}",
    "[null]",
    JSON.stringify([{ ...base, id: 1, status: "已归还" }]),
    JSON.stringify([list[0], list[0]]),
  ])
    assert.throws(() => Core.parseItems(raw));
});
