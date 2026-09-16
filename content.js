// Content script: scan fields -> AI mapping to resume paths -> deterministic local fill.
(function () {
  "use strict";

  if (window.__AI_RESUME_AUTOFILL_LOADED__) return;
  window.__AI_RESUME_AUTOFILL_LOADED__ = true;

  const schema = window.ResumeSchema;
  if (!schema) {
    console.error("[简历填表助手] Resume schema not found");
    return;
  }

  const diagnostics = window.ResumeDiagnostics;
  if (!diagnostics) {
    console.error("[简历填表助手] Resume diagnostics not found");
    return;
  }

  const fieldText = window.ResumeFieldText;
  if (!fieldText) {
    console.error("[简历填表助手] Resume field text helpers not found");
    return;
  }

  const fieldSemantics = window.ResumeFieldSemantics;
  if (!fieldSemantics) {
    console.error("[简历填表助手] Resume field semantics helpers not found");
    return;
  }

  const repeatExpansion = window.ResumeRepeatExpansion;
  if (!repeatExpansion) {
    console.error("[简历填表助手] Repeat expansion helpers not found");
    return;
  }

  const awardFill = window.ResumeAwardFill;
  if (!awardFill) {
    console.error("[简历填表助手] Award fill helpers not found");
    return;
  }

  const commonFieldFill = window.ResumeCommonFieldFill;
  if (!commonFieldFill) {
    console.error("[简历填表助手] Common field fill helpers not found");
    return;
  }

  const localAwardImport = window.LocalAwardImport;
  if (!localAwardImport) {
    console.error("[简历填表助手] Local award descriptions not found");
    return;
  }

  const fillRuntime = window.ResumeFillRuntime;
  if (!fillRuntime) {
    console.error("[简历填表助手] Resume fill runtime helpers not found");
    return;
  }

  const contentBridge = window.ResumeContentBridge;
  if (!contentBridge) {
    console.error("[简历填表助手] Resume content bridge not found");
    return;
  }

  const aiClient = window.ResumeAiClient;
  if (!aiClient) {
    console.error("[简历填表助手] Resume AI client not found");
    return;
  }

  const EXT_TAG = "[简历填表助手]";
  const MAPPING_CACHE_KEY = "fieldMappingCacheV7";
  const CONTROL_SELECTOR =
    'input, textarea, select, button, option, svg, path, style, script, noscript, [contenteditable="true"], [contenteditable=""], [aria-hidden="true"]';
  const LABEL_LIKE_SELECTOR =
    '[class*="label"],[class*="Label"],[class*="title"],[class*="Title"],[class*="name"],[class*="Name"],[class*="caption"],[class*="Caption"],[class*="header"],[class*="Header"],label,legend,dt,th';
  const HEADING_LIKE_SELECTOR =
    'h1,h2,h3,h4,h5,h6,[role="heading"],[class*="section"],[class*="Section"],[class*="header"],[class*="Header"],[class*="title"],[class*="Title"],legend';
  const STRUCTURAL_CONTAINER_SELECTOR =
    '[class*="form"],[class*="Form"],[class*="field"],[class*="Field"],[class*="item"],[class*="Item"],[class*="row"],[class*="Row"],[class*="group"],[class*="Group"],[class*="cell"],[class*="Cell"],fieldset,section,article,tr,li,td,th,dl';
  const SELECTION_OVERLAY_ID = "ai-resume-fill-selection-overlay";
  const SELECTION_BOX_ID = "ai-resume-fill-selection-box";
  const SELECTION_HINT_ID = "ai-resume-fill-selection-hint";
  const MIN_SELECTION_SIZE = 12;
  const DEEP_SCAN_MAX_ROUNDS = 5;
  const DEEP_SCAN_INITIAL_DELAY = 250;
  const DEEP_SCAN_POLL_TIMEOUT = 1200;
  const DEEP_SCAN_MAX_CLICKS = 20;
  const DEEP_SCAN_EXPAND_KEYWORDS = [
    "展开",
    "展开全部",
    "查看更多",
    "查看全部",
    "showmore",
    "viewmore",
    "expand",
  ];
  const DEEP_SCAN_MORE_KEYWORDS = ["更多", "more"];
  const DEEP_SCAN_EXCLUDE_KEYWORDS = [
    "添加",
    "新增",
    "增加",
    "新建",
    "删除",
    "提交",
    "保存",
    "返回",
    "取消",
    "关闭",
    "add",
    "new",
    "plus",
    "delete",
    "submit",
    "save",
    "back",
    "cancel",
    "close",
  ];
  const DEEP_SCAN_SECTION_MAP = [
    { patterns: ["教育", "学校", "专业", "学历", "学位", "毕业"], sectionKey: "educations" },
    { patterns: ["实习"], sectionKey: "internships" },
    { patterns: ["工作", "公司", "职位", "任职", "职业"], sectionKey: "workExperiences" },
    { patterns: ["项目", "产品"], sectionKey: "projects" },
    { patterns: ["竞赛", "比赛", "获奖", "奖项", "荣誉", "奖学金"], sectionKey: "awards" },
    { patterns: ["证书", "认证", "资格", "等级"], sectionKey: "certificates" },
    { patterns: ["语言", "外语", "雅思", "托福", "cet"], sectionKey: "languages" },
    { patterns: ["校园", "学生", "社团", "社会", "志愿", "科研", "组织"], sectionKey: "campusExperiences" },
    { patterns: ["技能", "特长", "编程", "工具"], sectionKey: "skills" },
    { patterns: ["偏好", "期望", "求职", "目标", "薪资"], sectionKey: "jobPreferences" },
    { patterns: ["联系方式", "地址", "电话"], sectionKey: "contactAndLocation" },
    { patterns: ["证件", "身份", "护照", "户口"], sectionKey: "identityAndAuthorization" },
    { patterns: ["补充", "其他", "备注", "说明"], sectionKey: "additional" },
  ];

  const fieldRuntimeMap = new Map();
  const radioScopeIds = new WeakMap();
  const repeatGroupIds = new WeakMap();
  let radioScopeSequence = 0;
  let repeatGroupSequence = 0;

  let lastFieldCount = 0;
  let lastMappedCount = 0;
  let lastFilledCount = 0;
  let isWorking = false;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const action = message?.action;

    if (action === "ping") {
      sendResponse({
        success: true,
        version: contentBridge.CONTENT_SCRIPT_VERSION,
        capabilities: {
          fullDiagnostics: true,
        },
      });
      return;
    }

    if (action === "getStatus") {
      sendResponse({
        success: true,
        fieldCount: lastFieldCount,
        mappedCount: lastMappedCount,
        filledCount: lastFilledCount,
      });
      return;
    }

    if (action === "startFill") {
    handleStartFill(message.modelId, message.resumeProfile, {
        fillMode: message.fillMode,
        scope: message.scope,
      })
        .then((result) => sendResponse(result))
        .catch((error) =>
          sendResponse({ success: false, message: error?.message || String(error) })
        );
      return true;
    }
  });

  async function handleStartFill(modelId, resumeProfile, request = {}) {
    if (isWorking) {
      return { success: false, message: "正在执行中，请稍后再试" };
    }

    isWorking = true;

    try {
      if (!resumeProfile || typeof resumeProfile !== "object") {
        throw new Error("标准简历为空：请先在侧边栏填写或导入标准简历");
      }

      const descriptionResult = localAwardImport.fillAwardDescriptions(resumeProfile);
      resumeProfile = descriptionResult.profile;
      if (descriptionResult.updated > 0) {
        sendLog("info", `已为 ${descriptionResult.updated} 条竞赛获奖补充本地描述`);
      }

      const fillMode = request?.fillMode === "incremental" ? "incremental" : "overwrite";
      const scope = request?.scope === "selection" ? "selection" : "page";
      let selectionRect = null;

      if (scope === "selection") {
        sendLog("info", "已进入选区模式：请在页面上拖拽框选要填写的区域。");
        selectionRect = await requestSelectionRect();
        if (!selectionRect) {
          return {
            success: false,
            canceled: true,
            message: "已取消选区填入",
          };
        }
        sendLog(
          "info",
          `选区已确认：left=${Math.round(selectionRect.left)} top=${Math.round(
            selectionRect.top
          )} width=${Math.round(selectionRect.width)} height=${Math.round(selectionRect.height)}`
        );
      }

      if (scope === "page") {
        sendLog("info", "正在探索页面上的可展开区块...");
        await triggerExpandableSections(resumeProfile);
        sendLog("info", "正在检查是否需要自动新增经历条目...");
        await expandPageRepeatedSections(resumeProfile);
      }

      sendLog(
        "info",
        scope === "selection" ? "开始扫描选区内表单字段..." : "开始扫描当前页面表单字段..."
      );
      const scan = scanFields({ scope, selectionRect });

      lastFieldCount = scan.fields.length;
      lastMappedCount = 0;
      lastFilledCount = 0;

      fieldRuntimeMap.clear();
      for (const runtime of scan.runtime) {
        fieldRuntimeMap.set(runtime.fieldId, runtime);
      }

      for (const field of scan.fields) {
        sendLog("info", diagnostics.formatFieldSummary(field));
      }

      sendStats(lastFieldCount, 0, 0);

      if (lastFieldCount === 0) {
        return {
          success: false,
          message:
            scope === "selection"
              ? "选区内未识别到可填写字段，请重新框选后再试"
              : "未识别到可填写字段，请确认当前页面包含表单",
        };
      }

      const cacheSignature = createMappingCacheSignature(scan.fields);
      const cacheKey = createMappingCacheKeyFromSignature(cacheSignature);
      let mappings = null;
      let cacheHit = false;

      const cacheLookup = await loadMappingCacheEntry(cacheKey, {
        host: location.host,
        path: location.pathname,
        signature: cacheSignature,
      });
      const cachedEntry = cacheLookup.entry;
      if (cachedEntry?.mappings?.length) {
        mappings = normalizeMappings(cachedEntry.mappings, scan.fields);
        cacheHit = true;
        sendLog("info", "已命中本地字段映射缓存，跳过模型调用。");
      } else {
        sendLog("info", `[缓存] 未命中 reason="${cacheLookup.reason || "未知原因"}"`);
        sendLog(
          "info",
          `已识别 ${lastFieldCount} 个字段，正在调用 AI 建立字段映射...`
        );

        const promptPayload = buildFieldMappingPayload(scan.fields, resumeProfile);
        const aiText = await aiClient.callAI(
          modelId,
          JSON.stringify(promptPayload),
          "field_mapping"
        );
        const parsed = parseJsonFromAiText(aiText);
        mappings = normalizeMappings(parsed?.mappings, scan.fields);

        await saveMappingCacheEntry(cacheKey, {
          updatedAt: Date.now(),
          mappings,
          host: location.host,
          path: location.pathname,
          signature: cacheSignature,
        });

        sendLog("success", "字段映射已生成，并已写入本地缓存。");
      }

      const mappingById = new Map();
      for (const mapping of mappings || []) {
        if (!mapping?.fieldId) continue;
        mappingById.set(String(mapping.fieldId), mapping);
      }

      for (const field of scan.fields) {
        const mapping = mappingById.get(field.fieldId) || {
          fieldId: field.fieldId,
          resumePath: "",
          reason: "未返回映射结果",
          transform: { type: "none" },
        };
        const level = mapping.resumePath ? "info" : "warning";
        sendLog(
          level,
          diagnostics.formatMappingSummary(field, mapping, {
            source: cacheHit ? "cache" : "ai",
          })
        );
      }

      lastMappedCount = Array.from(mappingById.values()).filter((item) =>
        Boolean(String(item.resumePath || "").trim())
      ).length;

      sendStats(lastFieldCount, lastMappedCount, 0);
      sendLog(
        "info",
        fillMode === "incremental"
          ? "开始根据映射结果执行增量填充..."
          : "开始根据映射结果执行本地填充..."
      );

      let filledCount = 0;

      for (const field of scan.fields) {
        const mapping = mappingById.get(field.fieldId);
        if (!mapping?.resumePath) {
          sendLog(
            "warning",
            diagnostics.formatSkipSummary(
              field,
              mapping,
              "AI 未匹配到可用的标准简历字段",
              "",
              ""
            )
          );
          continue;
        }

        const runtime = fieldRuntimeMap.get(field.fieldId);
        if (fillMode === "incremental" && hasExistingFieldValue(runtime)) {
          sendLog(
            "warning",
            diagnostics.formatSkipSummary(
              field,
              mapping,
              "字段已有内容，增量模式下不覆盖",
              "",
              ""
            )
          );
          continue;
        }

        const resolvedCommonValue = commonFieldFill.resolveCommonFieldValue(
          resumeProfile,
          field
        );
        const resolvedAwardName = awardFill.resolveAwardNameValue(
          resumeProfile,
          mapping.resumePath,
          mappings
        );
        const rawValue =
          resolvedCommonValue ||
          resolvedAwardName ||
          schema.getValueByPath(resumeProfile, mapping.resumePath);
        const finalValue = deriveFillValue(rawValue, mapping.transform, runtime);

        sendLog(
          "info",
          diagnostics.formatValueSummary(field, mapping, rawValue, finalValue)
        );

        if (!hasMeaningfulFillValue(finalValue)) {
          sendLog(
            "warning",
            diagnostics.formatSkipSummary(
              field,
              mapping,
              "标准简历中没有可填写的值，或转换后为空",
              rawValue,
              finalValue
            )
          );
          continue;
        }

        const fillResult = await fillOne(runtime, finalValue, { overwrite: fillMode !== "incremental" });
        sendLog(
          fillResult.filled ? "success" : "warning",
          diagnostics.formatFillSummary({
            field,
            mapping,
            rawValue,
            finalValue,
            fillResult,
          })
        );
        if (fillResult.filled) {
          filledCount += 1;
        }
      }

      lastFilledCount = filledCount;
      sendStats(lastFieldCount, lastMappedCount, lastFilledCount);
      sendLog(
        "success",
        `填充完成：映射 ${lastMappedCount}/${lastFieldCount} 个字段，成功填充 ${lastFilledCount} 个。请检查后手动提交。`
      );

      return {
        success: true,
        fieldCount: lastFieldCount,
        mappedCount: lastMappedCount,
        filledCount: lastFilledCount,
        cacheHit,
      };
    } finally {
      isWorking = false;
    }
  }

  function normalizeDeepScanText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[＊*]+$/g, "")
      .trim();
  }

  function getDeepScanText(el) {
    return normalizeDeepScanText(
      [
        el?.textContent,
        el?.getAttribute?.("aria-label"),
        el?.getAttribute?.("title"),
      ]
        .filter(Boolean)
        .join(" ")
    );
  }

  function getDeepScanTargetElements(el) {
    const targets = [];
    const targetIds = [
      el?.getAttribute?.("aria-controls"),
      el?.getAttribute?.("data-target"),
      el?.getAttribute?.("data-toggle-target"),
    ]
      .filter(Boolean)
      .flatMap((value) => String(value).split(/\s+/));

    for (const targetId of targetIds) {
      const normalizedTargetId = targetId.startsWith("#")
        ? targetId.slice(1)
        : targetId;
      const target = el?.ownerDocument?.getElementById?.(normalizedTargetId);
      if (target) targets.push(target);
    }

    const href = el?.getAttribute?.("href") || "";
    if (href.startsWith("#")) {
      const target = el?.ownerDocument?.getElementById?.(href.slice(1));
      if (target) targets.push(target);
    }

    return targets;
  }

  function hasHiddenDeepScanTarget(el) {
    return getDeepScanTargetElements(el).some((target) => {
      if (target.hidden || target.getAttribute?.("aria-hidden") === "true") {
        return true;
      }
      return !isVisible(target);
    });
  }

  function isDeepScanExpandTrigger(el) {
    if (!el) return false;
    const tagName = String(el.tagName || "").toLowerCase();
    const role = String(el.getAttribute?.("role") || "").toLowerCase();
    if (tagName !== "button" && tagName !== "a" && role !== "button") {
      return false;
    }
    if (el.disabled || el.getAttribute?.("aria-disabled") === "true") {
      return false;
    }
    if (String(el.getAttribute?.("type") || "").toLowerCase() === "submit") {
      return false;
    }
    if (el.getAttribute?.("aria-haspopup")) return false;
    if (el.getAttribute?.("aria-expanded") === "true") return false;

    const text = getDeepScanText(el);
    if (!text || DEEP_SCAN_EXCLUDE_KEYWORDS.some((keyword) => text.includes(keyword))) {
      return false;
    }

    const className = normalizeDeepScanText(el.className || "");
    const hasExplicitExpandText = DEEP_SCAN_EXPAND_KEYWORDS.some((keyword) =>
      text.includes(keyword)
    );
    const hasCollapsedState =
      el.getAttribute?.("aria-expanded") === "false" ||
      el.getAttribute?.("data-expanded") === "false" ||
      hasHiddenDeepScanTarget(el);
    const hasExpandClass = /(^|[-_])expand(?:ed|able)?([_-]|$)/.test(className);
    const hasMoreText = DEEP_SCAN_MORE_KEYWORDS.some((keyword) => text.includes(keyword));

    if (hasExplicitExpandText) return true;
    if (hasExpandClass && hasCollapsedState) return true;
    return hasMoreText && hasCollapsedState;
  }

  function hasSectionContent(profile, sectionKey) {
    const section = profile?.[sectionKey];
    if (!section) return false;
    if (Array.isArray(section)) {
      return section.some((item) =>
        item && typeof item === "object"
          ? Object.values(item).some((value) => String(value || "").trim())
          : Boolean(String(item || "").trim())
      );
    }
    if (typeof section === "object") {
      return Object.values(section).some((value) => String(value || "").trim());
    }
    return Boolean(String(section).trim());
  }

  function deepScanButtonMatchesProfile(el, resumeProfile) {
    if (!resumeProfile) return true;
    const text = getDeepScanText(el);
    const matchedSections = DEEP_SCAN_SECTION_MAP.filter((entry) =>
      entry.patterns.some((pattern) => text.includes(normalizeDeepScanText(pattern)))
    );
    if (matchedSections.length === 0) return true;
    return matchedSections.some((entry) => hasSectionContent(resumeProfile, entry.sectionKey));
  }

  function findDeepScanButtons(clickedElements, resumeProfile) {
    const selectors = [
      'button:not([type="submit"])',
      '[role="button"]',
      'a[class*="expand"], a[class*="Expand"]',
      'a[class*="more"], a[class*="More"]',
    ];
    return Array.from(document.querySelectorAll(selectors.join(","))).filter((el) => {
      if (!isVisible(el) || clickedElements.has(el)) return false;
      return isDeepScanExpandTrigger(el) && deepScanButtonMatchesProfile(el, resumeProfile);
    });
  }

  async function waitForNewFields(startCount) {
    if (countControls(document) > startCount) return true;

    return new Promise((resolve) => {
      let settled = false;
      let initialTimer = null;
      let timeoutTimer = null;
      const observer =
        typeof MutationObserver === "function"
          ? new MutationObserver(check)
          : null;

      function finish(found) {
        if (settled) return;
        settled = true;
        if (initialTimer) clearTimeout(initialTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        observer?.disconnect();
        resolve(found);
      }

      function check() {
        if (countControls(document) > startCount) {
          finish(true);
        }
      }

      observer?.observe(document.body || document.documentElement || document, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class", "hidden", "style", "aria-hidden"],
      });
      initialTimer = setTimeout(check, DEEP_SCAN_INITIAL_DELAY);
      timeoutTimer = setTimeout(() => finish(false), DEEP_SCAN_POLL_TIMEOUT);
    });
  }

  async function triggerExpandableSections(resumeProfile) {
    const clickedElements = new WeakSet();
    let totalClicked = 0;

    for (
      let round = 0;
      round < DEEP_SCAN_MAX_ROUNDS && totalClicked < DEEP_SCAN_MAX_CLICKS;
      round += 1
    ) {
      const buttons = findDeepScanButtons(clickedElements, resumeProfile);
      if (buttons.length === 0) break;

      sendLog("info", `深度扫描第 ${round + 1} 轮：发现 ${buttons.length} 个可展开区块`);

      for (const button of buttons.slice(0, DEEP_SCAN_MAX_CLICKS - totalClicked)) {
        const startCount = countControls(document);
        scrollIntoView(button);
        clickLikeUser(button);
        clickedElements.add(button);
        totalClicked += 1;

        if (await waitForNewFields(startCount)) {
          sendLog("info", `已触发第 ${totalClicked} 个展开按钮，检测到新字段`);
        }
      }
    }

    if (totalClicked > 0) {
      sendLog("success", `深度扫描完成：共触发 ${totalClicked} 个展开按钮`);
    }
    return totalClicked;
  }

  function getRepeatAddButtonContext(el) {
    const contextParts = [];
    const region = el?.parentElement?.closest?.(
      'fieldset,section,article,[class*="section"],[class*="Section"],[class*="experience"],[class*="Experience"],[class*="award"],[class*="Award"],[class*="module"],[class*="Module"]'
    );
    const headingNodes = region?.querySelectorAll?.(HEADING_LIKE_SELECTOR) || [];
    for (const node of Array.from(headingNodes).slice(0, 4)) {
      if (node === el || node.contains?.(el)) continue;
      const text = String(node.textContent || "").trim().slice(0, 120);
      if (text) contextParts.push(text);
    }
    const regionText = String(region?.textContent || "").trim().slice(0, 800);
    if (regionText) contextParts.push(regionText);

    let sibling = (region || el?.parentElement)?.previousElementSibling;
    for (let index = 0; sibling && index < 3; index += 1) {
      const text = String(sibling.textContent || "").trim().slice(0, 160);
      if (text) contextParts.push(text);
      sibling = sibling.previousElementSibling;
    }
    return contextParts.join(" ");
  }

  function findRepeatAddCandidates() {
    return Array.from(
      document.querySelectorAll(repeatExpansion.REPEAT_ADD_CONTROL_SELECTOR)
    )
      .filter((el) => isVisible(el))
      .map((el) => ({
        el,
        disabled: Boolean(el.disabled || el.getAttribute?.("aria-disabled") === "true"),
        text: [
          el.textContent,
          el.getAttribute?.("aria-label"),
          el.getAttribute?.("title"),
          el.className,
        ]
          .filter(Boolean)
          .join(" "),
        context: getRepeatAddButtonContext(el),
      }));
  }

  async function waitForRepeatedSectionGrowth(sectionKey, startCount) {
    const deadline = Date.now() + 1600;
    while (Date.now() < deadline) {
      await sleep(120);
      const fields = scanFields({ scope: "page" }).fields;
      const current = repeatExpansion.countRenderedRecords(fields)[sectionKey] || 0;
      if (current > startCount) return true;
    }
    return false;
  }

  async function expandPageRepeatedSections(resumeProfile) {
    const result = await repeatExpansion.expandRepeatedSections({
      profile: resumeProfile,
      scan: () => scanFields({ scope: "page" }).fields,
      listCandidates: () => findRepeatAddCandidates(),
      clickCandidate: async (candidate, sectionKey) => {
        const config = repeatExpansion.getSectionConfig(sectionKey);
        sendLog("info", `自动新增${config?.label || "经历"}：正在创建下一条记录`);
        scrollIntoView(candidate.el);
        clickLikeUser(candidate.el);
      },
      waitForGrowth: waitForRepeatedSectionGrowth,
      maxClicks: DEEP_SCAN_MAX_CLICKS,
    });

    if (result.totalClicked > 0) {
      sendLog("success", `自动新增完成：共创建 ${result.totalClicked} 条经历记录`);
    }
    for (const item of result.unresolved) {
      const config = repeatExpansion.getSectionConfig(item.sectionKey);
      const reason =
        item.reason === "missing-button"
          ? "未找到可靠的新增按钮"
          : item.reason === "no-growth"
            ? "点击后页面没有生成新记录"
            : "已达到安全点击上限";
      sendLog(
        "warning",
        `${config?.label || item.sectionKey}需要 ${item.desired} 条，当前 ${item.current} 条；${reason}，将继续填写现有记录。`
      );
    }
    return result;
  }

  function buildFieldMappingPayload(fields, resumeProfile) {
    const resumeFields = schema
      .getCatalogWithValues(resumeProfile)
      .filter((field) => field.hasValue)
      .map((field) => ({
        path: field.path,
        label: field.label,
        sectionLabel: field.sectionLabel,
        itemLabel: field.itemLabel || "",
        input: field.input,
        hasValue: field.hasValue,
        valuePreview: field.valuePreview,
        options: field.options || [],
      }));

    return {
      url: sanitizePageUrl(location.href),
      title: String(document.title || "").slice(0, 120),
      allowedTransforms: [
        { type: "none" },
        { type: "date_part", part: "year|month|day" },
        { type: "phone_part", part: "countryCode|nationalNumber" },
        { type: "boolean_choice", trueValue: "text", falseValue: "text" },
        { type: "join", separator: ", " },
      ],
      fields,
      resumeFields,
    };
  }

  function sanitizePageUrl(value) {
    const rawUrl = String(value || "");
    if (typeof URL !== "function") {
      return rawUrl.split(/[?#]/, 1)[0];
    }

    try {
      const url = new URL(rawUrl);
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch (_) {
      return rawUrl.split(/[?#]/, 1)[0];
    }
  }

  function normalizeRepeatFieldLabel(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/^(请填写|请选择|请输入)/g, "")
      .replace(/[＊*:：]+$/g, "");
  }

  function assignRepeatedItemIndexes(fields) {
    awardFill.annotateAwardFields(fields);
    const occurrences = new Map();
    const groupedIndexes = new Map();

    for (const field of Array.isArray(fields) ? fields : []) {
      if (!repeatExpansion.getSectionConfig(field?.sectionKey)) continue;
      if (field.repeatGroupId) {
        if (!groupedIndexes.has(field.sectionKey)) {
          groupedIndexes.set(field.sectionKey, new Map());
        }
        const sectionGroups = groupedIndexes.get(field.sectionKey);
        if (!sectionGroups.has(field.repeatGroupId)) {
          sectionGroups.set(field.repeatGroupId, sectionGroups.size);
        }
        field.repeatIndex = sectionGroups.get(field.repeatGroupId);
        continue;
      }
      if (field.sectionKey === "award" && Number.isInteger(field.repeatIndex)) continue;

      const labelKey = normalizeRepeatFieldLabel(
        field.label || field.name || field.placeholder
      );
      if (!labelKey) continue;

      const occurrenceKey = `${field.sectionKey}:${labelKey}`;
      const repeatIndex = occurrences.get(occurrenceKey) || 0;
      field.repeatIndex = repeatIndex;
      occurrences.set(occurrenceKey, repeatIndex + 1);
    }

    return fields;
  }

  function alignRepeatedResumePath(resumePath, field) {
    if (!Number.isInteger(field?.repeatIndex)) {
      return resumePath;
    }

    if (!repeatExpansion.getSectionConfig(field.sectionKey)) return resumePath;
    const match = String(resumePath || "").match(
      /^(educations|internships|workExperiences|projects|campusExperiences|awards|certificates|languages)\.\d+\.(.+)$/
    );
    if (!match) return resumePath;

    return `${match[1]}.${field.repeatIndex}.${match[2]}`;
  }

  function normalizeMappings(rawMappings, fields) {
    const validFieldIds = new Set(fields.map((field) => String(field.fieldId)));
    const fieldById = new Map(
      fields.map((field) => [String(field.fieldId), field])
    );
    const validResumePaths = new Set(
      schema.getFieldCatalog({ mode: "max" }).map((field) => field.path)
    );
    const normalized = [];
    const normalizedFieldIds = new Set();

    for (const item of Array.isArray(rawMappings) ? rawMappings : []) {
      const fieldId = String(item?.fieldId || "").trim();
      if (!fieldId || !validFieldIds.has(fieldId)) continue;

      const requestedResumePath = String(item?.resumePath || "").trim();
      const field = fieldById.get(fieldId);
      const deterministicAwardPath = awardFill.getDeterministicAwardPath(field);
      const deterministicCommonPath = commonFieldFill.getDeterministicCommonPath(field);
      const resumePath =
        deterministicAwardPath ||
        deterministicCommonPath ||
        alignRepeatedResumePath(requestedResumePath, field);
      const transform = deterministicCommonPath
        ? { type: "none" }
        : normalizeTransform(item?.transform);
      normalized.push({
        fieldId,
        resumePath: resumePath && validResumePaths.has(resumePath) ? resumePath : "",
        reason: String(item?.reason || "").trim().slice(0, 240),
        transform,
      });
      normalizedFieldIds.add(fieldId);
    }

    for (const field of fields) {
      const fieldId = String(field?.fieldId || "").trim();
      if (!fieldId || normalizedFieldIds.has(fieldId)) continue;
      const awardPath = awardFill.getDeterministicAwardPath(field);
      const commonPath = commonFieldFill.getDeterministicCommonPath(field);
      const resumePath = awardPath || commonPath;
      if (!resumePath || !validResumePaths.has(resumePath)) continue;
      normalized.push({
        fieldId,
        resumePath,
        reason: awardPath ? "本地竞赛获奖字段规则" : "本地常见校招字段规则",
        transform: { type: "none" },
      });
    }

    return normalized;
  }

  function normalizeTransform(transform) {
    if (!transform || typeof transform !== "object") {
      return { type: "none" };
    }

    const type = String(transform.type || "none").trim();

    if (type === "date_part") {
      const part = ["year", "month", "day"].includes(transform.part)
        ? transform.part
        : "year";
      return { type, part };
    }

    if (type === "phone_part") {
      const part =
        transform.part === "countryCode" ? "countryCode" : "nationalNumber";
      return { type, part };
    }

    if (type === "boolean_choice") {
      return {
        type,
        trueValue: String(transform.trueValue ?? "Yes"),
        falseValue: String(transform.falseValue ?? "No"),
      };
    }

    if (type === "join") {
      return {
        type,
        separator: String(transform.separator || ", "),
      };
    }

    return { type: "none" };
  }

  function deriveFillValue(rawValue, transform, runtime) {
    if (!hasSourceValue(rawValue)) {
      return "";
    }

    const normalizedTransform = normalizeTransform(transform);

    if (runtime?.datePart) {
      return getDatePart(rawValue, runtime.datePart);
    }

    if (normalizedTransform.type === "date_part") {
      return getDatePart(rawValue, normalizedTransform.part);
    }

    if (normalizedTransform.type === "phone_part") {
      return getPhonePart(rawValue, normalizedTransform.part);
    }

    if (normalizedTransform.type === "boolean_choice") {
      return isAffirmative(rawValue)
        ? normalizedTransform.trueValue
        : normalizedTransform.falseValue;
    }

    if (normalizedTransform.type === "join") {
      return joinValue(rawValue, normalizedTransform.separator);
    }

    if (runtime?.kind === "checkbox_group") {
      return normalizeCheckboxCandidates(rawValue);
    }

    return rawValue;
  }

  function hasSourceValue(value) {
    if (Array.isArray(value)) {
      return value.some((item) => String(item || "").trim());
    }

    return String(value ?? "").trim().length > 0;
  }

  function normalizeCheckboxCandidates(value) {
    if (Array.isArray(value)) {
      return value.map((item) => String(item || "").trim()).filter(Boolean);
    }

    const text = String(value || "").trim();
    if (!text) return [];

    return text
      .split(/[\n,，;/]/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function hasMeaningfulFillValue(value) {
    if (Array.isArray(value)) {
      return value.some((item) => String(item || "").trim());
    }

    return String(value ?? "").trim().length > 0;
  }

  function getDatePart(value, part) {
    const text = String(value || "").trim();
    if (!text) return "";

    const match = text.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/);
    if (!match) return "";

    if (part === "year") return match[1] || "";
    if (part === "month") return match[2] ? match[2].padStart(2, "0") : "";
    return match[3] ? match[3].padStart(2, "0") : "";
  }

  function getPhonePart(value, part) {
    const text = String(value || "").trim();
    if (!text) return "";

    if (part === "countryCode") {
      const match = text.match(/^\+?\d{1,4}/);
      return match ? match[0] : "";
    }

    return text.replace(/^\+?\d{1,4}[\s-]*/, "").trim();
  }

  function joinValue(value, separator) {
    if (Array.isArray(value)) {
      return value.map((item) => String(item || "").trim()).filter(Boolean).join(separator);
    }

    return String(value || "").trim();
  }

  async function requestSelectionRect() {
    cleanupSelectionOverlay();

    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.id = SELECTION_OVERLAY_ID;
      overlay.className = "ai-resume-selection-overlay";

      const box = document.createElement("div");
      box.id = SELECTION_BOX_ID;
      box.className = "ai-resume-selection-box";
      box.hidden = true;

      const hint = document.createElement("div");
      hint.id = SELECTION_HINT_ID;
      hint.className = "ai-resume-selection-hint";
      hint.textContent = "拖拽框选要填写的区域，按 Esc 取消";

      overlay.appendChild(box);
      overlay.appendChild(hint);
      document.documentElement.appendChild(overlay);

      let startPoint = null;
      let isDragging = false;

      const cleanup = () => {
        window.removeEventListener("keydown", onKeyDown, true);
        overlay.removeEventListener("pointerdown", onPointerDown, true);
        overlay.removeEventListener("pointermove", onPointerMove, true);
        overlay.removeEventListener("pointerup", onPointerUp, true);
        overlay.removeEventListener("pointercancel", onPointerCancel, true);
        overlay.remove();
      };

      const finish = (rect) => {
        cleanup();
        resolve(rect);
      };

      const onKeyDown = (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        finish(null);
      };

      const onPointerDown = (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        startPoint = { x: event.clientX, y: event.clientY };
        isDragging = true;
        box.hidden = false;
        updateSelectionBox(box, startPoint, startPoint);
      };

      const onPointerMove = (event) => {
        if (!isDragging || !startPoint) return;
        event.preventDefault();
        updateSelectionBox(box, startPoint, { x: event.clientX, y: event.clientY });
      };

      const onPointerCancel = (event) => {
        event.preventDefault();
        finish(null);
      };

      const onPointerUp = (event) => {
        if (!isDragging || !startPoint) {
          finish(null);
          return;
        }

        event.preventDefault();
        const rect = normalizeSelectionRect(startPoint, {
          x: event.clientX,
          y: event.clientY,
        });
        isDragging = false;
        startPoint = null;

        if (!rect || rect.width < MIN_SELECTION_SIZE || rect.height < MIN_SELECTION_SIZE) {
          finish(null);
          return;
        }

        finish(rect);
      };

      window.addEventListener("keydown", onKeyDown, true);
      overlay.addEventListener("pointerdown", onPointerDown, true);
      overlay.addEventListener("pointermove", onPointerMove, true);
      overlay.addEventListener("pointerup", onPointerUp, true);
      overlay.addEventListener("pointercancel", onPointerCancel, true);
    });
  }

  function cleanupSelectionOverlay() {
    document.getElementById(SELECTION_OVERLAY_ID)?.remove();
  }

  function updateSelectionBox(box, startPoint, endPoint) {
    if (!box) return;
    const rect = normalizeSelectionRect(startPoint, endPoint);
    if (!rect) return;

    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
  }

  function normalizeSelectionRect(startPoint, endPoint) {
    if (!startPoint || !endPoint) return null;
    const left = Math.min(startPoint.x, endPoint.x);
    const top = Math.min(startPoint.y, endPoint.y);
    const right = Math.max(startPoint.x, endPoint.x);
    const bottom = Math.max(startPoint.y, endPoint.y);

    return {
      left,
      top,
      right,
      bottom,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  }

  function scanFields({ scope = "page", selectionRect = null } = {}) {
    const root = scope === "selection" ? document : pickLikelyFormRoot();
    const elements = collectControls(root);

    const fields = [];
    const runtime = [];

    let idSeq = 0;
    const radioGroups = new Map();
    const checkboxGroups = new Map();

    for (const el of elements) {
      if (!isFillableElement(el)) continue;

      const tag = el.tagName.toLowerCase();
      const baseInputType = tag === "input"
        ? String(el.getAttribute("type") || "text").toLowerCase()
        : "";
      const semanticMeta = buildFieldSemanticMeta(el, {
        kind: tag === "textarea" ? "textarea" : tag === "select" ? "select" : "text",
        inputType: baseInputType,
      });
      const mokaDateMeta = getMokaDateMeta(el);
      const repeatGroupId = getMokaRepeatGroupId(el);
      const commonMeta = {
        required: Boolean(el.required || el.getAttribute("aria-required") === "true"),
        context: semanticMeta.context,
        sectionKey: semanticMeta.sectionKey,
        sectionLabel: semanticMeta.sectionLabel,
        sectionEvidence: semanticMeta.sectionEvidence,
        nearbyLabels: semanticMeta.nearbyLabels,
        ...getMokaSectionMeta(el),
        ...(mokaDateMeta || {}),
        ...(repeatGroupId ? { repeatGroupId } : {}),
      };

      if (isPhoenixRadioGroup(el)) {
        const fieldId = `f_${++idSeq}`;
        const options = getPhoenixRadioOptions(el);
        fields.push({
          fieldId,
          kind: "radio_group",
          label: semanticMeta.label || getGroupLabel(el),
          name: el.getAttribute("name") || "",
          options: options.map((option) => option.label),
          ...commonMeta,
        });
        runtime.push({
          fieldId,
          kind: "custom_radio_group",
          el,
          options,
        });
        continue;
      }

      if (tag === "select") {
        const fieldId = `f_${++idSeq}`;
        const options = Array.from(el.options || [])
          .map((opt) => String(opt.textContent || "").trim())
          .filter(Boolean)
          .slice(0, 60);

        fields.push({
          fieldId,
          kind: "select",
          label: semanticMeta.label,
          name: el.getAttribute("name") || "",
          id: el.id || "",
          placeholder: "",
          options,
          ...commonMeta,
        });

        runtime.push({ fieldId, kind: "select", el });
        continue;
      }

      if (tag === "textarea") {
        const fieldId = `f_${++idSeq}`;
        fields.push({
          fieldId,
          kind: "textarea",
          label: semanticMeta.label,
          name: el.getAttribute("name") || "",
          id: el.id || "",
          placeholder: el.getAttribute("placeholder") || "",
          ...commonMeta,
        });

        runtime.push({ fieldId, kind: "textarea", el });
        continue;
      }

      const isContentEditable =
        el.getAttribute("contenteditable") === "true" ||
        el.getAttribute("contenteditable") === "";
      if (isContentEditable) {
        const fieldId = `f_${++idSeq}`;
        fields.push({
          fieldId,
          kind: "contenteditable",
          label: semanticMeta.label,
          name: el.getAttribute("name") || "",
          id: el.id || "",
          placeholder: el.getAttribute("placeholder") || "",
          ...commonMeta,
        });

        runtime.push({ fieldId, kind: "contenteditable", el });
        continue;
      }

      if (tag !== "input") continue;

      const type = baseInputType;
      if (
        [
          "hidden",
          "password",
          "submit",
          "button",
          "reset",
          "image",
          "range",
          "color",
        ].includes(type)
      ) {
        continue;
      }

      if (type === "file") {
        const fieldId = `f_${++idSeq}`;
        fields.push({
          fieldId,
          kind: "file",
          label: semanticMeta.label,
          name: el.getAttribute("name") || "",
          id: el.id || "",
          placeholder: "",
          inputType: type,
          ...commonMeta,
        });

        runtime.push({ fieldId, kind: "file", inputType: type, el });
        continue;
      }

      if (type === "radio" || type === "checkbox") {
        const name = el.getAttribute("name") || el.id || "";
        const groupScope =
          el.closest?.('form, fieldset, [role="radiogroup"], [role="group"]') ||
          el.parentElement ||
          el;
        const groupKey = `${type}:${getRadioScopeId(groupScope)}:${name || "(no-name)"}`;
        const groupMap = type === "radio" ? radioGroups : checkboxGroups;

        if (!groupMap.has(groupKey)) {
          const groupMeta = buildFieldSemanticMeta(el, {
            kind: type === "radio" ? "radio_group" : "checkbox_group",
            inputType: type,
          });
          groupMap.set(groupKey, {
            type,
            name,
            elements: [],
            label: groupMeta.label || getGroupLabel(el),
            context: groupMeta.context,
            sectionKey: groupMeta.sectionKey,
            sectionLabel: groupMeta.sectionLabel,
            sectionEvidence: groupMeta.sectionEvidence,
            nearbyLabels: groupMeta.nearbyLabels,
          });
        }

        groupMap.get(groupKey).elements.push(el);
        continue;
      }

      if (isPhoenixSelectInput(el, semanticMeta) || isMokaSelectInput(el)) {
        const fieldId = `f_${++idSeq}`;
        const provider = isMokaSelectInput(el) ? "moka" : "phoenix";
        fields.push({
          fieldId,
          kind: "select",
          inputType: type,
          label: semanticMeta.label,
          name: el.getAttribute("name") || "",
          id: el.id || "",
          placeholder: el.getAttribute("placeholder") || "",
          options: [],
          ...commonMeta,
        });
        runtime.push({
          fieldId,
          kind: "custom_select",
          provider,
          inputType: type,
          el,
          wrapper:
            provider === "moka"
              ? el.closest('[class*="sd-Dropdown-container-"]')
              : el.closest(".phoenix-select"),
          label: semanticMeta.label,
          ...(mokaDateMeta || {}),
        });
        continue;
      }

      const fieldId = `f_${++idSeq}`;
      fields.push({
        fieldId,
        kind: "text",
        inputType: type,
        label: semanticMeta.label,
        name: el.getAttribute("name") || "",
        id: el.id || "",
        placeholder: el.getAttribute("placeholder") || "",
        autocomplete: el.getAttribute("autocomplete") || "",
        ...commonMeta,
      });

      runtime.push(buildTextLikeRuntime(fieldId, el, type, semanticMeta));
    }

    for (const group of radioGroups.values()) {
      const fieldId = `f_${++idSeq}`;
      const options = group.elements
        .map((input) => ({
          label: getOptionLabel(input),
          value: input.value || "",
        }))
        .filter((item) => item.label || item.value)
        .slice(0, 80);

      fields.push({
        fieldId,
        kind: "radio_group",
        label: group.label,
        name: group.name,
        options: options.map((item) => item.label || item.value),
        context: group.context,
        sectionKey: group.sectionKey,
        sectionLabel: group.sectionLabel,
        sectionEvidence: group.sectionEvidence,
        nearbyLabels: group.nearbyLabels,
        required: group.elements.some(
          (input) => input.required || input.getAttribute("aria-required") === "true"
        ),
      });

      runtime.push({
        fieldId,
        kind: "radio_group",
        options: group.elements.map((input) => ({
          el: input,
          label: getOptionLabel(input) || input.value || "",
          value: input.value || "",
        })),
      });
    }

    for (const group of checkboxGroups.values()) {
      const fieldId = `f_${++idSeq}`;
      const options = group.elements
        .map((input) => ({
          label: getOptionLabel(input),
          value: input.value || "",
        }))
        .filter((item) => item.label || item.value)
        .slice(0, 80);

      fields.push({
        fieldId,
        kind: "checkbox_group",
        label: group.label,
        name: group.name,
        options: options.map((item) => item.label || item.value),
        context: group.context,
        sectionKey: group.sectionKey,
        sectionLabel: group.sectionLabel,
        sectionEvidence: group.sectionEvidence,
        nearbyLabels: group.nearbyLabels,
        required: group.elements.some(
          (input) => input.required || input.getAttribute("aria-required") === "true"
        ),
      });

      runtime.push({
        fieldId,
        kind: "checkbox_group",
        options: group.elements.map((input) => ({
          el: input,
          label: getOptionLabel(input) || input.value || "",
          value: input.value || "",
        })),
      });
    }

    assignRepeatedItemIndexes(fields);

    if (scope === "selection" && selectionRect) {
      const allowedFieldIds = new Set();

      for (const item of runtime) {
        if (runtimeMatchesSelection(item, selectionRect)) {
          allowedFieldIds.add(item.fieldId);
        }
      }

      return {
        fields: fields.filter((field) => allowedFieldIds.has(field.fieldId)),
        runtime: runtime.filter((item) => allowedFieldIds.has(item.fieldId)),
      };
    }

    return { fields, runtime };
  }

  function getRadioScopeId(element) {
    if (!element || (typeof element !== "object" && typeof element !== "function")) {
      return "global";
    }

    if (!radioScopeIds.has(element)) {
      radioScopeSequence += 1;
      radioScopeIds.set(element, `scope-${radioScopeSequence}`);
    }
    return radioScopeIds.get(element);
  }

  function runtimeMatchesSelection(runtime, selectionRect) {
    const runtimeRect = getRuntimeViewportRect(runtime);
    if (!runtimeRect) return false;
    return rectsIntersect(runtimeRect, selectionRect);
  }

  function getRuntimeViewportRect(runtime) {
    if (!runtime) return null;

    if (runtime.el) {
      return rectFromDomRect(runtime.el.getBoundingClientRect());
    }

    if (Array.isArray(runtime.options) && runtime.options.length > 0) {
      const rects = runtime.options
        .map((option) => rectFromDomRect(option?.el?.getBoundingClientRect?.()))
        .filter(Boolean);
      return mergeRects(rects);
    }

    return null;
  }

  function rectFromDomRect(rect) {
    if (!rect) return null;
    const width = Number(rect.width || 0);
    const height = Number(rect.height || 0);
    if (width <= 0 || height <= 0) return null;

    return {
      left: Number(rect.left || 0),
      top: Number(rect.top || 0),
      right: Number(rect.right || 0),
      bottom: Number(rect.bottom || 0),
      width,
      height,
    };
  }

  function mergeRects(rects) {
    if (!Array.isArray(rects) || rects.length === 0) return null;

    const left = Math.min(...rects.map((rect) => rect.left));
    const top = Math.min(...rects.map((rect) => rect.top));
    const right = Math.max(...rects.map((rect) => rect.right));
    const bottom = Math.max(...rects.map((rect) => rect.bottom));

    return {
      left,
      top,
      right,
      bottom,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top),
    };
  }

  function rectsIntersect(leftRect, rightRect) {
    if (!leftRect || !rightRect) return false;
    return !(
      leftRect.right < rightRect.left ||
      leftRect.left > rightRect.right ||
      leftRect.bottom < rightRect.top ||
      leftRect.top > rightRect.bottom
    );
  }

  function pickLikelyFormRoot() {
    const forms = Array.from(document.querySelectorAll("form")).filter((form) =>
      isVisible(form)
    );
    if (forms.length === 0) return document;

    const ranked = forms
      .map((form) => ({ form, count: countControls(form) }))
      .sort((left, right) => right.count - left.count);

    if (ranked[0]?.count >= 2) {
      return ranked[0].form;
    }

    return document;
  }

  function countControls(root) {
    return collectControls(root).length;
  }

  function collectControls(root) {
    const scope = root || document;
    const selectors =
      'input, textarea, select, .phoenix-radio-group, [contenteditable="true"], [contenteditable=""]';

    return Array.from(scope.querySelectorAll(selectors)).filter((el) => isVisible(el));
  }

  function isFillableElement(el) {
    if (!el) return false;
    if (el.disabled) return false;
    if (el.getAttribute("aria-disabled") === "true") return false;
    return true;
  }

  function isPhoenixRadioGroup(el) {
    return Boolean(el?.classList?.contains?.("phoenix-radio-group"));
  }

  function isPhoenixSelectInput(el, semanticMeta = null) {
    if (!el?.classList?.contains?.("phoenix-select__input")) return false;
    if (!el.closest?.(".phoenix-select")) return false;

    const label = normalizeText(semanticMeta?.label || "");
    return !/(日期|时间)$/.test(label);
  }

  function isMokaSelectInput(el) {
    return Boolean(
      el?.closest?.('[class*="sd-Select-container-"]') &&
      el?.closest?.('[class*="sd-Dropdown-container-"]')
    );
  }

  function getMokaRepeatGroupId(el) {
    const group = el?.closest?.('[class*="apply-fields-"][class*="multi-"]');
    if (!group) return "";
    if (!repeatGroupIds.has(group)) {
      repeatGroupSequence += 1;
      repeatGroupIds.set(group, `moka-card-${repeatGroupSequence}`);
    }
    return repeatGroupIds.get(group);
  }

  function getMokaSectionMeta(el) {
    const card = el?.closest?.('[class*="apply-fields-"][class*="multi-"]');
    for (let node = card?.previousElementSibling; node; node = node.previousElementSibling) {
      if (!String(node.className || "").includes("blockTitle-")) continue;
      const title = normalizeText(node.textContent || "").replace(/添加/g, "").trim();
      const sectionKey = {
        "工作经历": "work", "实习经历": "internship",
        "教育背景": "education", "教育经历": "education",
        "项目经验": "project", "项目经历": "project",
        "获奖经历": "award", "语言能力": "language",
      }[title];
      return sectionKey ? { sectionKey, sectionLabel: title, sectionEvidence: [title] } : {};
    }
    return {};
  }

  function getMokaDateMeta(el) {
    if (!isMokaSelectInput(el)) return null;
    const range = el.closest?.(".month-range-select");
    if (!range) return null;
    const parts = Array.from(range.querySelectorAll?.("input") || []).filter((input) =>
      isMokaSelectInput(input)
    );
    const index = parts.indexOf(el);
    if (index < 0) return null;
    return {
      datePart: index % 2 === 1 ? "month" : "year",
      dateRole: parts.length >= 4 ? (index < 2 ? "start" : "end") : "date",
    };
  }

  function getPhoenixRadioOptions(groupEl) {
    return Array.from(
      groupEl?.querySelectorAll?.(".phoenix-radio-group__radioItem") || []
    )
      .map((item) => {
        const radio = item.querySelector?.(".phoenix-radio") || item;
        const labelNode = item.querySelector?.(".phoenix-radio__radio-text");
        return {
          el: radio,
          label: normalizeText(labelNode?.textContent || item.textContent || ""),
          value: normalizeText(labelNode?.textContent || item.textContent || ""),
        };
      })
      .filter((option) => option.label);
  }

  function isVisible(el) {
    try {
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || style.display === "none") return false;
      const rects = el.getClientRects();
      return rects && rects.length > 0;
    } catch (_) {
      return false;
    }
  }

  function buildFieldSemanticMeta(el, { kind = "text", inputType = "" } = {}) {
    const primaryCandidates = collectDirectFieldLabelCandidates(el);
    const nearbyLabels = collectNearbyLabelCandidates(el).slice(0, 6);
    const rawLabel = fieldText.selectBestFieldTextCandidate(primaryCandidates);
    const filteredNearbyLabels = nearbyLabels.filter((item) => item !== rawLabel);
    const section = fieldSemantics.inferSectionFromTexts([
      rawLabel,
      ...filteredNearbyLabels,
      ...collectSectionTextCandidates(el),
    ]);

    const label =
      rawLabel ||
      selectFallbackFieldLabel(filteredNearbyLabels, {
        kind,
        inputType,
        sectionLabel: section.label,
      });

    return {
      label,
      context: getFieldContext(el, {
        label,
        nearbyLabels: filteredNearbyLabels,
        sectionLabel: section.label,
      }),
      sectionKey: section.key || "",
      sectionLabel: section.label || "",
      sectionEvidence: section.evidence || "",
      nearbyLabels: filteredNearbyLabels.slice(0, 4),
    };
  }

  function buildTextLikeRuntime(fieldId, el, inputType, semanticMeta) {
    return {
      fieldId,
      kind: "text",
      inputType,
      el,
      readOnly: Boolean(el.readOnly || el.getAttribute("aria-readonly") === "true"),
      label: semanticMeta?.label || "",
      placeholder: el.getAttribute("placeholder") || "",
      context: semanticMeta?.context || "",
      nearbyLabels: semanticMeta?.nearbyLabels || [],
      hasCalendarIcon: Boolean(
        el.closest?.(
          '[class*="picker"],[class*="Picker"],[class*="calendar"],[class*="Calendar"],[class*="date"],[class*="Date"]'
        ) || el.parentElement?.querySelector?.(".mtdicon-calendar-o,[class*='calendar']")
      ),
    };
  }

  function getFieldLabel(el) {
    return buildFieldSemanticMeta(el).label;
  }

  function getFieldContext(el, { label = "", nearbyLabels = [], sectionLabel = "" } = {}) {
    const container = getStructuralContainer(el);
    const text = getRawFieldContext(container, el);
    if (text) {
      return text.length > 160 ? `${text.slice(0, 157)}...` : text;
    }

    const fallbackParts = [];
    pushUniqueMeaningfulText(fallbackParts, sectionLabel);
    for (const item of nearbyLabels) {
      if (item === label) continue;
      pushUniqueMeaningfulText(fallbackParts, item);
    }

    const fallback = fallbackParts.slice(0, 3).join(" / ");
    if (!fallback) return "";
    return fallback.length > 160 ? `${fallback.slice(0, 157)}...` : fallback;
  }

  function getRawFieldContext(container, skipNode) {
    return getNodeTextWithoutControls(container, {
      skipNode,
      maxLength: 240,
    });
  }

  function getGroupLabel(input) {
    const fieldset = input.closest?.("fieldset");
    const legendText = normalizeText(fieldset?.querySelector?.("legend")?.textContent || "");
    if (legendText) return legendText;

    const container =
      input.closest?.(
        '[class*="form"],[class*="Form"],[class*="field"],[class*="Field"],[class*="item"],[class*="Item"],[class*="row"],[class*="Row"]'
      ) || input.parentElement;

    const text = normalizeText(container?.textContent || "");
    return text ? text.slice(0, 80) : "";
  }

  function getOptionLabel(input) {
    const id = input.id;
    if (id) {
      const forLabel = document.querySelector(`label[for="${cssEscape(id)}"]`);
      const labelText = normalizeText(forLabel?.textContent || "");
      if (labelText) return labelText;
    }

    const wrapping = input.closest?.("label");
    const wrappingText = normalizeText(wrapping?.textContent || "");
    if (wrappingText) return wrappingText;

    const siblingCandidates = Array.from(input.parentElement?.children || [])
      .filter((node) => node && node !== input)
      .map((node) => normalizeText(node.textContent || ""))
      .filter((text) => fieldText.isMeaningfulFieldText(text));
    const siblingText = fieldText.selectBestFieldTextCandidate(siblingCandidates);
    if (siblingText) return siblingText;

    return "";
  }

  function normalizeText(text) {
    return fieldText.normalizeFieldText(text);
  }

  function collectDirectFieldLabelCandidates(el) {
    const candidates = [];

    pushUniqueMeaningfulText(candidates, el.getAttribute?.("aria-label"));

    const labelledBy = el.getAttribute?.("aria-labelledby");
    if (labelledBy) {
      const parts = labelledBy
        .split(/\s+/g)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((node) => normalizeText(node.textContent || ""));

      for (const part of parts) {
        pushUniqueMeaningfulText(candidates, part);
      }
    }

    const id = el.id;
    if (id) {
      const forLabel = document.querySelector(`label[for="${cssEscape(id)}"]`);
      pushUniqueMeaningfulText(candidates, forLabel?.textContent || "");
    }

    const wrapping = el.closest?.("label");
    pushUniqueMeaningfulText(candidates, wrapping?.textContent || "");

    pushUniqueMeaningfulText(candidates, el.getAttribute?.("placeholder") || "");
    pushUniqueMeaningfulText(candidates, el.getAttribute?.("name") || "");

    return candidates;
  }

  function collectNearbyLabelCandidates(el) {
    const candidates = [];
    const containers = collectRelevantContainers(el);

    for (const container of containers) {
      for (const child of Array.from(container.children || [])) {
        if (child === el || child.contains?.(el)) continue;

        pushTextFromNode(candidates, child, { skipNode: el, maxLength: 120 });

        const nestedNodes = child.querySelectorAll?.(LABEL_LIKE_SELECTOR);
        for (const node of nestedNodes || []) {
          pushTextFromNode(candidates, node, { skipNode: el, maxLength: 120 });
        }
      }
    }

    let current = el;
    for (let depth = 0; current && depth < 4; depth += 1) {
      pushTextFromNode(candidates, current.previousElementSibling, {
        skipNode: el,
        maxLength: 120,
      });
      pushTextFromNode(candidates, current.nextElementSibling, {
        skipNode: el,
        maxLength: 120,
      });
      current = current.parentElement;
    }

    return candidates;
  }

  function collectStructuralFieldLabelCandidates(el) {
    return collectNearbyLabelCandidates(el);
  }

  function collectSectionTextCandidates(el) {
    const candidates = [];
    let current = getStructuralContainer(el);
    let depth = 0;

    while (current && depth < 6) {
      const headingNodes = current.querySelectorAll?.(HEADING_LIKE_SELECTOR);
      for (const node of headingNodes || []) {
        if (node === el || node.contains?.(el)) continue;
        pushTextFromNode(candidates, node, { skipNode: el, maxLength: 80 });
      }

      let sibling = current.previousElementSibling;
      let siblingDepth = 0;
      while (sibling && siblingDepth < 3) {
        pushTextFromNode(candidates, sibling, {
          skipNode: el,
          maxLength: 80,
        });
        const nestedNodes = sibling.querySelectorAll?.(`${HEADING_LIKE_SELECTOR},${LABEL_LIKE_SELECTOR}`);
        for (const node of nestedNodes || []) {
          pushTextFromNode(candidates, node, { skipNode: el, maxLength: 80 });
        }
        sibling = sibling.previousElementSibling;
        siblingDepth += 1;
      }

      current = current.parentElement?.closest?.(STRUCTURAL_CONTAINER_SELECTOR) || current.parentElement;
      depth += 1;
    }

    return candidates;
  }

  function selectFallbackFieldLabel(candidates, { kind = "text", inputType = "", sectionLabel = "" } = {}) {
    const filtered = candidates.filter((text) => {
      if (kind === "text" && /^(描述|补充说明|说明|内容|详情)$/.test(text)) {
        return false;
      }
      return true;
    });

    const best = fieldText.selectBestFieldTextCandidate(filtered);
    if (best) return best;

    if (!sectionLabel) return "";
    if (inputType === "url") return `${sectionLabel}链接字段`;
    if (inputType === "date" || inputType === "month") return `${sectionLabel}时间字段`;
    if (kind === "textarea" || kind === "contenteditable") return `${sectionLabel}描述字段`;
    return `${sectionLabel}字段`;
  }

  function pushTextFromNode(list, node, { skipNode = null, maxLength = 120 } = {}) {
    pushUniqueMeaningfulText(
      list,
      getNodeTextWithoutControls(node, {
        skipNode,
        maxLength,
      })
    );
  }

  function pushUniqueMeaningfulText(list, value) {
    const text = normalizeText(value || "");
    if (!fieldText.isMeaningfulFieldText(text)) return;
    if (Array.isArray(list) && !list.includes(text)) {
      list.push(text);
    }
  }

  function collectRelevantContainers(el) {
    const containers = [];
    let current = el.parentElement;

    while (current && containers.length < 4) {
      if (current.matches?.(STRUCTURAL_CONTAINER_SELECTOR)) {
        containers.push(current);
      }
      current = current.parentElement;
    }

    if (containers.length === 0 && el.parentElement) {
      containers.push(el.parentElement);
    }

    return containers;
  }

  function getStructuralContainer(el) {
    return collectRelevantContainers(el)[0] || el.parentElement;
  }

  function getNodeTextWithoutControls(node, { skipNode = null, maxLength = 200 } = {}) {
    if (!node) return "";

    try {
      const clone = node.cloneNode(true);
      const selectors = [CONTROL_SELECTOR];

      if (skipNode?.id) {
        selectors.push(`#${cssEscape(skipNode.id)}`);
      }

      for (const child of clone.querySelectorAll(selectors.join(","))) {
        child.remove();
      }

      const text = normalizeText(clone.textContent || "");
      if (!fieldText.isMeaningfulFieldText(text)) {
        return "";
      }

      return maxLength && text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
    } catch (_) {
      return "";
    }
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }

    return String(value).replace(/["\\]/g, "\\$&");
  }

  function hasExistingFieldValue(runtime) {
    if (!runtime) return false;

    if (
      runtime.kind === "checkbox_group" ||
      runtime.kind === "radio_group" ||
      runtime.kind === "custom_radio_group"
    ) {
      if (runtime.kind === "custom_radio_group") {
        return (runtime.options || []).some((option) =>
          option?.el?.classList?.contains?.("phoenix-radio--checked")
        );
      }
      return (runtime.options || []).some((option) => Boolean(option?.el?.checked));
    }

    if (runtime.kind === "custom_select") {
      return Boolean(
        runtime.provider === "moka"
          ? readMokaSelectValue(runtime)
          : readPhoenixSelectValue(runtime)
      );
    }

    if (runtime.kind === "select") {
      const selectedIndex = Number(runtime.el?.selectedIndex ?? -1);
      const value = String(runtime.el?.value ?? "").trim();
      if (!value) return selectedIndex > 0;
      return true;
    }

    if (runtime.kind === "contenteditable") {
      return Boolean(String(runtime.el?.textContent || "").trim());
    }

    if (runtime.kind === "file") {
      return Boolean(runtime.el?.files?.length);
    }

    return Boolean(String(runtime.el?.value ?? "").trim());
  }

  async function fillOne(runtime, value, { overwrite = true } = {}) {
    if (!runtime) return { filled: false, message: "字段不存在" };

    if (runtime.kind === "file") {
      return { filled: false, message: "文件上传字段无法自动填写" };
    }

    if (runtime.kind === "checkbox_group") {
      const desired = normalizeCheckboxCandidates(value);
      if (desired.length === 0) {
        return { filled: false, message: "没有可勾选项" };
      }

      let any = false;
      for (const option of runtime.options || []) {
        const shouldCheck = matchesAnyCandidate(option.label || option.value, desired);
        const shouldBeChecked = overwrite
          ? shouldCheck
          : Boolean(option.el?.checked) || shouldCheck;
        const ok = await safeCheck(option.el, shouldBeChecked);
        if (ok && shouldCheck) any = true;
      }

      return any
        ? { filled: true }
        : { filled: false, message: "未找到可匹配的多选项" };
    }

    if (runtime.kind === "radio_group") {
      const best = pickBestOption(runtime.options || [], value);
      if (!best) {
        return { filled: false, message: "未找到可匹配的单选项" };
      }

      const ok = await safeCheck(best.el, true);
      return ok ? { filled: true } : { filled: false, message: "点击单选项失败" };
    }

    if (runtime.kind === "custom_radio_group") {
      const best = pickBestOption(runtime.options || [], value);
      if (!best) {
        return { filled: false, message: "未找到可匹配的自定义单选项" };
      }

      const ok = await safeClickCustomOption(best);
      return ok ? { filled: true } : { filled: false, message: "点击自定义单选项失败" };
    }

    if (runtime.kind === "custom_select") {
      const ok = runtime.provider === "moka"
        ? await fillMokaSelectRuntime(runtime, value)
        : await fillPhoenixSelectRuntime(runtime, value);
      return ok ? { filled: true } : { filled: false, message: "自定义下拉选项写入失败" };
    }

    if (runtime.kind === "select") {
      const ok = selectByText(runtime.el, value);
      return ok ? { filled: true } : { filled: false, message: "未找到可匹配的下拉选项" };
    }

    if (runtime.kind === "contenteditable") {
      const desired = prepareTextValueForRuntime(runtime, value);
      if (!desired) return { filled: false, message: "没有可填写内容" };

      const el = runtime.el;
      scrollIntoView(el);
      el.focus?.();
      el.textContent = desired;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { filled: true };
    }

    const desired = prepareTextValueForRuntime(runtime, value);
    if (!desired) return { filled: false, message: "没有可填写内容" };

    if (fillRuntime.isReadonlyDateLikeRuntime(runtime)) {
      const ok = await fillReadonlyDateRuntime(runtime, desired);
      return ok ? { filled: true } : { filled: false, message: "日期控件写入失败" };
    }

    const ok = await setValueWithEvents(runtime.el, desired, runtime);
    if (ok) {
      return { filled: true };
    }

    for (const fallbackValue of buildTextFallbackValues(runtime, desired)) {
      const fallbackOk = await setValueWithEvents(runtime.el, fallbackValue, runtime);
      if (fallbackOk) {
        return { filled: true, message: `已回退为兼容值 ${fallbackValue}` };
      }
    }

    return { filled: false, message: "写入失败" };
  }

  function prepareTextValueForRuntime(runtime, value) {
    let text = Array.isArray(value)
      ? value.map((item) => String(item || "").trim()).filter(Boolean).join(", ")
      : String(value ?? "").trim();

    if (!text) return "";

    text = fillRuntime.normalizeValueForRuntime(runtime, text);
    if (!text) return "";

    if (runtime?.inputType === "date") {
      if (/^\d{4}-\d{2}$/.test(text)) return `${text}-01`;
      if (/^\d{4}$/.test(text)) return `${text}-01-01`;
      if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
      return "";
    }

    if (runtime?.inputType === "month") {
      if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text.slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(text)) return text;
      if (/^\d{4}$/.test(text)) return `${text}-01`;
      return "";
    }

    return text;
  }

  function buildTextFallbackValues(runtime, desired) {
    const text = String(desired || "").trim();
    if (!text || !isSalaryLikeRuntime(runtime)) {
      return [];
    }

    const fallback = getSalaryFallbackValue(runtime, text);
    if (!fallback || fallback === text) {
      return [];
    }

    return [fallback];
  }

  function isSalaryLikeRuntime(runtime) {
    const text = [
      runtime?.label,
      runtime?.placeholder,
      runtime?.context,
      ...(Array.isArray(runtime?.nearbyLabels) ? runtime.nearbyLabels : []),
    ]
      .map((item) => String(item || ""))
      .join(" ");

    return /(薪资|薪酬|月薪|年薪|salary|compensation)/i.test(text);
  }

  function getSalaryFallbackValue(runtime, value) {
    const parsed = parseSalaryValue(value);
    if (!parsed.monthlyLower) {
      return "";
    }

    const runtimeText = [
      runtime?.label,
      runtime?.placeholder,
      runtime?.context,
      ...(Array.isArray(runtime?.nearbyLabels) ? runtime.nearbyLabels : []),
    ]
      .map((item) => String(item || ""))
      .join(" ");

    if (/年薪|万/.test(runtimeText)) {
      return String(Math.max(1, Math.round((parsed.monthlyLower * 12) / 10000)));
    }

    return String(parsed.monthlyLower);
  }

  function parseSalaryValue(value) {
    const text = String(value || "")
      .replace(/[,\s]/g, "")
      .trim();
    if (!text) {
      return { monthlyLower: 0 };
    }

    const numbers = Array.from(text.matchAll(/\d+(?:\.\d+)?/g)).map((match) =>
      Number(match[0])
    );
    if (numbers.length === 0) {
      return { monthlyLower: 0 };
    }

    let multiplier = 1;
    if (/[kK千]/.test(text)) {
      multiplier = 1000;
    } else if (/[wW万]/.test(text)) {
      multiplier = 10000;
    }

    let monthlyLower = Math.round(numbers[0] * multiplier);
    if (/年/.test(text) && !/月/.test(text)) {
      monthlyLower = Math.round(monthlyLower / 12);
    }

    return { monthlyLower };
  }

  function scrollIntoView(el) {
    if (!el) return;

    try {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    } catch (_) {
      // Ignore.
    }
  }

  async function setValueWithEvents(el, value, runtime = null) {
    if (!el) return false;

    scrollIntoView(el);
    const restoreReadonly =
      runtime?.readOnly || el.readOnly
        ? {
            property: Boolean(el.readOnly),
            attribute: el.hasAttribute("readonly"),
          }
        : null;

    try {
      el.focus?.();
      if (restoreReadonly) {
        el.readOnly = false;
        el.removeAttribute("readonly");
      }
      setNativeValue(el, value);
      el.setAttribute("value", value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.blur?.();
      await sleep(60);
      return fillRuntime.matchesWrittenValue(runtime, el.value, value);
    } catch (error) {
      console.warn(EXT_TAG, "写入失败", error);
      return false;
    } finally {
      if (restoreReadonly) {
        el.readOnly = restoreReadonly.property;
        if (restoreReadonly.attribute) {
          el.setAttribute("readonly", "");
        } else {
          el.removeAttribute("readonly");
        }
      }
    }
  }

  function readPhoenixSelectValue(runtime) {
    const wrapper = runtime?.wrapper || runtime?.el?.closest?.(".phoenix-select");
    return normalizeText(
      wrapper?.querySelector?.(".phoenix-select__tipEle")?.textContent || ""
    );
  }

  async function fillPhoenixSelectRuntime(runtime, value) {
    const desired = normalizeText(Array.isArray(value) ? value[0] : value);
    if (!desired || !runtime?.el) return false;

    if (getMatchScore(readPhoenixSelectValue(runtime), desired) >= 100) {
      return true;
    }

    const wrapper = runtime.wrapper || runtime.el.closest?.(".phoenix-select");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        scrollIntoView(wrapper || runtime.el);
        wrapper?.click?.();
        runtime.el.focus?.();
        setNativeValue(runtime.el, desired);
        runtime.el.dispatchEvent(new Event("input", { bubbles: true }));
        await sleep(120 + attempt * 80);

        const options = Array.from(
          document.querySelectorAll(".phoenix-selectList__listItem")
        )
          .filter((item) => isVisible(item))
          .map((item) => ({
            el: item,
            label: normalizeText(item.textContent || ""),
            value: normalizeText(item.textContent || ""),
          }))
          .filter((item) => item.label);
        const best = pickBestOption(options, desired);
        if (!best) continue;

        best.el.click?.();
        await sleep(100 + attempt * 80);
        if (getMatchScore(readPhoenixSelectValue(runtime), desired) >= 100) {
          return true;
        }
      } catch (_) {
        // Retry because controlled components may render their popup asynchronously.
      }
    }

    return false;
  }

  function readMokaSelectValue(runtime) {
    const wrapper =
      runtime?.wrapper || runtime?.el?.closest?.('[class*="sd-Dropdown-container-"]');
    return normalizeText(
      wrapper?.querySelector?.('[class*="sd-Input-display-value-"]')?.textContent || ""
    );
  }

  function getMokaMatchScore(optionText, desiredText) {
    const baseScore = getMatchScore(optionText, desiredText);
    const normalizeNumber = (value) => {
      const match = normalizeText(value).match(/^0*(\d+)(?:年|月)?$/);
      return match ? String(Number(match[1])) : "";
    };
    const optionNumber = normalizeNumber(optionText);
    const desiredNumber = normalizeNumber(desiredText);
    if (optionNumber && desiredNumber && optionNumber === desiredNumber) return 100;
    return baseScore;
  }

  function pickBestMokaOption(options, desired) {
    let best = null;
    for (const option of options || []) {
      const score = getMokaMatchScore(option.label || option.value, desired);
      if (!best || score > best.score) best = { option, score };
      if (score >= 100) break;
    }
    return best && best.score >= 60 ? best.option : null;
  }

  function dispatchMokaSelectKey(el, key) {
    if (!el?.dispatchEvent) return;
    const init = {
      key,
      code: key,
      bubbles: true,
      cancelable: true,
    };
    el.dispatchEvent(new KeyboardEvent("keydown", init));
    el.dispatchEvent(new KeyboardEvent("keyup", init));
  }

  function closeMokaSelectMenu(runtime) {
    dispatchMokaSelectKey(runtime?.el, "Escape");
    runtime?.el?.blur?.();
  }

  function getVisibleMokaOptions(runtime) {
    const wrapper =
      runtime?.wrapper || runtime?.el?.closest?.('[class*="sd-Dropdown-container-"]');
    const selector =
      '[class*="sd-Select-menu-"] [class*="sd-Menu-container-"], [class*="sd-Select-common-item-"], [class*="sd-Menu-container-"]';
    const roots = [wrapper, document].filter(
      (root, index, items) =>
        root && typeof root.querySelectorAll === "function" && items.indexOf(root) === index
    );
    const seen = new Set();
    const options = [];
    for (const root of roots) {
      for (const item of Array.from(root.querySelectorAll(selector))) {
        if (seen.has(item) || !isVisible(item)) continue;
        seen.add(item);
        const label = normalizeText(item.textContent || "");
        if (label) options.push({ el: item, label, value: label });
      }
    }
    return options;
  }

  function isMokaSelectMenuOpen(runtime, desired = "") {
    const options = getVisibleMokaOptions(runtime);
    if (!desired) return options.length > 0;
    return options.some(
      (option) => getMokaMatchScore(option.label || option.value, desired) >= 100
    );
  }

  async function waitForMokaCommit(runtime, desired, polls = 3) {
    for (let poll = 0; poll < polls; poll += 1) {
      await sleep(50);
      if (
        getMokaMatchScore(readMokaSelectValue(runtime), desired) >= 100 &&
        !isMokaSelectMenuOpen(runtime, desired)
      ) {
        return true;
      }
    }
    return false;
  }

  async function fillMokaSelectRuntime(runtime, value) {
    const desired = normalizeText(Array.isArray(value) ? value[0] : value);
    if (!desired || !runtime?.el) return false;

    if (
      getMokaMatchScore(readMokaSelectValue(runtime), desired) >= 100 &&
      !isMokaSelectMenuOpen(runtime, desired)
    ) {
      closeMokaSelectMenu(runtime);
      return true;
    }

    const wrapper =
      runtime.wrapper || runtime.el.closest?.('[class*="sd-Dropdown-container-"]');
    try {
      scrollIntoView(wrapper || runtime.el);
      wrapper?.click?.();
      runtime.el.focus?.();
      const searchText = runtime.datePart === "month" && /^\d{1,2}$/.test(desired)
        ? String(Number(desired))
        : desired;
      setNativeValue(runtime.el, searchText);
      runtime.el.dispatchEvent(new Event("input", { bubbles: true }));

      let best = null;
      for (let poll = 0; poll < 8; poll += 1) {
        const options = getVisibleMokaOptions(runtime);
        const candidate = pickBestMokaOption(options, desired);
        if (candidate) {
          if (getMokaMatchScore(candidate.label || candidate.value, desired) >= 100) {
            best = candidate;
            break;
          }
        }
        await sleep(60);
      }

      if (!best) throw new Error("Moka option not found");

      // Custom-rendered Moka options bind onClick on the inner Menu item;
      // clicking its common-item parent cannot bubble down to that handler.
      const clickTarget = best.el.querySelector?.('[class*="sd-Menu-container-"]') || best.el;
      clickLikeUser(clickTarget);
      if (await waitForMokaCommit(runtime, desired)) {
        closeMokaSelectMenu(runtime);
        return true;
      }

      // Moka occasionally ignores synthetic option clicks but accepts the
      // combobox's own keyboard commit path after filtering to the exact item.
      runtime.el.focus?.();
      dispatchMokaSelectKey(runtime.el, "Enter");
      if (await waitForMokaCommit(runtime, desired)) {
        closeMokaSelectMenu(runtime);
        return true;
      }

      dispatchMokaSelectKey(runtime.el, "ArrowDown");
      dispatchMokaSelectKey(runtime.el, "Enter");
      if (await waitForMokaCommit(runtime, desired)) {
        closeMokaSelectMenu(runtime);
        return true;
      }
    } catch (_) {
      // Close the current menu and move on quickly when this control cannot commit.
    }

    closeMokaSelectMenu(runtime);

    return false;
  }

  async function safeClickCustomOption(option) {
    const el = option?.el;
    if (!el) return false;

    try {
      scrollIntoView(el);
      if (!el.classList?.contains?.("phoenix-radio--checked")) {
        el.click?.();
      }
      await sleep(80);
      return Boolean(el.classList?.contains?.("phoenix-radio--checked"));
    } catch (_) {
      return false;
    }
  }

  async function fillReadonlyDateRuntime(runtime, desired) {
    logDateFillStep(runtime, "开始", `目标值=${desired}`);

    const directWriteOk = await setValueWithEvents(runtime.el, desired, runtime);
    if (directWriteOk) {
      logDateFillStep(runtime, "直接写入成功");
      return true;
    }

    logDateFillStep(runtime, "直接写入失败", "尝试打开日期面板");

    const trigger = runtime.el.closest?.(".mtd-input-affix-wrapper") || runtime.el;
    clickLikeUser(trigger);
    await sleep(120);

    let panel = findVisibleDatePanel(runtime.el);
    if (!panel) {
      clickLikeUser(runtime.el);
      await sleep(120);
      panel = findVisibleDatePanel(runtime.el);
    }

    if (!panel) {
      logDateFillStep(runtime, "打开面板失败");
      return false;
    }

    const parsed = parseDateParts(desired);
    if (!parsed.year || !parsed.month) {
      logDateFillStep(runtime, "解析目标日期失败", desired);
      return false;
    }

    logDateFillStep(
      runtime,
      "面板已打开",
      `year=${parsed.year} month=${parsed.month} day=${parsed.day || 0}`
    );

    const yearReady = await movePickerToYear(panel, parsed.year);
    if (!yearReady) {
      logDateFillStep(runtime, "年份切换失败", String(parsed.year));
      return false;
    }

    panel = findVisibleDatePanel(runtime.el) || panel;
    const monthLabel = `${Number(parsed.month)}月`;
    if (!(await clickPanelCell(panel, monthLabel))) {
      logDateFillStep(runtime, "月份点击失败", monthLabel);
      return false;
    }

    logDateFillStep(runtime, "月份点击成功", monthLabel);
    await sleep(120);

    if (parsed.day) {
      panel = findVisibleDatePanel(runtime.el) || panel;
      const dayOk = await clickPanelCell(panel, String(Number(parsed.day)));
      if (!dayOk) {
        logDateFillStep(runtime, "日期点击失败", String(Number(parsed.day)));
        return false;
      }
      logDateFillStep(runtime, "日期点击成功", String(Number(parsed.day)));
      await sleep(120);
    }

    const matched = fillRuntime.matchesWrittenValue(runtime, runtime.el.value, desired);
    logDateFillStep(
      runtime,
      matched ? "最终校验成功" : "最终校验失败",
      `当前值=${runtime.el.value || "(empty)"}`
    );
    return matched;
  }

  function logDateFillStep(runtime, step, detail = "") {
    const label = runtime?.label || runtime?.placeholder || "(empty)";
    const message = detail
      ? `[日期] ${runtime?.fieldId || "(no-field-id)"} "${label}" ${step} detail="${detail}"`
      : `[日期] ${runtime?.fieldId || "(no-field-id)"} "${label}" ${step}`;
    sendLog("info", message);
  }

  function findVisibleDatePanel(anchorEl) {
    const candidates = Array.from(
      document.querySelectorAll(
        '[class*="picker"],[class*="Picker"],[class*="calendar"],[class*="Calendar"],[role="dialog"]'
      )
    ).filter((node) => {
      if (node.contains?.(anchorEl)) return false;
      if (!isVisible(node)) return false;
      const text = normalizeText(node.textContent || "");
      return /\d{4}年|1月|2月|3月|4月|5月|6月|7月|8月|9月|10月|11月|12月/.test(text);
    });

    if (candidates.length === 0) return null;
    if (!anchorEl) return candidates[0];

    const anchorRect = anchorEl.getBoundingClientRect();
    return candidates
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const dx = rect.left - anchorRect.left;
        const dy = rect.top - anchorRect.bottom;
        const dayCellCount = Array.from(
          node.querySelectorAll?.('button,[role="button"],td,li,div,span') || []
        ).filter((candidate) => {
          const text = normalizeText(candidate.textContent || "");
          return /^(?:[1-9]|[12]\d|3[01])$/.test(text);
        }).length;
        return {
          node,
          dayCellCount,
          area: Number(rect.width || 0) * Number(rect.height || 0),
          distance: Math.abs(dx) + Math.abs(dy),
        };
      })
      .sort((left, right) =>
        right.dayCellCount - left.dayCellCount ||
        left.distance - right.distance ||
        right.area - left.area
      )[0]?.node || candidates[0];
  }

  async function movePickerToYear(panel, targetYear) {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const currentYear = getVisiblePickerYear(panel);
      if (!currentYear) return true;
      if (currentYear === targetYear) return true;

      const control = findYearNavigationControl(panel, currentYear, targetYear);
      if (!control) return false;

      clickLikeUser(control);
      await sleep(120);
    }

    return false;
  }

  function getVisiblePickerYear(panel) {
    const nodes = Array.from(panel.querySelectorAll("*"));
    for (const node of nodes) {
      const text = normalizeText(node.textContent || "");
      const match = text.match(/^(\d{4})年$/);
      if (match) {
        return Number(match[1]);
      }
    }
    return 0;
  }

  function findYearNavigationControl(panel, currentYear, targetYear) {
    const buttons = Array.from(
      panel.querySelectorAll(
        'button,[role="button"],[tabindex],[class*="prev"],[class*="next"],[class*="arrow"],[class*="Arrow"]'
      )
    ).filter((node) => isVisible(node));

    if (buttons.length === 0) return null;

    const yearNode = Array.from(panel.querySelectorAll("*")).find((node) =>
      /^\d{4}年$/.test(normalizeText(node.textContent || ""))
    );
    if (!yearNode) {
      return targetYear < currentYear ? buttons[0] : buttons[buttons.length - 1];
    }

    const yearRect = yearNode.getBoundingClientRect();
    const leftButtons = [];
    const rightButtons = [];

    for (const button of buttons) {
      const rect = button.getBoundingClientRect();
      if (rect.right <= yearRect.left) {
        leftButtons.push({ button, rect });
      } else if (rect.left >= yearRect.right) {
        rightButtons.push({ button, rect });
      }
    }

    if (targetYear < currentYear) {
      return leftButtons.sort((a, b) => b.rect.right - a.rect.right)[0]?.button || buttons[0];
    }

    return rightButtons.sort((a, b) => a.rect.left - b.rect.left)[0]?.button || buttons[buttons.length - 1];
  }

  async function clickPanelCell(panel, text) {
    const normalizedTarget = normalizeText(text);
    const candidates = Array.from(
      panel.querySelectorAll(
        'button,[role="button"],td,li,div,span'
      )
    ).filter((node) => {
      if (!isVisible(node)) return false;
      if (node.getAttribute?.("aria-disabled") === "true") return false;
      const className = String(node.className || "");
      if (/disabled/i.test(className)) return false;
      return normalizeText(node.textContent || "") === normalizedTarget;
    });

    if (candidates.length === 0) return false;

    const target = candidates
      .sort((left, right) => {
        const leftArea = left.getBoundingClientRect().width * left.getBoundingClientRect().height;
        const rightArea = right.getBoundingClientRect().width * right.getBoundingClientRect().height;
        return leftArea - rightArea;
      })[0];

    clickLikeUser(target);
    await sleep(80);
    return true;
  }

  function clickLikeUser(el) {
    if (!el) return;
    scrollIntoView(el);
    el.focus?.();
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    if (typeof el.click === "function") {
      el.click();
    }
  }

  function parseDateParts(value) {
    const text = String(value || "").trim();
    const match = text.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
    if (!match) {
      return { year: 0, month: 0, day: 0 };
    }

    return {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3] || 0),
    };
  }

  function setNativeValue(element, value) {
    const tag = element.tagName?.toLowerCase?.() || "";

    if (tag === "input") {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )?.set;
      setter ? setter.call(element, value) : (element.value = value);
      return;
    }

    if (tag === "textarea") {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value"
      )?.set;
      setter ? setter.call(element, value) : (element.value = value);
      return;
    }

    element.value = value;
  }

  function selectByText(selectEl, desired) {
    if (!selectEl?.options) return false;

    scrollIntoView(selectEl);
    const options = Array.from(selectEl.options)
      .map((option) => ({
        el: option,
        label: String(option.textContent || "").trim(),
        value: option.value,
      }))
      .filter((option) => option.label);

    const best = pickBestOption(options, desired);
    if (!best) return false;

    selectEl.value = best.value;
    selectEl.dispatchEvent(new Event("change", { bubbles: true }));
    selectEl.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  async function safeCheck(inputEl, checked) {
    if (!inputEl) return false;

    try {
      scrollIntoView(inputEl);
      inputEl.focus?.();

      if (typeof inputEl.click === "function") {
        if (Boolean(inputEl.checked) !== Boolean(checked)) {
          inputEl.click();
        }
      } else {
        inputEl.checked = Boolean(checked);
      }

      inputEl.dispatchEvent(new Event("change", { bubbles: true }));
      inputEl.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(30);

      return Boolean(inputEl.checked) === Boolean(checked);
    } catch (_) {
      return false;
    }
  }

  function pickBestOption(options, desired) {
    const candidates = Array.isArray(desired)
      ? desired
      : [desired].filter((item) => item != null && String(item).trim());

    let exact = null;
    let fuzzy = null;

    for (const option of options || []) {
      const label = String(option.label || option.value || "").trim();
      if (!label) continue;

      for (const candidate of candidates) {
        const score = getMatchScore(label, candidate);
        if (score >= 100) {
          exact = option;
          break;
        }

        if (!fuzzy || score > fuzzy.score) {
          fuzzy = { option, score };
        }
      }

      if (exact) break;
    }

    return exact || (fuzzy && fuzzy.score >= 60 ? fuzzy.option : null);
  }

  function matchesAnyCandidate(optionText, candidates) {
    return candidates.some((candidate) => getMatchScore(optionText, candidate) >= 60);
  }

  function getMatchScore(optionText, candidateText) {
    const optionVariants = expandMatchVariants(optionText);
    const candidateVariants = expandMatchVariants(candidateText);
    let bestScore = 0;

    for (const optionVariant of optionVariants) {
      for (const candidateVariant of candidateVariants) {
        if (!optionVariant || !candidateVariant) continue;
        if (optionVariant === candidateVariant) return 100;
        if (optionVariant.includes(candidateVariant) || candidateVariant.includes(optionVariant)) {
          bestScore = Math.max(bestScore, 75);
        }
      }
    }

    return bestScore;
  }

  function expandMatchVariants(value) {
    const text = String(value || "").trim();
    if (!text) return [];

    const normalized = normalizeForMatch(text);
    const variants = new Set([normalized]);

    for (const group of MATCH_ALIAS_GROUPS) {
      if (group.values.includes(normalized)) {
        group.values.forEach((item) => variants.add(item));
      }
    }

    return Array.from(variants);
  }

  function normalizeForMatch(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/['"`’‘”“]/g, "")
      .replace(/[()（）[\]【】{}<>]/g, "")
      .replace(/[.,，/\\\-_:：;+]/g, "");
  }

  function isAffirmative(value) {
    const normalized = normalizeForMatch(value);
    return MATCH_ALIAS_GROUPS.find((group) => group.key === "yes")?.values.includes(
      normalized
    );
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function parseJsonFromAiText(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) throw new Error("AI 返回为空");

    const direct = tryParseJson(trimmed);
    if (direct.ok) return direct.value;

    const noFences = trimmed
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();

    const noFenceParsed = tryParseJson(noFences);
    if (noFenceParsed.ok) return noFenceParsed.value;

    const extracted = extractLikelyJson(noFences);
    const extractedParsed = tryParseJson(extracted);
    if (extractedParsed.ok) return extractedParsed.value;

    throw new Error("无法解析 AI 返回的 JSON");
  }

  function tryParseJson(text) {
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch (_) {
      return { ok: false };
    }
  }

  function extractLikelyJson(text) {
    const firstObj = text.indexOf("{");
    const lastObj = text.lastIndexOf("}");
    const firstArr = text.indexOf("[");
    const lastArr = text.lastIndexOf("]");

    const objCandidate =
      firstObj !== -1 && lastObj !== -1 && lastObj > firstObj
        ? text.slice(firstObj, lastObj + 1)
        : null;
    const arrCandidate =
      firstArr !== -1 && lastArr !== -1 && lastArr > firstArr
        ? text.slice(firstArr, lastArr + 1)
        : null;

    if (objCandidate && arrCandidate) {
      return firstObj < firstArr ? objCandidate : arrCandidate;
    }

    return objCandidate || arrCandidate || text;
  }

  function createMappingCacheSignature(fields) {
    return fields.map((field, index) =>
      createStableCacheFieldSignature(field, index)
    );
  }

  function createMappingCacheKey(fields) {
    return createMappingCacheKeyFromSignature(createMappingCacheSignature(fields));
  }

  function createMappingCacheKeyFromSignature(signature) {
    const base = `${location.origin}${location.pathname}::${JSON.stringify(signature)}`;
    return `${location.host}:${hashString(base)}`;
  }

  function createStableCacheFieldSignature(field, index = 0) {
    return {
      index,
      kind: field.kind,
      inputType: field.inputType || "",
      required: Boolean(field.required),
      sectionKey: normalizeCacheText(field.sectionKey || ""),
      sectionLabel: normalizeCacheText(field.sectionLabel || ""),
      repeatIndex: Number.isInteger(field.repeatIndex) ? field.repeatIndex : null,
      label: normalizeCacheText(field.label || ""),
      placeholder: normalizeCacheText(field.placeholder || ""),
      name: normalizeCacheText(field.name || ""),
      id: normalizeCacheText(field.id || ""),
      options: Array.isArray(field.options)
        ? field.options.map((item) => normalizeCacheText(item)).filter(Boolean).slice(0, 8)
        : [],
    };
  }

  function normalizeCacheText(value) {
    let text = String(value || "").trim();
    if (!text) return "";

    text = text
      .replace(/\s+/g, " ")
      .replace(/[＊*]+\s*/g, "*")
      .replace(/^(请填写|请选择|请输入|请完整填写)/g, "")
      .replace(/(请填写|请选择|请输入)/g, "")
      .replace(/[*:：]+$/g, "")
      .trim();

    if (!text) return "";

    const starIndex = text.indexOf("*");
    if (starIndex >= 0) {
      text = text.slice(0, starIndex).trim();
    }

    const stablePrefixMatch = text.match(/^([\u4e00-\u9fa5A-Za-z]+(?:名称|时间|日期|学历|学位|专业|部门|职位|城市|邮箱|手机|电话|描述|链接|角色|学校|证书|账号|网址))/);
    if (stablePrefixMatch) {
      return stablePrefixMatch[1];
    }

    if (/^(全灵|实习|本科|硕士|博士|男|女|是|否|\d{4}[-/]\d{2}(?:[-/]\d{2})?)$/.test(text)) {
      return "";
    }

    return text;
  }

  function hashString(text) {
    let hash = 5381;
    for (let index = 0; index < text.length; index += 1) {
      hash = (hash * 33) ^ text.charCodeAt(index);
    }
    return (hash >>> 0).toString(16);
  }

  function describeMappingCacheLookup(cache, cacheKey, meta = {}) {
    const normalizedCache = cache && typeof cache === "object" ? cache : {};
    const keys = Object.keys(normalizedCache);
    const entry = normalizedCache[cacheKey] || null;
    const shortKey = String(cacheKey || "").split(":").pop() || "(empty)";

    if (entry) {
      return {
        entry,
        hit: true,
        reason: `命中 key=${shortKey} total=${keys.length}`,
      };
    }

    if (keys.length === 0) {
      return {
        entry: null,
        hit: false,
        reason: `缓存为空 key=${shortKey}`,
      };
    }

    const samePageEntries = Object.entries(normalizedCache)
      .filter(([, item]) => item?.host === meta.host && item?.path === meta.path)
      .sort((left, right) => Number(right[1]?.updatedAt || 0) - Number(left[1]?.updatedAt || 0));

    if (samePageEntries.length === 0) {
      return {
        entry: null,
        hit: false,
        reason: `缓存中没有当前页面记录 key=${shortKey} total=${keys.length}`,
      };
    }

    const latestSamePage = samePageEntries[0]?.[1] || null;
    const difference = summarizeCacheSignatureDifference(
      meta.signature,
      latestSamePage?.signature
    );

    return {
      entry: null,
      hit: false,
      reason: `同页面已有${samePageEntries.length}条缓存，但当前字段签名已变化 key=${shortKey} ${difference}`,
    };
  }

  function summarizeCacheSignatureDifference(currentSignature, previousSignature) {
    if (!Array.isArray(currentSignature) || currentSignature.length === 0) {
      return "当前扫描签名为空";
    }

    if (!Array.isArray(previousSignature) || previousSignature.length === 0) {
      return "历史缓存缺少签名明细";
    }

    if (currentSignature.length !== previousSignature.length) {
      return `字段数量 ${previousSignature.length} -> ${currentSignature.length}`;
    }

    const diffs = [];
    for (let index = 0; index < currentSignature.length; index += 1) {
      const current = currentSignature[index];
      const previous = previousSignature[index];
      if (JSON.stringify(current) === JSON.stringify(previous)) {
        continue;
      }
      diffs.push(describeCacheFieldDifference(previous, current, index));
    }

    if (diffs.length === 0) {
      return "签名一致，但缓存条目不存在";
    }

    return `差异字段 ${diffs.length} 个，示例：${diffs.slice(0, 3).join("；")}`;
  }

  function describeCacheFieldDifference(previous, current, index) {
    const changes = [];

    if ((previous?.kind || "") !== (current?.kind || "")) {
      changes.push(`kind ${previous?.kind || "(empty)"} -> ${current?.kind || "(empty)"}`);
    }
    if ((previous?.inputType || "") !== (current?.inputType || "")) {
      changes.push(
        `inputType ${previous?.inputType || "(empty)"} -> ${current?.inputType || "(empty)"}`
      );
    }
    if ((previous?.sectionLabel || "") !== (current?.sectionLabel || "")) {
      changes.push(
        `section ${previous?.sectionLabel || "(empty)"} -> ${current?.sectionLabel || "(empty)"}`
      );
    }
    if ((previous?.label || "") !== (current?.label || "")) {
      changes.push(`label ${previous?.label || "(empty)"} -> ${current?.label || "(empty)"}`);
    }
    if ((previous?.placeholder || "") !== (current?.placeholder || "")) {
      changes.push(
        `placeholder ${previous?.placeholder || "(empty)"} -> ${current?.placeholder || "(empty)"}`
      );
    }
    if ((previous?.name || "") !== (current?.name || "")) {
      changes.push(`name ${previous?.name || "(empty)"} -> ${current?.name || "(empty)"}`);
    }
    if ((previous?.id || "") !== (current?.id || "")) {
      changes.push(`id ${previous?.id || "(empty)"} -> ${current?.id || "(empty)"}`);
    }

    const previousOptions = JSON.stringify(previous?.options || []);
    const currentOptions = JSON.stringify(current?.options || []);
    if (previousOptions !== currentOptions) {
      changes.push(`options ${previousOptions} -> ${currentOptions}`);
    }

    return `#${index + 1} ${changes[0] || "结构变化"}`;
  }

  async function loadMappingCacheEntry(cacheKey, meta = {}) {
    const data = await chrome.storage.local.get([MAPPING_CACHE_KEY]);
    const cache = data[MAPPING_CACHE_KEY];
    return describeMappingCacheLookup(cache, cacheKey, meta);
  }

  async function saveMappingCacheEntry(cacheKey, entry) {
    const data = await chrome.storage.local.get([MAPPING_CACHE_KEY]);
    const cache = data[MAPPING_CACHE_KEY] && typeof data[MAPPING_CACHE_KEY] === "object"
      ? data[MAPPING_CACHE_KEY]
      : {};

    cache[cacheKey] = entry;

    const keys = Object.keys(cache).sort((left, right) => {
      const leftTime = Number(cache[left]?.updatedAt || 0);
      const rightTime = Number(cache[right]?.updatedAt || 0);
      return rightTime - leftTime;
    });

    const nextCache = {};
    keys.slice(0, 50).forEach((key) => {
      nextCache[key] = cache[key];
    });

    await chrome.storage.local.set({ [MAPPING_CACHE_KEY]: nextCache });
  }

  function sendLog(level, text) {
    chrome.runtime.sendMessage({ type: "log", level, text });
  }

  function sendStats(fieldCount, mappedCount, filledCount) {
    chrome.runtime.sendMessage({
      type: "updateStats",
      fieldCount,
      mappedCount,
      filledCount,
    });
  }

  const MATCH_ALIAS_GROUPS = [
    {
      key: "yes",
      values: [
        "yes",
        "y",
        "true",
        "1",
        "是",
        "有",
        "愿意",
        "可以",
        "present",
        "current",
        "currently",
      ],
    },
    {
      key: "no",
      values: ["no", "n", "false", "0", "否", "无", "不愿意", "不可以", "不需要"],
    },
    {
      key: "male",
      values: ["male", "man", "m", "男", "男性"],
    },
    {
      key: "female",
      values: ["female", "woman", "f", "女", "女性"],
    },
    {
      key: "fulltime",
      values: ["fulltime", "full-time", "全职"],
    },
    {
      key: "parttime",
      values: ["parttime", "part-time", "兼职"],
    },
    {
      key: "internship",
      values: ["internship", "intern", "实习"],
    },
    {
      key: "contract",
      values: ["contract", "contractor", "合同"],
    },
    {
      key: "freelance",
      values: ["freelance", "自由职业"],
    },
    {
      key: "bachelor",
      values: ["bachelor", "undergraduate", "本科", "学士", "大学本科"],
    },
    {
      key: "highschool",
      values: ["highschool", "high-school", "高中"],
    },
    {
      key: "associate",
      values: ["associate", "大专", "大学专科"],
    },
    {
      key: "master",
      values: ["master", "masters", "硕士", "硕士研究生"],
    },
    {
      key: "mba",
      values: ["mba"],
    },
    {
      key: "phd",
      values: ["phd", "doctorate", "博士", "博士研究生", "博士后"],
    },
    {
      key: "single",
      values: ["single", "未婚"],
    },
    {
      key: "married",
      values: ["married", "已婚"],
    },
    {
      key: "onsite",
      values: ["onsite", "on-site", "现场办公", "到岗办公"],
    },
    {
      key: "hybrid",
      values: ["hybrid", "混合办公"],
    },
    {
      key: "remote",
      values: ["remote", "远程办公"],
    },
    {
      key: "flexible",
      values: ["flexible", "灵活"],
    },
    {
      key: "graduated",
      values: ["graduated", "已毕业"],
    },
    {
      key: "expected",
      values: ["expected", "预计毕业"],
    },
    {
      key: "enrolled",
      values: ["enrolled", "在读"],
    },
    {
      key: "dropped",
      values: ["dropped", "肄业"],
    },
    {
      key: "idcard",
      values: ["identitycard", "idcard", "身份证"],
    },
    {
      key: "regularfulltime",
      values: [
        "regularfulltime",
        "fulltimedegree",
        "统招",
        "统招全日制",
        "全日制",
        "全国普通高等院校全日制",
      ],
    },
    {
      key: "nonfulltime",
      values: [
        "nonfulltime",
        "parttimedegree",
        "非统招",
        "非全日制",
        "全国普通高等院校非全日制",
      ],
    },
    {
      key: "jointtraining",
      values: ["jointtraining", "jointprogram", "联合培养"],
    },
    {
      key: "commissionedtraining",
      values: ["commissionedtraining", "委托培养"],
    },
    {
      key: "passport",
      values: ["passport", "护照"],
    },
    {
      key: "permit",
      values: ["residencepermit", "permit", "居留许可"],
    },
    {
      key: "native",
      values: ["native", "母语"],
    },
    {
      key: "fluent",
      values: ["fluent", "流利"],
    },
    {
      key: "professional",
      values: ["professional", "business", "工作熟练", "专业"],
    },
    {
      key: "intermediate",
      values: ["intermediate", "中等", "中级"],
    },
    {
      key: "basic",
      values: ["basic", "基础", "初级"],
    },
  ];

  console.log(EXT_TAG, "Content script 已加载");
})();
