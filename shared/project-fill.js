(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.ResumeProjectFill = api;
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

    function isCombinedProjectNarrativeField(field) {
      const label = normalizeText(
        field.label || field.placeholder || field.name || field.id
      );
      return (
        /(项目)?(职责|工作内容).*(成果|业绩|成效)/.test(label) ||
        /(成果|业绩|成效).*(职责|工作内容)/.test(label)
      );
    }

    function isProjectDescriptionField(field) {
      const label = normalizeText(
        field.label || field.placeholder || field.name || field.id
      );
      return (
        /项目(描述|说明|介绍|内容)|^(描述|说明|介绍|内容)$/.test(label) ||
        isCombinedProjectNarrativeField(field)
      );
    }

    function annotateProjectFields(fields) {
      const list = Array.isArray(fields) ? fields : [];
      for (let index = 0; index < list.length; index += 1) {
        const field = list[index];
        if (!field || !isProjectDescriptionField(field)) continue;

        let projectIndex = null;
        for (let nearbyIndex = index - 1; nearbyIndex >= 0; nearbyIndex -= 1) {
          const nearby = list[nearbyIndex];
          if (!nearby) continue;
          if (nearby.sectionKey && nearby.sectionKey !== "project") break;
          if (nearby.sectionKey === "project" && Number.isInteger(nearby.repeatIndex)) {
            projectIndex = nearby.repeatIndex;
            break;
          }
        }
        if (!Number.isInteger(projectIndex)) continue;

        field.sectionKey = "project";
        field.sectionLabel = field.sectionLabel || "项目经历";
        field.repeatIndex = projectIndex;
      }
      return list;
    }

    function isSeparateProjectHighlightsField(field) {
      if (field?.sectionKey !== "project") return false;
      const label = normalizeText(
        field.label || field.placeholder || field.name || field.id
      );
      return /项目?(亮点|成果|业绩|职责)|主要(亮点|成果)|职责描述/.test(label);
    }

    function belongsToSameProject(field, targetIndex) {
      return (
        field?.sectionKey === "project" &&
        Number.isInteger(field?.repeatIndex) &&
        field.repeatIndex === targetIndex
      );
    }

    function resolveProjectDescriptionValue(profile, field, resumePath, fields) {
      if (!isProjectDescriptionField(field)) return "";

      const pathMatch = String(resumePath || "").match(
        /^projects\.(\d+)\.(description|highlights)$/
      );
      if (!pathMatch) return "";

      const projectIndex = Number(pathMatch[1]);
      const siblingFields = (Array.isArray(fields) ? fields : []).filter(
        (candidate) =>
          candidate !== field && belongsToSameProject(candidate, projectIndex)
      );
      if (isCombinedProjectNarrativeField(field)) {
        if (
          siblingFields.some(
            (candidate) =>
              isProjectDescriptionField(candidate) ||
              isSeparateProjectHighlightsField(candidate)
          )
        ) {
          return "";
        }
      } else if (siblingFields.some(isSeparateProjectHighlightsField)) {
        return "";
      }

      const project = profile?.projects?.[projectIndex] || {};
      return [project.description, project.highlights]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .join("\n");
    }

    return {
      annotateProjectFields,
      resolveProjectDescriptionValue,
    };
  }
);
