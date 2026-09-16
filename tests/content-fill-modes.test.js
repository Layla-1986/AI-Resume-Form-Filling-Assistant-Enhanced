const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function extractFunction(source, signature, nextSignature) {
  const start = source.indexOf(signature);
  const end = source.indexOf(nextSignature);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Failed to locate snippet: ${signature}`);
  }
  return source.slice(start, end);
}

function loadContentHelpers() {
  const source = fs.readFileSync(
    path.join(__dirname, "../content.js"),
    "utf8"
  );

  const snippet = `
    ${extractFunction(
      source,
      "function normalizeSelectionRect(startPoint, endPoint) {",
      "function scanFields({ scope = \"page\", selectionRect = null } = {}) {"
    )}
    ${extractFunction(
      source,
      "function rectsIntersect(leftRect, rightRect) {",
      "function pickLikelyFormRoot() {"
    )}
    ${extractFunction(
      source,
      "function hasExistingFieldValue(runtime) {",
      "async function fillOne(runtime, value, { overwrite = true } = {}) {"
    )}
    module.exports = {
      normalizeSelectionRect,
      rectsIntersect,
      hasExistingFieldValue,
    };
  `;

  const context = {
    module: { exports: {} },
    exports: {},
  };

  vm.createContext(context);
  vm.runInContext(snippet, context);
  return context.module.exports;
}

function loadCheckboxFillHelper() {
  const source = fs.readFileSync(
    path.join(__dirname, "../content.js"),
    "utf8"
  );
  const start = source.indexOf("  async function fillOne(runtime, value");
  const end = source.indexOf("  function prepareTextValueForRuntime", start);
  const snippet = `
    function normalizeCheckboxCandidates(value) { return Array.isArray(value) ? value : String(value).split(","); }
    function matchesAnyCandidate(label, candidates) { return candidates.includes(label); }
    const checks = [];
    async function safeCheck(element, checked) { checks.push({ element, checked }); element.checked = checked; return true; }
    ${source.slice(start, end)}
    module.exports = { fillOne, checks };
  `;
  const context = { module: { exports: {} }, exports: {} };
  vm.createContext(context);
  vm.runInContext(snippet, context);
  return context.module.exports;
}

function loadCustomControlFillHelper() {
  const source = fs.readFileSync(
    path.join(__dirname, "../content.js"),
    "utf8"
  );
  const start = source.indexOf("  async function fillOne(runtime, value");
  const end = source.indexOf("  function prepareTextValueForRuntime", start);
  const snippet = `
    async function fillPhoenixSelectRuntime(runtime, value) {
      return runtime.testSelectResult === value;
    }
    function pickBestOption(options, desired) {
      return options.find((option) => option.label === desired) || null;
    }
    async function safeClickCustomOption(option) {
      option.clicked = true;
      return true;
    }
    ${source.slice(start, end)}
    module.exports = { fillOne };
  `;
  const context = { module: { exports: {} }, exports: {} };
  vm.createContext(context);
  vm.runInContext(snippet, context);
  return context.module.exports;
}

function loadPhoenixSelectHelpers({ commitOnClick = false } = {}) {
  const source = fs.readFileSync(
    path.join(__dirname, "../content.js"),
    "utf8"
  );
  const start = source.indexOf("  function readPhoenixSelectValue(runtime) {");
  const end = source.indexOf("  async function safeClickCustomOption(option) {", start);
  let selectedLabel = "";
  const option = {
    textContent: "统招全日制",
    click() {
      if (commitOnClick) selectedLabel = "统招全日制";
    },
  };
  const wrapper = {
    click() {},
    querySelector(selector) {
      if (!selector.includes("phoenix-select__tipEle") || !selectedLabel) return null;
      return { textContent: selectedLabel };
    },
  };
  const snippet = `
    function normalizeText(value) { return String(value || "").trim(); }
    function getMatchScore(left, right) {
      if (left === right) return 100;
      return left.includes(right) || right.includes(left) ? 75 : 0;
    }
    function scrollIntoView() {}
    function setNativeValue(el, value) { el.value = value; }
    async function sleep() {}
    function isVisible() { return true; }
    function pickBestOption(options, desired) {
      return options.find((item) => item.label === desired) || null;
    }
    ${source.slice(start, end)}
    module.exports = { readPhoenixSelectValue, fillPhoenixSelectRuntime };
  `;
  const context = {
    module: { exports: {} },
    exports: {},
    Event: class Event { constructor(type) { this.type = type; } },
    document: { querySelectorAll: () => [option] },
  };
  vm.createContext(context);
  vm.runInContext(snippet, context);
  return { ...context.module.exports, wrapper };
}

function loadMokaSelectHelpers({
  commitOnClick = false,
  commitOnEnter = false,
  targetAfterQueries = 0,
  partialBeforeExactQueries = 0,
  scopeOptionsToWrapper = false,
  missingOption = false,
  nestedMenu = false,
  monthOption = false,
  standardMenu = false,
  displayMirrorsSearch = false,
  commitOnMouseDown = false,
  shelllessMenu = false,
} = {}) {
  const source = fs.readFileSync(path.join(__dirname, "../content.js"), "utf8");
  const start = source.indexOf("  function readMokaSelectValue(runtime) {");
  const end = source.indexOf("  async function safeClickCustomOption(option) {", start);
  if (start === -1 || end === -1) return {};

  let selectedLabel = "";
  let queryCount = 0;
  let blurCount = 0;
  let menuOpen = false;
  const dispatchedKeys = [];
  const option = {
    textContent: monthOption ? "9" : "电子科技大学",
    click() {
      if (commitOnClick && !nestedMenu) {
        selectedLabel = option.textContent;
        menuOpen = false;
      }
    },
    dispatchEvent(event) {
      if (commitOnMouseDown && event.type === "mousedown") {
        selectedLabel = option.textContent;
        menuOpen = false;
      }
    },
    focus() {},
    querySelector(selector) {
      return nestedMenu && selector.includes("sd-Menu-container-")
        ? {
            click() {
              selectedLabel = option.textContent;
              menuOpen = false;
            },
          }
        : null;
    },
  };
  const partial = {
    textContent: "电子科技大学网络教育学院",
    click() {
      if (commitOnClick) selectedLabel = "电子科技大学网络教育学院";
    },
  };
  const decoy = { textContent: "成都信息工程大学", click() {} };
  const queryOptions = (selector = "") => {
    queryCount += 1;
    if (!menuOpen) return [];
    if (standardMenu && !selector.includes("sd-Menu-container-")) return [];
    if (monthOption && el.value !== "9") return [];
    if (missingOption) return [decoy];
    if (queryCount <= partialBeforeExactQueries) return [partial];
    return queryCount > targetAfterQueries ? [option] : [decoy];
  };
  const wrapper = {
    click() { menuOpen = true; },
    querySelector(selector) {
      if (selector.includes("sd-Select-menu-")) {
        return menuOpen && !shelllessMenu ? {} : null;
      }
      if (!selector.includes("sd-Input-display-value-")) return null;
      const displayed = selectedLabel || (displayMirrorsSearch ? el.value : "");
      return displayed ? { textContent: displayed } : null;
    },
    ...(scopeOptionsToWrapper
      ? {
          querySelectorAll: () => {
            if (!menuOpen) return [];
            if (!missingOption && partialBeforeExactQueries === 0) {
              queryCount += 1;
              return [option];
            }
            return queryOptions();
          },
        }
      : {}),
  };
  const el = {
    value: "",
    focus() {},
    blur() { blurCount += 1; },
    dispatchEvent(event) {
      if (event.type === "keydown") dispatchedKeys.push(event.key);
      if (event.type === "keydown" && event.key === "Escape") menuOpen = false;
      if (commitOnEnter && event.type === "keydown" && event.key === "Enter") {
        selectedLabel = "电子科技大学";
        menuOpen = false;
      }
    },
  };
  const snippet = `
    function normalizeText(value) { return String(value || "").trim(); }
    function getMatchScore(left, right) {
      if (left === right) return 100;
      return left.includes(right) || right.includes(left) ? 75 : 0;
    }
    function scrollIntoView() {}
    function setNativeValue(el, value) { el.value = value; }
    async function sleep() {}
    function isVisible() { return true; }
    function pickBestOption(options, desired) {
      return options.find((item) => item.label === desired) || null;
    }
    function clickLikeUser(el) {
      el.focus?.();
      el.dispatchEvent?.(new MouseEvent("mousedown", { bubbles: true }));
      el.dispatchEvent?.(new MouseEvent("mouseup", { bubbles: true }));
      el.click?.();
    }
    ${source.slice(start, end)}
    module.exports = { readMokaSelectValue, fillMokaSelectRuntime };
  `;
  const context = {
    module: { exports: {} },
    exports: {},
    Event: class Event { constructor(type) { this.type = type; } },
    KeyboardEvent: class KeyboardEvent {
      constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
    },
    MouseEvent: class MouseEvent {
      constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
    },
    document: {
      querySelectorAll: queryOptions,
    },
  };
  vm.createContext(context);
  vm.runInContext(snippet, context);
  return {
    ...context.module.exports,
    wrapper,
    el,
    getQueryCount: () => queryCount,
    getSelectedLabel: () => selectedLabel,
    getBlurCount: () => blurCount,
    getDispatchedKeys: () => [...dispatchedKeys],
    isMenuOpen: () => menuOpen,
  };
}

function loadMokaDomHelpers() {
  const source = fs.readFileSync(path.join(__dirname, "../content.js"), "utf8");
  const start = source.indexOf("  function isMokaSelectInput(el) {");
  const end = source.indexOf("  function getPhoenixRadioOptions(groupEl) {", start);
  const snippet = `
    const repeatGroupIds = new WeakMap();
    let repeatGroupSequence = 0;
    function normalizeText(value) { return String(value || "").trim(); }
    ${source.slice(start, end)}
    module.exports = { isMokaSelectInput, getMokaRepeatGroupId, getMokaDateMeta, getMokaSectionMeta };
  `;
  const context = { module: { exports: {} }, exports: {} };
  vm.createContext(context);
  vm.runInContext(snippet, context);
  return context.module.exports;
}

function loadDeriveFillValue() {
  const source = fs.readFileSync(path.join(__dirname, "../content.js"), "utf8");
  const start = source.indexOf("  function normalizeTransform(transform) {");
  const end = source.indexOf("  async function requestSelectionRect() {", start);
  const snippet = `
    function isAffirmative() { return false; }
    ${source.slice(start, end)}
    module.exports = { deriveFillValue };
  `;
  const context = { module: { exports: {} }, exports: {} };
  vm.createContext(context);
  vm.runInContext(snippet, context);
  return context.module.exports.deriveFillValue;
}

function loadDatePanelHelpers(panels) {
  const source = fs.readFileSync(path.join(__dirname, "../content.js"), "utf8");
  const start = source.indexOf("  function findVisibleDatePanel(anchorEl) {");
  const end = source.indexOf("  async function movePickerToYear", start);
  const snippet = `
    function normalizeText(value) { return String(value || "").replace(/\\s+/g, "").trim(); }
    function isVisible() { return true; }
    ${source.slice(start, end)}
    module.exports = { findVisibleDatePanel };
  `;
  const context = {
    module: { exports: {} },
    exports: {},
    document: { querySelectorAll: () => panels },
  };
  vm.createContext(context);
  vm.runInContext(snippet, context);
  return context.module.exports;
}

test("normalizeSelectionRect creates a stable viewport rectangle", () => {
  const helpers = loadContentHelpers();
  const rect = JSON.parse(
    JSON.stringify(
      helpers.normalizeSelectionRect({ x: 180, y: 140 }, { x: 20, y: 40 })
    )
  );

  assert.deepEqual(rect, {
    left: 20,
    top: 40,
    right: 180,
    bottom: 140,
    width: 160,
    height: 100,
  });
});

test("date picker chooses the full calendar grid instead of its nested header", () => {
  const makeRect = (left, top, width, height) => ({
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  });
  const dayNodes = Array.from({ length: 31 }, (_, index) => ({
    textContent: String(index + 1),
  }));
  const header = {
    textContent: "2004年 1月",
    contains: () => false,
    querySelectorAll: () => [],
    getBoundingClientRect: () => makeRect(120, 90, 180, 40),
  };
  const calendar = {
    textContent: `2004年 1月 ${dayNodes.map((node) => node.textContent).join(" ")}`,
    contains: () => false,
    querySelectorAll: () => dayNodes,
    getBoundingClientRect: () => makeRect(120, 90, 390, 460),
  };
  const anchor = { getBoundingClientRect: () => makeRect(120, 40, 500, 40) };
  const helpers = loadDatePanelHelpers([header, calendar]);

  assert.equal(helpers.findVisibleDatePanel(anchor), calendar);
});

test("rectsIntersect treats overlapping rectangles as in-scope", () => {
  const helpers = loadContentHelpers();

  assert.equal(
    helpers.rectsIntersect(
      { left: 0, top: 0, right: 100, bottom: 100 },
      { left: 80, top: 80, right: 140, bottom: 140 }
    ),
    true
  );

  assert.equal(
    helpers.rectsIntersect(
      { left: 0, top: 0, right: 50, bottom: 50 },
      { left: 80, top: 80, right: 140, bottom: 140 }
    ),
    false
  );
});

test("hasExistingFieldValue detects filled controls for incremental mode", () => {
  const helpers = loadContentHelpers();

  assert.equal(helpers.hasExistingFieldValue({ kind: "text", el: { value: "Alice" } }), true);
  assert.equal(helpers.hasExistingFieldValue({ kind: "text", el: { value: "   " } }), false);
  assert.equal(
    helpers.hasExistingFieldValue({
      kind: "select",
      el: { value: "", selectedIndex: 0 },
    }),
    false
  );
  assert.equal(
    helpers.hasExistingFieldValue({
      kind: "select",
      el: { value: "", selectedIndex: 2 },
    }),
    true
  );
  assert.equal(
    helpers.hasExistingFieldValue({
      kind: "radio_group",
      options: [{ el: { checked: false } }, { el: { checked: true } }],
    }),
    true
  );
  assert.equal(
    helpers.hasExistingFieldValue({
      kind: "contenteditable",
      el: { textContent: "已有内容" },
    }),
    true
  );
});

test("overwrite checkbox filling clears options outside the desired set", async () => {
  const helpers = loadCheckboxFillHelper();
  const first = { checked: true };
  const second = { checked: true };

  const result = await helpers.fillOne(
    {
      kind: "checkbox_group",
      options: [
        { el: first, label: "保留" },
        { el: second, label: "清除" },
      ],
    },
    ["保留"]
  );

  assert.equal(result.filled, true);
  assert.equal(first.checked, true);
  assert.equal(second.checked, false);
});

test("custom Phoenix select uses component-aware selection", async () => {
  const helpers = loadCustomControlFillHelper();
  const result = await helpers.fillOne(
    { kind: "custom_select", testSelectResult: "统招全日制" },
    "统招全日制"
  );

  assert.equal(result.filled, true);
});

test("custom Phoenix radio group clicks the matching visible option", async () => {
  const helpers = loadCustomControlFillHelper();
  const yes = { label: "是", clicked: false };
  const no = { label: "否", clicked: false };
  const result = await helpers.fillOne(
    { kind: "custom_radio_group", options: [yes, no] },
    "否"
  );

  assert.equal(result.filled, true);
  assert.equal(yes.clicked, false);
  assert.equal(no.clicked, true);
});

test("Phoenix select reader ignores typed input and placeholder text", () => {
  const helpers = loadPhoenixSelectHelpers();
  const runtime = {
    el: { value: "统招全日制" },
    wrapper: {
      querySelector() {
        return null;
      },
    },
  };

  assert.equal(helpers.readPhoenixSelectValue(runtime), "");
});

test("Phoenix select fill fails when typing did not commit an option", async () => {
  const helpers = loadPhoenixSelectHelpers({ commitOnClick: false });
  const runtime = {
    el: { value: "", focus() {}, dispatchEvent() {} },
    wrapper: helpers.wrapper,
  };

  assert.equal(
    await helpers.fillPhoenixSelectRuntime(runtime, "统招全日制"),
    false
  );
});

test("Phoenix select fill succeeds only after the visible selected label updates", async () => {
  const helpers = loadPhoenixSelectHelpers({ commitOnClick: true });
  const runtime = {
    el: { value: "", focus() {}, dispatchEvent() {} },
    wrapper: helpers.wrapper,
  };

  assert.equal(
    await helpers.fillPhoenixSelectRuntime(runtime, "统招全日制"),
    true
  );
});

test("Moka select reader ignores search text and reads the committed display value", () => {
  const helpers = loadMokaSelectHelpers();
  assert.equal(typeof helpers.readMokaSelectValue, "function");
  assert.equal(
    helpers.readMokaSelectValue({
      el: { value: "电子科技大学" },
      wrapper: helpers.wrapper,
    }),
    ""
  );
});

test("Moka select fill fails when no dropdown option was committed", async () => {
  const helpers = loadMokaSelectHelpers({ commitOnClick: false });
  assert.equal(typeof helpers.fillMokaSelectRuntime, "function");
  const runtime = {
    el: helpers.el,
    wrapper: helpers.wrapper,
  };

  assert.equal(await helpers.fillMokaSelectRuntime(runtime, "电子科技大学"), false);
});

test("Moka select does not mistake mirrored search text for a committed option", async () => {
  const helpers = loadMokaSelectHelpers({ displayMirrorsSearch: true });

  assert.equal(
    await helpers.fillMokaSelectRuntime(
      { el: helpers.el, wrapper: helpers.wrapper },
      "电子科技大学"
    ),
    false
  );
  assert.equal(helpers.isMenuOpen(), false);
});

test("Moka shellless visible option list prevents a false successful commit", async () => {
  const helpers = loadMokaSelectHelpers({
    displayMirrorsSearch: true,
    shelllessMenu: true,
  });

  assert.equal(
    await helpers.fillMokaSelectRuntime(
      { el: helpers.el, wrapper: helpers.wrapper },
      "电子科技大学"
    ),
    false
  );
});

test("Moka option can commit from the pointer-down event used by custom menus", async () => {
  const helpers = loadMokaSelectHelpers({ commitOnMouseDown: true });

  assert.equal(
    await helpers.fillMokaSelectRuntime(
      { el: helpers.el, wrapper: helpers.wrapper },
      "电子科技大学"
    ),
    true
  );
  assert.equal(helpers.getSelectedLabel(), "电子科技大学");
});

test("Moka select fill succeeds after the committed display value updates", async () => {
  const helpers = loadMokaSelectHelpers({ commitOnClick: true });
  assert.equal(typeof helpers.fillMokaSelectRuntime, "function");
  const runtime = {
    el: helpers.el,
    wrapper: helpers.wrapper,
  };

  assert.equal(await helpers.fillMokaSelectRuntime(runtime, "电子科技大学"), true);
});

test("Moka select closes its dropdown after a successful commit", async () => {
  const helpers = loadMokaSelectHelpers({ commitOnClick: true });
  const runtime = {
    el: helpers.el,
    wrapper: helpers.wrapper,
  };

  assert.equal(await helpers.fillMokaSelectRuntime(runtime, "电子科技大学"), true);
  assert.ok(helpers.getDispatchedKeys().includes("Escape"));
  assert.equal(helpers.getBlurCount(), 1);
});

test("Moka select waits for an asynchronously filtered matching option", async () => {
  const helpers = loadMokaSelectHelpers({
    commitOnClick: true,
    targetAfterQueries: 5,
  });
  const runtime = {
    el: helpers.el,
    wrapper: helpers.wrapper,
  };

  assert.equal(await helpers.fillMokaSelectRuntime(runtime, "电子科技大学"), true);
});

test("Moka select only chooses options belonging to its own open control", async () => {
  const helpers = loadMokaSelectHelpers({
    commitOnClick: true,
    scopeOptionsToWrapper: true,
    targetAfterQueries: 100,
  });
  const runtime = {
    el: helpers.el,
    wrapper: helpers.wrapper,
  };

  assert.equal(await helpers.fillMokaSelectRuntime(runtime, "电子科技大学"), true);
});

test("Moka select uses keyboard confirmation when option click does not commit", async () => {
  const helpers = loadMokaSelectHelpers({
    commitOnClick: false,
    commitOnEnter: true,
  });

  assert.equal(
    await helpers.fillMokaSelectRuntime(
      { el: helpers.el, wrapper: helpers.wrapper },
      "电子科技大学"
    ),
    true
  );
});

test("Moka select waits for an exact option instead of committing an early partial match", async () => {
  const helpers = loadMokaSelectHelpers({
    commitOnClick: true,
    partialBeforeExactQueries: 3,
  });

  assert.equal(
    await helpers.fillMokaSelectRuntime(
      { el: helpers.el, wrapper: helpers.wrapper },
      "电子科技大学"
    ),
    true
  );
  assert.ok(helpers.getQueryCount() >= 4);
});

test("Moka select stops after one bounded option search when no match exists", async () => {
  const helpers = loadMokaSelectHelpers({ missingOption: true });

  assert.equal(
    await helpers.fillMokaSelectRuntime(
      { el: helpers.el, wrapper: helpers.wrapper },
      "电子科技大学"
    ),
    false
  );
  assert.ok(helpers.getQueryCount() <= 8);
});

test("Moka select never commits a partial-only candidate", async () => {
  const helpers = loadMokaSelectHelpers({
    commitOnClick: true,
    partialBeforeExactQueries: 100,
  });

  assert.equal(
    await helpers.fillMokaSelectRuntime(
      { el: helpers.el, wrapper: helpers.wrapper },
      "电子科技大学"
    ),
    false
  );
  assert.equal(helpers.getSelectedLabel(), "");
});

test("Moka custom rendered option commits through its nested menu item", async () => {
  const h = loadMokaSelectHelpers({ nestedMenu: true });
  assert.equal(await h.fillMokaSelectRuntime({ el: h.el, wrapper: h.wrapper }, "电子科技大学"), true);
  assert.equal(h.getSelectedLabel(), "电子科技大学");
});

test("Moka month search removes zero padding before filtering options", async () => {
  const h = loadMokaSelectHelpers({ monthOption: true, commitOnClick: true });
  assert.equal(await h.fillMokaSelectRuntime({ el: h.el, wrapper: h.wrapper, datePart: "month" }, "09"), true);
  assert.equal(h.getSelectedLabel(), "9");
});

test("Moka standard date menu is found without a common-item wrapper", async () => {
  const h = loadMokaSelectHelpers({ standardMenu: true, monthOption: true, commitOnClick: true });
  assert.equal(await h.fillMokaSelectRuntime({ el: h.el, wrapper: h.wrapper, datePart: "month" }, "09"), true);
});

test("Moka DOM helpers recognize selects, card identity, and date positions", () => {
  const helpers = loadMokaDomHelpers();
  const selectContainer = {};
  const dropdown = {};
  const firstCard = {};
  const secondCard = {};
  const range = { querySelectorAll: () => parts };
  const makePart = (placeholder, card = firstCard) => ({
    getAttribute(name) {
      return name === "placeholder" ? placeholder : "";
    },
    closest(selector) {
      if (selector.includes("sd-Select-container-")) return selectContainer;
      if (selector.includes("sd-Dropdown-container-")) return dropdown;
      if (selector === ".month-range-select") return range;
      if (selector.includes("apply-fields-") && selector.includes("multi-")) return card;
      return null;
    },
  });
  // Moka clears placeholders once a value is selected; position stays stable.
  const parts = [makePart(""), makePart(""), makePart("年"), makePart("月")];
  const otherCardPart = makePart("年", secondCard);

  assert.equal(helpers.isMokaSelectInput(parts[0]), true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(parts.map((part) => helpers.getMokaDateMeta(part)))),
    [
      { datePart: "year", dateRole: "start" },
      { datePart: "month", dateRole: "start" },
      { datePart: "year", dateRole: "end" },
      { datePart: "month", dateRole: "end" },
    ]
  );
  assert.equal(helpers.getMokaRepeatGroupId(parts[0]), helpers.getMokaRepeatGroupId(parts[3]));
  assert.notEqual(helpers.getMokaRepeatGroupId(parts[0]), helpers.getMokaRepeatGroupId(otherCardPart));
});

test("Moka year and month controls derive only their requested date part", () => {
  const deriveFillValue = loadDeriveFillValue();
  assert.equal(
    deriveFillValue("2024-09", { type: "none" }, { datePart: "year" }),
    "2024"
  );
  assert.equal(
    deriveFillValue("2024-09", { type: "none" }, { datePart: "month" }),
    "09"
  );
});

test("Moka date section uses the card heading despite unrelated descriptive text", () => {
  const h = loadMokaDomHelpers();
  const heading = { className: "blockTitle-example", textContent: "工作经历添加" };
  const card = { previousElementSibling: { className: "alert", textContent: "实习说明", previousElementSibling: heading } };
  const el = { closest: () => card };
  assert.equal(h.getMokaSectionMeta(el).sectionKey, "work");
});
