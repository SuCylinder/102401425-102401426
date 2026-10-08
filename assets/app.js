"use strict";
var items = [],
  currentType = "寻物",
  homeTab = "寻物",
  currentId = null;
var searchType = "全部",
  searchStatus = "全部",
  visiblePage = "page-home";
var detailOrigin = { page: "page-home", scrollY: 0 };
var shared = location.protocol === "http:" || location.protocol === "https:";
var identity = "",
  storageError = false,
  visitor = false,
  loading = true;
var dataLoadFailed = false;
var busy = false,
  refreshPromise = null,
  Core = LostFound;
var REQUEST_TIMEOUT_MS = 10000;
function el(id) {
  return document.getElementById(id);
}
var noticeTimer = null;
function notify(message, sticky) {
  el("notice").textContent = message;
  el("notice").hidden = !message;
  if (noticeTimer) {
    clearTimeout(noticeTimer);
    noticeTimer = null;
  }
  if (message && !sticky)
    noticeTimer = setTimeout(function () {
      el("notice").hidden = true;
      noticeTimer = null;
    }, 2500);
}
function makeNode(tag, cls, text) {
  var node = document.createElement(tag);
  node.className = cls || "";
  if (text !== undefined) node.textContent = text;
  return node;
}
function isDone(item) {
  return Core.isDone(item);
}
function owns(item) {
  return !visitor && item.isOwner === true;
}
function decorateLocal(data) {
  return data.map(function (item) {
    return Object.assign({}, item, { isOwner: item.ownerId === identity });
  });
}
function readLocal() {
  return decorateLocal(Core.parseItems(localStorage.getItem("lost_items")));
}
async function request(path, method, data) {
  var controller = new AbortController();
  var timer = setTimeout(function () {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  try {
    var response = await fetch(path, {
      method: method || "GET",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Publisher-Token": identity,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    // 超时也覆盖响应体读取，避免只收到响应头后一直等待。
    var result = await response.json();
    if (!response.ok) throw new Error(result.error || "操作失败");
    return result;
  } catch (error) {
    if (controller.signal.aborted) {
      var timeout = new Error("请求超过 10 秒，请检查网络或服务");
      timeout.name = "RequestTimeoutError";
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
function persistLocal(next) {
  if (storageError)
    throw new Error(
      "本地数据读取异常，已停止写入，请先按 README 备份并恢复数据",
    );
  // 保存成功后才更新内存；失败时保留原列表和输入。
  localStorage.setItem(
    "lost_items",
    JSON.stringify(
      next.map(function (item) {
        var copy = Object.assign({}, item);
        delete copy.isOwner;
        return copy;
      }),
    ),
  );
  items = decorateLocal(next);
}
function updateControls() {
  el("btn-publish").disabled =
    loading || busy || storageError || visitor || !identity;
  Object.keys(Core.limits).forEach(function (key) {
    el("f-" + key).disabled = busy;
  });
  el("seg-lost").disabled = busy;
  el("seg-found").disabled = busy;
  el("mode-text").textContent =
    (shared ? "共享服务模式" : "本地演示模式（仅此浏览器）") +
    (visitor ? " · 访客预览" : " · 当前发布者");
  el("visitor-toggle").textContent = visitor ? "返回发布者" : "访客预览";
  el("visitor-toggle").disabled = loading || busy;
  el("my-only").disabled = visitor;
  var item = items.find(function (x) {
    return x.id === currentId;
  });
  el("btn-done").hidden = !item || !owns(item);
  el("btn-done").disabled =
    loading || busy || storageError || !item || isDone(item);
}
function card(item) {
  // 用户输入仅写入 textContent，不解析为 HTML。
  var node = makeNode("button", "card");
  node.type = "button";
  node.appendChild(
    makeNode("div", "thumb" + (item.type === "寻物" ? " orange" : ""), "物"),
  );
  var main = makeNode("div", "card-main");
  main.appendChild(makeNode("div", "card-name", item.name));
  main.appendChild(makeNode("div", "card-sub", item.place + " · " + item.time));
  var foot = makeNode("div", "card-foot");
  foot.appendChild(
    makeNode(
      "span",
      "mini-pill " +
        (isDone(item) ? "gray" : item.type === "寻物" ? "orange" : "green"),
      item.status,
    ),
  );
  foot.appendChild(makeNode("span", "link", "查看详情 ›"));
  main.appendChild(foot);
  node.appendChild(main);
  node.onclick = function () {
    openDetail(item.id);
  };
  return node;
}
function renderList() {
  var box = el("list");
  box.replaceChildren();
  var list = Core.filterItems(items, {
    type: homeTab,
    mine: el("my-only").checked,
  });
  if (!list.length) {
    var message = loading
      ? "正在加载…"
      : dataLoadFailed
        ? "信息读取失败，请点击顶部刷新重试。"
        : el("my-only").checked
          ? "你还没有发布" +
            homeTab +
            "信息，取消“只看我的发布”可浏览其他信息。"
          : "暂无" + homeTab + "信息，快来发布第一条吧。";
    box.appendChild(makeNode("p", "subtitle", message));
  }
  list.forEach(function (item) {
    box.appendChild(card(item));
  });
}
function fillSelect(id, key) {
  var select = el(id),
    previous = select.value;
  select.replaceChildren();
  var all = makeNode("option", "", "全部");
  all.value = "";
  select.appendChild(all);
  Array.from(
    new Set(
      items
        .map(function (item) {
          return item[key];
        })
        .filter(Boolean),
    ),
  )
    .sort()
    .forEach(function (text) {
      var option = makeNode("option", "", text);
      option.value = text;
      select.appendChild(option);
    });
  select.value = Array.from(select.options).some(function (option) {
    return option.value === previous;
  })
    ? previous
    : "";
}
function filterItems(keyword, type, status) {
  return Core.filterItems(items, {
    keyword: keyword,
    type: type,
    status: status,
    category: el("filter-category").value,
    place: el("filter-place").value,
  });
}
function doSearch() {
  var kw = el("s-keyword").value.trim();
  var result = filterItems(kw, searchType, searchStatus),
    box = el("search-result");
  box.replaceChildren();
  el("search-tip").hidden = result.length !== 0;
  el("search-empty-title").textContent = loading
    ? "正在加载信息"
    : dataLoadFailed
      ? "信息读取失败"
      : !items.length
        ? "尚无人发布信息"
        : "当前条件没有匹配的信息";
  el("search-empty-text").textContent = loading
    ? "请稍候。"
    : dataLoadFailed
      ? "请检查服务或存储，点击顶部刷新重试。"
      : !items.length
        ? "先发布一条寻物或招领信息，再来浏览和搜索。"
        : "可以更换关键词，或点击“清除全部筛选”浏览所有信息。";
  el("search-count").textContent = kw
    ? "找到 " + result.length + " 条与“" + kw + "”相关的信息"
    : "共 " + result.length + " 条信息";
  result.forEach(function (item) {
    box.appendChild(card(item));
  });
  return result;
}
function resetSearch() {
  el("s-keyword").value = "";
  searchType = "全部";
  searchStatus = "全部";
  el("filter-category").value = "";
  el("filter-place").value = "";
  ["filter-type", "filter-status"].forEach(function (id) {
    el(id)
      .querySelectorAll(".pill")
      .forEach(function (button) {
        button.classList.toggle(
          "active",
          button.getAttribute("data-v") === "全部",
        );
      });
  });
  return doSearch();
}
function renderDetail() {
  var item = items.find(function (x) {
    return x.id === currentId;
  });
  if (!item) {
    currentId = null;
    show("page-home");
    notify("这条信息已不存在，请重新选择");
    return false;
  }
  el("d-name").textContent = item.name;
  el("d-type").textContent = item.type;
  el("d-status").textContent = item.status;
  el("d-status").className =
    "mini-pill " +
    (isDone(item) ? "gray" : item.type === "寻物" ? "orange" : "green");
  el("d-k-place").textContent = item.type === "寻物" ? "丢失地点" : "拾获地点";
  el("d-k-time").textContent = item.type === "寻物" ? "丢失时间" : "拾获时间";
  el("d-place").textContent = item.place;
  el("d-time").textContent = item.time;
  el("d-category").textContent = item.category || "未填写";
  el("d-feature").textContent = item.feature || "未填写";
  el("btn-done").textContent = isDone(item)
    ? "已处理"
    : item.type === "寻物"
      ? "标记为已找到"
      : "标记为已归还";
  el("owner-tip").textContent = owns(item)
    ? "这是你的发布，你可以更新处理状态。"
    : "只有原发布者可以更新状态。";
  el("detail-return").textContent =
    detailOrigin.page === "page-search" ? "返回搜索结果" : "返回首页";
  updateControls();
  return true;
}
function refreshViews() {
  fillSelect("filter-category", "category");
  fillSelect("filter-place", "place");
  renderList();
  doSearch();
  if (currentId) {
    var exists = renderDetail();
    if (exists && visiblePage === "page-contact") {
      // 后台刷新只更新文字，保留当前页面和滚动位置。
      el("contact-text").textContent = items.find(function (item) {
        return item.id === currentId;
      }).contact;
    }
  }
  updateControls();
}
function show(id, scrollY) {
  if (id === "page-detail" && !renderDetail()) return;
  if (id === "page-search") doSearch();
  if (id === "page-home") renderList();
  document.querySelectorAll(".page").forEach(function (page) {
    page.style.display = page.id === id ? "block" : "none";
  });
  visiblePage = id;
  window.scrollTo(0, scrollY === undefined ? 0 : scrollY);
}
function openDetail(id) {
  if (visiblePage === "page-home" || visiblePage === "page-search") {
    detailOrigin = { page: visiblePage, scrollY: window.scrollY || 0 };
  }
  currentId = String(id);
  show("page-detail");
}
function returnFromDetail() {
  show(detailOrigin.page, detailOrigin.scrollY);
}
function doContact() {
  var item = items.find(function (x) {
    return x.id === currentId;
  });
  if (!item) {
    notify("信息已不存在");
    return;
  }
  el("contact-text").textContent = item.contact;
  show("page-contact");
}
async function copyContact() {
  var text = el("contact-text").textContent;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText)
      await navigator.clipboard.writeText(text);
    else {
      var field = makeNode("textarea", "copy-fallback");
      field.value = text;
      document.body.appendChild(field);
      try {
        field.select();
        if (!document.execCommand("copy")) throw new Error("复制不可用");
      } finally {
        field.remove();
      }
    }
    notify("联系方式已复制");
    return true;
  } catch (error) {
    notify("自动复制失败，请选中联系方式手动复制");
    return false;
  }
}
async function reloadItems() {
  if (busy) return;
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async function () {
    try {
      items = shared ? await request("/api/items") : readLocal();
      storageError = false;
      dataLoadFailed = false;
      loading = false;
      refreshViews();
      if (el("notice").textContent.indexOf("读取失败") === 0) notify("");
    } catch (error) {
      dataLoadFailed = true;
      if (!shared) storageError = true;
      notify(
        "读取失败：" +
          error.message +
          "。原数据未覆盖，请检查服务或按 README 恢复。",
        true,
      );
    } finally {
      loading = false;
      renderList();
      doSearch();
      updateControls();
    }
  })();
  try {
    await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}
async function doPublish() {
  if (busy || loading) return null;
  if (visitor) {
    notify("访客预览不能发布，请返回发布者");
    return null;
  }
  if (!identity || storageError) {
    notify("当前无法保存，请先恢复数据或浏览器存储");
    return null;
  }
  var data = { type: currentType };
  Object.keys(Core.limits).forEach(function (key) {
    data[key] = el("f-" + key).value.trim();
  });
  // 保留用户选择的本地时间，不转换时区；列表和详情显示为日期 + 时间。
  data.time = data.time.replace("T", " ");
  var error = Core.validatePublish(data);
  if (error) {
    notify(error);
    return null;
  }
  busy = true;
  updateControls();
  try {
    if (refreshPromise) await refreshPromise;
    var published;
    if (shared) published = await request("/api/items", "POST", data);
    else {
      var latest = readLocal();
      published = Object.assign(Core.normalizePublish(data), {
        id: crypto.randomUUID(),
        ownerId: identity,
        createdAt: Date.now(),
        status: data.type === "寻物" ? "寻找中" : "待认领",
        isOwner: true,
      });
      persistLocal([published].concat(latest));
    }
    if (shared) items = [published].concat(items);
    Object.keys(Core.limits).forEach(function (key) {
      el("f-" + key).value = "";
    });
    homeTab = published.type;
    updateTabs();
    refreshViews();
    notify("");
    show("page-success");
    return published;
  } catch (error) {
    notify(
      error.name === "RequestTimeoutError"
        ? "发布结果未确认：" +
            error.message +
            "。输入已保留，请先刷新列表核对是否已发布，避免重复提交。"
        : "发布失败：" + error.message + "。输入已保留，请重试。",
    );
    return null;
  } finally {
    busy = false;
    updateControls();
  }
}
async function markDone() {
  if (busy || loading) return false;
  var item = items.find(function (x) {
    return x.id === currentId;
  });
  if (!item || !owns(item)) {
    notify("只有原发布者可以更新状态");
    return false;
  }
  if (isDone(item)) {
    notify("这条信息已经处理完成");
    return false;
  }
  busy = true;
  updateControls();
  try {
    if (refreshPromise) await refreshPromise;
    var status = item.type === "寻物" ? "已找到" : "已归还";
    if (shared) {
      var updated = await request(
        "/api/items/" + encodeURIComponent(item.id) + "/status",
        "PATCH",
        {},
      );
      items = items.map(function (x) {
        return x.id === item.id ? updated : x;
      });
    } else {
      var latest = readLocal(),
        target = latest.find(function (x) {
          return x.id === item.id;
        });
      if (!target || !owns(target))
        throw new Error("信息不存在或不属于当前发布者");
      persistLocal(
        latest.map(function (x) {
          return x.id === item.id
            ? Object.assign({}, x, { status: status })
            : x;
        }),
      );
    }
    refreshViews();
    el("done-title").textContent = "已标记为" + status;
    notify("");
    show("page-done");
    return true;
  } catch (error) {
    notify(
      error.name === "RequestTimeoutError"
        ? "更新结果未确认：" + error.message + "。请先刷新核对最新状态。"
        : "更新失败：" + error.message,
    );
    return false;
  } finally {
    busy = false;
    updateControls();
  }
}
function setPublishType(type) {
  if (busy) return;
  currentType = type;
  var lost = type === "寻物";
  el("publish-title").textContent = lost ? "发布寻物" : "发布招领";
  el("seg-lost").className = "seg-btn" + (lost ? " active" : "");
  el("seg-found").className = "seg-btn" + (!lost ? " active" : "");
  el("label-place").textContent = lost ? "丢失地点" : "拾获地点";
  el("label-time").textContent = lost ? "丢失时间" : "拾获时间";
}
function updateTabs() {
  el("tab-lost").className =
    "tab tab-lost" + (homeTab === "寻物" ? " active" : "");
  el("tab-found").className =
    "tab tab-found" + (homeTab === "招领" ? " active" : "");
}
el("tab-lost").onclick = function () {
  homeTab = "寻物";
  updateTabs();
  renderList();
};
el("tab-found").onclick = function () {
  homeTab = "招领";
  updateTabs();
  renderList();
};
el("seg-lost").onclick = function () {
  setPublishType("寻物");
};
el("seg-found").onclick = function () {
  setPublishType("招领");
};
el("home-publish").onclick = function () {
  setPublishType(homeTab);
  show("page-publish");
};
el("hero-search").onclick = function () {
  show("page-search");
};
el("btn-publish").onclick = doPublish;
el("btn-search").onclick = doSearch;
el("btn-contact").onclick = doContact;
el("btn-copy").onclick = copyContact;
el("btn-done").onclick = markDone;
el("detail-back").onclick = returnFromDetail;
el("detail-return").onclick = returnFromDetail;
function clearPublishForm() {
  Object.keys(Core.limits).forEach(function (key) {
    el("f-" + key).value = "";
  });
}
el("btn-again").onclick = function () {
  clearPublishForm();
  show("page-publish");
};
el("my-only").onchange = renderList;
el("filter-category").onchange = doSearch;
el("filter-place").onchange = doSearch;
el("reset-search").onclick = resetSearch;
el("s-keyword").onkeydown = function (event) {
  if (event.key === "Enter") doSearch();
};
el("visitor-toggle").onclick = function () {
  if (busy) return;
  visitor = !visitor;
  el("my-only").checked = false;
  refreshViews();
};
el("refresh-items").onclick = reloadItems;
function bindPills(id, callback) {
  var buttons = el(id).querySelectorAll(".pill");
  buttons.forEach(function (button) {
    button.onclick = function () {
      buttons.forEach(function (x) {
        x.classList.toggle("active", x === button);
      });
      callback(button.getAttribute("data-v"));
      doSearch();
    };
  });
}
bindPills("filter-type", function (value) {
  searchType = value;
});
bindPills("filter-status", function (value) {
  searchStatus = value;
});
document.querySelectorAll(".quick").forEach(function (button) {
  button.onclick = function () {
    el("s-keyword").value = button.getAttribute("data-k");
    doSearch();
  };
});
document.querySelectorAll("[data-go]").forEach(function (button) {
  button.onclick = function () {
    var page = button.getAttribute("data-go");
    if (page === "page-publish") setPublishType(homeTab);
    show(page);
  };
});
window.addEventListener("storage", function (event) {
  if (!shared && (event.key === "lost_items" || event.key === null))
    reloadItems();
});
window.addEventListener("focus", reloadItems);
var appReady = (async function () {
  try {
    identity = localStorage.getItem("lost_publisher_token");
    if (!identity || !/^[a-f0-9]{64}$/.test(identity)) {
      var bytes = crypto.getRandomValues(new Uint8Array(32));
      identity = Array.from(bytes, function (b) {
        return b.toString(16).padStart(2, "0");
      }).join("");
      localStorage.setItem("lost_publisher_token", identity);
    }
    await reloadItems();
  } catch (error) {
    loading = false;
    storageError = true;
    notify("浏览器存储不可用：" + error.message, true);
    updateControls();
  }
})();
if (shared)
  setInterval(function () {
    if (!document.hidden) reloadItems();
  }, 5000);
