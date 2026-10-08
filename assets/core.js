// 浏览器与 Node 共用的纯函数，便于自动化白盒测试。
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LostFound = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  var limits = {
    name: 80,
    category: 40,
    place: 120,
    time: 80,
    feature: 1000,
    contact: 200,
  };
  function isDone(item) {
    return item.status === "已找到" || item.status === "已归还";
  }
  function validatePublish(data) {
    if (!data || typeof data !== "object") return "发布内容无效";
    if (data.type !== "寻物" && data.type !== "招领") return "请选择寻物或招领";
    var labels = {
      name: "物品名称",
      place: "地点",
      time: "时间",
      contact: "联系方式",
    };
    for (var key of Object.keys(limits)) {
      if (data[key] !== undefined && typeof data[key] !== "string")
        return "填写内容必须是文字";
      var text = (data[key] || "").trim();
      if (labels[key] && !text) return "请填写" + labels[key];
      if (text.length > limits[key])
        return key + " 超过长度限制（" + limits[key] + " 字）";
    }
    return null;
  }
  function normalizePublish(data) {
    var result = { type: data.type };
    Object.keys(limits).forEach(function (key) {
      result[key] = (data[key] || "").trim();
    });
    return result;
  }
  function parseItems(raw) {
    var data = JSON.parse(raw === null ? "[]" : raw);
    if (!Array.isArray(data)) throw new Error("保存的数据不是列表");
    var ids = new Set();
    return data.map(function (item, index) {
      if (
        !item ||
        validatePublish(item) ||
        !["string", "number"].includes(typeof item.id) ||
        !String(item.id) ||
        (typeof item.id === "number" && !Number.isFinite(item.id)) ||
        ids.has(String(item.id)) ||
        !(
          item.type === "寻物" ? ["寻找中", "已找到"] : ["待认领", "已归还"]
        ).includes(item.status) ||
        (item.ownerId !== undefined && typeof item.ownerId !== "string")
      ) {
        throw new Error("第 " + (index + 1) + " 条保存数据无效");
      }
      ids.add(String(item.id));
      return Object.assign(normalizePublish(item), {
        id: String(item.id),
        status: item.status,
        ownerId: item.ownerId || "",
        createdAt: Number.isFinite(item.createdAt)
          ? item.createdAt
          : Number(item.id) || index,
      });
    });
  }
  function newest(items) {
    return items.slice().sort(function (a, b) {
      return b.createdAt - a.createdAt;
    });
  }
  function filterItems(items, options) {
    var keys = (options.keyword || "")
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return newest(
      items.filter(function (item) {
        var hay = [item.name, item.place, item.feature, item.category]
          .join(" ")
          .toLowerCase();
        return (
          keys.every(function (key) {
            return hay.includes(key);
          }) &&
          (!options.type ||
            options.type === "全部" ||
            item.type === options.type) &&
          (!options.status ||
            options.status === "全部" ||
            (options.status === "进行中" && !isDone(item)) ||
            (options.status === "已处理" && isDone(item))) &&
          (!options.category || item.category === options.category) &&
          (!options.place || item.place === options.place) &&
          (!options.mine || item.isOwner === true)
        );
      }),
    );
  }
  return {
    limits: limits,
    isDone: isDone,
    validatePublish: validatePublish,
    normalizePublish: normalizePublish,
    parseItems: parseItems,
    newest: newest,
    filterItems: filterItems,
  };
});
