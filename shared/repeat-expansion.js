(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.ResumeRepeatExpansion = api;
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function () {
    "use strict";

    const SECTION_CONFIGS = [
      {
        sectionKey: "education",
        profileKey: "educations",
        label: "教育经历",
        keywords: ["教育", "学校", "学历", "学位"],
      },
      {
        sectionKey: "internship",
        profileKey: "internships",
        label: "实习经历",
        keywords: ["实习"],
      },
      {
        sectionKey: "work",
        profileKey: "workExperiences",
        label: "工作经历",
        keywords: ["工作", "任职", "职业"],
      },
      {
        sectionKey: "project",
        profileKey: "projects",
        label: "项目经历",
        keywords: ["项目", "作品"],
      },
      {
        sectionKey: "campus",
        profileKey: "campusExperiences",
        label: "校园经历",
        keywords: ["校园", "学生组织", "社团", "志愿", "科研"],
      },
      {
        sectionKey: "award",
        profileKey: "awards",
        label: "竞赛获奖",
        keywords: ["获奖", "奖项", "竞赛", "比赛", "荣誉", "奖学金"],
      },
      {
        sectionKey: "certificate",
        profileKey: "certificates",
        label: "证书与认证",
        keywords: ["证书", "认证", "资格"],
      },
      {
        sectionKey: "language",
        profileKey: "languages",
        label: "语言能力",
        keywords: ["语言", "外语", "英语", "雅思", "托福", "四六级"],
      },
    ];

    const ADD_KEYWORDS = ["添加", "新增", "增加", "新建", "继续添加", "add", "new", "plus"];
    const DANGEROUS_KEYWORDS = [
      "删除",
      "移除",
      "提交",
      "保存",
      "取消",
      "确定",
      "完成",
      "下一步",
      "上一步",
      "delete",
      "remove",
      "submit",
      "save",
      "cancel",
    ];
    const REPEAT_ADD_CONTROL_SELECTOR =
      'button:not([type="submit"]),[role="button"],a[class*="add"],a[class*="Add"],a[class*="plus"],a[class*="Plus"],[id$="_addButton"],[class*="addButton"],[class*="AddButton"]';

    function normalizeText(value) {
      return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[()（）[\]【】{}<>]/g, "");
    }

    function hasMeaningfulValue(value) {
      if (value == null) return false;
      if (Array.isArray(value)) return value.some(hasMeaningfulValue);
      if (typeof value === "object") {
        return Object.values(value).some(hasMeaningfulValue);
      }
      return Boolean(String(value).trim());
    }

    function getDesiredRecordCounts(profile) {
      const counts = {};
      for (const config of SECTION_CONFIGS) {
        const records = Array.isArray(profile?.[config.profileKey])
          ? profile[config.profileKey]
          : [];
        counts[config.sectionKey] = records.filter(hasMeaningfulValue).length;
      }
      return counts;
    }

    function normalizeFieldLabel(field) {
      return normalizeText(field?.label || field?.name || field?.placeholder)
        .replace(/^(请填写|请选择|请输入)/g, "")
        .replace(/[＊*:：]+$/g, "");
    }

    function countRenderedRecords(fields) {
      const labelCounts = new Map();
      const indexedCounts = {};

      for (const field of Array.isArray(fields) ? fields : []) {
        const sectionKey = String(field?.sectionKey || "");
        if (!SECTION_CONFIGS.some((config) => config.sectionKey === sectionKey)) {
          continue;
        }

        if (Number.isInteger(field.repeatIndex) && field.repeatIndex >= 0) {
          indexedCounts[sectionKey] = Math.max(
            indexedCounts[sectionKey] || 0,
            field.repeatIndex + 1
          );
        }

        const label = normalizeFieldLabel(field);
        if (!label) continue;
        const key = `${sectionKey}:${label}`;
        labelCounts.set(key, (labelCounts.get(key) || 0) + 1);
      }

      const counts = { ...indexedCounts };
      for (const [key, count] of labelCounts.entries()) {
        const sectionKey = key.split(":", 1)[0];
        counts[sectionKey] = Math.max(counts[sectionKey] || 0, count);
      }
      return counts;
    }

    function includesAny(text, keywords) {
      return keywords.some((keyword) => text.includes(normalizeText(keyword)));
    }

    function scoreAddCandidate(candidate, sectionKey) {
      const config = SECTION_CONFIGS.find((item) => item.sectionKey === sectionKey);
      if (!config || candidate?.disabled) return -1;

      const text = normalizeText(candidate?.text);
      const context = normalizeText(candidate?.context);
      if (!text || includesAny(text, DANGEROUS_KEYWORDS)) return -1;

      const hasAddIntent =
        includesAny(text, ADD_KEYWORDS) ||
        /^(\+|＋|\+添加|＋添加)$/.test(text);
      if (!hasAddIntent) return -1;

      const targetInText = includesAny(text, config.keywords);
      const targetInContext = includesAny(context, config.keywords);
      const otherSectionInText = SECTION_CONFIGS.some(
        (item) =>
          item.sectionKey !== sectionKey && includesAny(text, item.keywords)
      );

      if (otherSectionInText && !targetInText) return -1;
      if (!targetInText && !targetInContext) return -1;

      let score = targetInText ? 12 : 0;
      if (targetInContext) score += 6;
      if (/^(\+|＋)$/.test(text)) score += 1;
      if (text.includes("继续添加")) score += 2;
      return score;
    }

    function findBestAddCandidate(candidates, sectionKey) {
      let best = null;
      let bestScore = -1;
      for (const candidate of Array.isArray(candidates) ? candidates : []) {
        const score = scoreAddCandidate(candidate, sectionKey);
        if (score > bestScore) {
          best = candidate;
          bestScore = score;
        }
      }
      return bestScore >= 0 ? best : null;
    }

    async function expandRepeatedSections(options = {}) {
      const desiredCounts = getDesiredRecordCounts(options.profile);
      const scan = options.scan;
      const listCandidates = options.listCandidates;
      const clickCandidate = options.clickCandidate;
      const waitForGrowth = options.waitForGrowth || (async () => {});
      const maxClicks = Math.max(1, Number(options.maxClicks) || 20);
      const expanded = {};
      const unresolved = [];
      let totalClicked = 0;

      for (const config of SECTION_CONFIGS) {
        const desired = desiredCounts[config.sectionKey] || 0;
        if (desired <= 1) continue;

        let current = countRenderedRecords(await scan())[config.sectionKey] || 0;
        if (current === 0 || current >= desired) continue;

        while (current < desired && totalClicked < maxClicks) {
          const candidates = await listCandidates(config.sectionKey);
          const candidate = findBestAddCandidate(candidates, config.sectionKey);
          if (!candidate) {
            unresolved.push({
              sectionKey: config.sectionKey,
              desired,
              current,
              reason: "missing-button",
            });
            break;
          }

          await clickCandidate(candidate, config.sectionKey);
          totalClicked += 1;
          await waitForGrowth(config.sectionKey, current);

          const next = countRenderedRecords(await scan())[config.sectionKey] || 0;
          if (next <= current) {
            unresolved.push({
              sectionKey: config.sectionKey,
              desired,
              current,
              reason: "no-growth",
            });
            break;
          }

          expanded[config.sectionKey] = (expanded[config.sectionKey] || 0) + (next - current);
          current = next;
        }

        if (current < desired && totalClicked >= maxClicks) {
          unresolved.push({
            sectionKey: config.sectionKey,
            desired,
            current,
            reason: "click-limit",
          });
        }
      }

      return { totalClicked, expanded, unresolved };
    }

    function getSectionConfig(sectionKey) {
      return SECTION_CONFIGS.find((item) => item.sectionKey === sectionKey) || null;
    }

    return {
      REPEAT_ADD_CONTROL_SELECTOR,
      SECTION_CONFIGS,
      countRenderedRecords,
      expandRepeatedSections,
      findBestAddCandidate,
      getDesiredRecordCounts,
      getSectionConfig,
      scoreAddCandidate,
    };
  }
);
