(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.ResumeAwardFill = api;
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function () {
    "use strict";

    function normalizeText(value) {
      return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/[＊*:：()（）[\]【】{}<>]/g, "");
    }

    function getAwardFieldKey(field) {
      const label = normalizeText(
        field?.label || field?.placeholder || field?.name || field?.id
      );
      if (!label) return "";

      if (/获奖(时间|日期)|奖项(时间|日期)|^获奖时间$|^获奖日期$/.test(label)) {
        return "awardDate";
      }
      if (/颁发机构|授予机构|发奖单位|颁奖单位/.test(label)) return "issuer";
      if (/奖项等级|获奖等级|奖项级别|获奖级别|^等级$|^级别$/.test(label)) {
        return "level";
      }
      if (/奖项名次|获奖名次|奖次|排名|获奖结果|^名次$/.test(label)) return "rank";
      if (/获奖名称|奖项名称|荣誉名称|^奖项$|^获奖$/.test(label)) return "name";
      if (/获奖描述|奖项描述|^描述$|^详情$|^说明$/.test(label)) return "description";
      return "";
    }

    function fieldMentionsAward(field) {
      const text = normalizeText(
        [
          field?.label,
          field?.sectionLabel,
          field?.sectionEvidence,
          field?.context,
          ...(Array.isArray(field?.nearbyLabels) ? field.nearbyLabels : []),
        ].join(" ")
      );
      return /获奖|奖项|竞赛|比赛|荣誉|奖学金/.test(text);
    }

    function annotateAwardFields(fields) {
      const list = Array.isArray(fields) ? fields : [];
      const fieldKeys = list.map(getAwardFieldKey);
      const strongAward = list.map(
        (field, index) =>
          field?.sectionKey === "award" ||
          (fieldKeys[index] && fieldKeys[index] !== "description") ||
          fieldMentionsAward(field)
      );

      for (let index = 0; index < list.length; index += 1) {
        const field = list[index];
        const fieldKey = fieldKeys[index];
        if (!field || !fieldKey) continue;

        if (fieldKey !== "description" || field?.sectionKey === "award" || fieldMentionsAward(field)) {
          field.sectionKey = "award";
          field.sectionLabel = field.sectionLabel || "竞赛获奖";
          field.repeatFieldKey = fieldKey;
          continue;
        }

        if (field.sectionKey) continue;

        let awardVotes = 0;
        let otherVotes = 0;
        for (
          let nearbyIndex = Math.max(0, index - 3);
          nearbyIndex <= Math.min(list.length - 1, index + 3);
          nearbyIndex += 1
        ) {
          if (nearbyIndex === index) continue;
          if (strongAward[nearbyIndex]) {
            awardVotes += 1;
          } else if (list[nearbyIndex]?.sectionKey) {
            otherVotes += 1;
          }
        }

        if (awardVotes >= 2 && awardVotes > otherVotes) {
          field.sectionKey = "award";
          field.sectionLabel = "竞赛获奖";
          field.repeatFieldKey = fieldKey;
        }
      }

      const occurrences = new Map();
      for (const field of list) {
        if (field?.sectionKey !== "award") continue;
        const fieldKey = field.repeatFieldKey || getAwardFieldKey(field);
        if (!fieldKey) continue;
        const repeatIndex = occurrences.get(fieldKey) || 0;
        field.repeatFieldKey = fieldKey;
        field.repeatIndex = repeatIndex;
        occurrences.set(fieldKey, repeatIndex + 1);
      }

      return list;
    }

    function getDeterministicAwardPath(field) {
      if (
        field?.sectionKey !== "award" ||
        !Number.isInteger(field?.repeatIndex) ||
        !field?.repeatFieldKey
      ) {
        return "";
      }
      return `awards.${field.repeatIndex}.${field.repeatFieldKey}`;
    }

    function resolveAwardNameValue(profile, resumePath, mappings) {
      const match = String(resumePath || "").match(/^awards\.(\d+)\.name$/);
      if (!match) return "";

      const index = Number(match[1]);
      const award = profile?.awards?.[index] || {};
      const name = String(award.name || "").trim();
      if (!name) return "";

      const mappedPaths = new Set(
        (Array.isArray(mappings) ? mappings : [])
          .map((item) => String(item?.resumePath || "").trim())
          .filter(Boolean)
      );
      const suffixParts = [];
      const level = String(award.level || "").trim();
      const rank = String(award.rank || "").trim();

      if (level && !mappedPaths.has(`awards.${index}.level`) && !name.includes(level)) {
        suffixParts.push(level);
      }
      if (rank && !mappedPaths.has(`awards.${index}.rank`) && !name.includes(rank)) {
        suffixParts.push(rank);
      }

      return suffixParts.length > 0 ? `${name}（${suffixParts.join("，")}）` : name;
    }

    return {
      annotateAwardFields,
      getAwardFieldKey,
      getDeterministicAwardPath,
      resolveAwardNameValue,
    };
  }
);
